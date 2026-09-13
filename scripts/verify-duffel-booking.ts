/**
 * Space Zero — Duffel (TEST MODE) real BOOKING verification (end to end).
 *
 * Verifies the full money path Task 8 asks for, reporting the actual outcome:
 *
 *   Trip → real Duffel offer → selected offer persisted → funding → authority
 *   → execute_booking (bookTrip) → Duffel TEST order → persisted order result
 *   → correct trip state.
 *
 * It makes REAL calls to Duffel using the configured DUFFEL_API_KEY, which MUST
 * be a test-mode key (duffel_test_...). Section [2] creates a REAL Duffel TEST
 * order via the real HttpDuffelClient (test mode settles from the sandbox
 * balance — no money moves, no live account). Every gate test in [3]-[7] proves
 * a booking is refused BEFORE any provider order, using spy clients so we can
 * assert createOrder was never called.
 *
 * Persistence is routed to the in-memory repositories (Supabase env unset below)
 * so the flow is exercised in isolation with real provider data, exactly like
 * scripts/verify-duffel.ts. No file and no Supabase project is touched. No secret
 * value is printed.
 *
 * Run: node --env-file=.env.local --import tsx scripts/verify-duffel-booking.ts
 */

// Route persistence to the in-memory store for this verification only (see
// verify-duffel.ts). Affects only this process; changes no file and no DB.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import {
  isDuffelConfigured,
  HttpDuffelClient,
  type DuffelBookingClient,
  type DuffelClient,
  type DuffelCreateOrderParams,
  type DuffelOffer,
  type DuffelOrder,
} from "../src/providers/duffel";
import type { Trip } from "../src/domain/trip";
import type { FlightOption } from "../src/domain/flight-option";
import { evaluateAuthority } from "../src/domain/authority";
import { bookTrip } from "../src/server/booking/booking-service";
import { runRecovery } from "../src/server/recovery/recovery-service";
import { InMemoryTripRepository } from "../src/server/persistence/in-memory-trip-repository";
import { InMemoryFlightOptionRepository } from "../src/server/persistence/flight-option-repository";
import { InMemoryDisruptionRepository } from "../src/server/persistence/disruption-repository";
import { InMemoryRecoveryRepository } from "../src/server/persistence/recovery-repository";

const line = (s = "") => console.log(s);
const pass = (s: string) => line(`  ✓ ${s}`);
const fail = (s: string) => line(`  ✗ ${s}`);

let failures = 0;
function expect(cond: boolean, ok: string, bad: string) {
  if (cond) pass(ok);
  else {
    fail(bad);
    failures++;
  }
}

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
function tripFixture(over: Partial<Trip> = {}): Trip {
  seq += 1;
  return {
    id: `book_${Date.now()}_${seq}`,
    origin: "London",
    destination: "New York",
    segments: [],
    arrivalDeadline: "",
    currency: "GBP",
    tripBudget: 5000,
    recoveryAllowance: 150,
    checkedBags: 0,
    autoRebook: true,
    status: "READY",
    fundedAmount: 5000,
    fundingStatus: "FUNDED",
    selectedOptionId: null,
    ...over,
  };
}

function optionFixture(tripId: string, over: Partial<FlightOption> = {}): FlightOption {
  return {
    id: `opt_${tripId}`,
    tripId,
    providerOfferId: "off_stub",
    segments: [],
    totalAmount: 500,
    currency: "GBP",
    durationMinutes: 480,
    connections: 0,
    departAt: "",
    arriveAt: "",
    rank: 0,
    recommended: true,
    selected: true,
    expiresAt: null,
    ...over,
  };
}

/** A spy fake Duffel booking client so gate tests can assert no order was made. */
function spyDuffel(
  opts: { offer?: DuffelOffer | null; getOfferThrows?: boolean; createThrows?: boolean } = {},
): DuffelBookingClient & { orders: DuffelCreateOrderParams[] } {
  const orders: DuffelCreateOrderParams[] = [];
  return {
    orders,
    async getOffer(offerId: string): Promise<DuffelOffer | null> {
      if (opts.getOfferThrows) throw new Error("boom");
      if (opts.offer !== undefined) return opts.offer;
      return {
        id: offerId,
        total_amount: "500.00",
        total_currency: "GBP",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        slices: [],
        passengers: [{ id: "pas_1", type: "adult" }],
      };
    },
    async createOrder(params: DuffelCreateOrderParams): Promise<DuffelOrder> {
      orders.push(params);
      if (opts.createThrows) throw new Error("provider down");
      return {
        id: "ord_stub",
        booking_reference: "STUB01",
        total_amount: params.amount,
        total_currency: params.currency,
      };
    },
  };
}

async function main() {
  line("=== Space Zero — Duffel TEST MODE real-booking verification ===");
  const key = process.env.DUFFEL_API_KEY ?? "";
  const mode = key.startsWith("duffel_test") ? "TEST" : key.startsWith("duffel_live") ? "LIVE" : "unknown";
  line(`configured    : ${isDuffelConfigured()}`);
  line(`key mode      : ${mode}${mode === "unknown" ? " (unexpected prefix)" : ""}`);
  line(`api version   : ${process.env.DUFFEL_API_VERSION ?? "v2"}`);
  line();

  if (!isDuffelConfigured()) {
    fail("DUFFEL_API_KEY is not set; no API call was made.");
    process.exitCode = 1;
    return;
  }
  if (mode === "LIVE") {
    fail("Key is a LIVE key. Refusing to run to avoid real bookings/charges.");
    process.exitCode = 1;
    return;
  }

  const httpDuffel = new HttpDuffelClient();

  // --- [1] Real search → a real, current Duffel offer ------------------------
  line("[1] Real Duffel offer request (authenticate + real offer id)");
  let realOffer: DuffelOffer | undefined;
  try {
    const offers = await (httpDuffel as DuffelClient).searchOffers({
      origin: "LHR",
      destination: "JFK",
      departureDate: ymd(21),
      passengers: 1,
      cabinClass: "economy",
    });
    expect(offers.length > 0, `Duffel authenticated and returned ${offers.length} offer(s).`, "Duffel returned zero offers.");
    realOffer = offers[0];
    if (realOffer) {
      expect(
        typeof realOffer.id === "string" && realOffer.id.startsWith("off_") && Number(realOffer.total_amount) > 0,
        `Selected a real Duffel offer id (${realOffer.id}, ${realOffer.total_amount} ${realOffer.total_currency}).`,
        "First offer did not look like a real Duffel offer.",
      );
    }
  } catch (err) {
    fail(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
    failures++;
  }
  line();

  // --- [2] Valid permitted booking → REAL Duffel TEST order ------------------
  line("[2] Valid permitted booking through bookTrip → REAL Duffel TEST order");
  if (realOffer) {
    const realCost = Number(realOffer.total_amount);
    const tripRepo = new InMemoryTripRepository();
    const optionRepo = new InMemoryFlightOptionRepository();
    const trip = await tripRepo.create(
      tripFixture({ tripBudget: realCost + 1000, fundedAmount: realCost + 1000 }),
    );
    await optionRepo.replaceForTrip(trip.id, [
      optionFixture(trip.id, {
        providerOfferId: realOffer.id,
        totalAmount: realCost,
        currency: realOffer.total_currency,
        expiresAt: realOffer.expires_at ?? null,
      }),
    ]);
    await tripRepo.update(trip.id, { selectedOptionId: `opt_${trip.id}` });

    // Real booking client: re-fetches/validates the live offer then creates a
    // real TEST order. This is the actual execute_booking REAL path.
    const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel: httpDuffel });

    if (r.status !== "CONFIRMED") {
      fail(`Booking did not confirm: status=${r.status} reason="${r.reason}"`);
      failures++;
    } else {
      expect(!!r.duffelOrderId && r.duffelOrderId.startsWith("ord_"), `Duffel confirmed a real TEST order (${r.duffelOrderId}).`, "No real order id returned.");
      expect(!!r.bookingReference, `Booking reference (PNR) returned (${r.bookingReference}).`, "No booking reference returned.");
      expect(typeof r.finalCost === "number" && r.finalCost! > 0, `Final price returned (${r.currency}${r.finalCost}).`, "No final price returned.");

      const after = (await tripRepo.getById(trip.id))!;
      expect(after.duffelOrderId === r.duffelOrderId, "Persisted: Duffel order id.", "Order id not persisted.");
      expect(after.bookingReference === r.bookingReference, "Persisted: booking reference.", "Reference not persisted.");
      expect(after.finalCost === r.finalCost, "Persisted: final price.", "Final price not persisted.");
      expect(after.bookingStatus === "CONFIRMED", "Persisted: bookingStatus=CONFIRMED.", `bookingStatus=${after.bookingStatus}.`);
      expect(after.status === "CONFIRMED", "Trip advanced to CONFIRMED only after Duffel confirmed.", `Trip status=${after.status}.`);
    }
  } else {
    fail("Skipped — no real offer from [1].");
    failures++;
  }
  line();

  // --- [3] Authority gate: £181 recovery / £150 allowance → blocked ----------
  line("[3] Authority gate: recovery £181 over a £150 allowance is blocked before Duffel");
  expect(
    evaluateAuthority(181, 150).permitted === false,
    "Deterministic authority engine denies £181 against a £150 allowance.",
    "Authority engine permitted an over-allowance spend.",
  );
  {
    const tripRepo = new InMemoryTripRepository();
    const optionRepo = new InMemoryFlightOptionRepository();
    const recoveryRepo = new InMemoryRecoveryRepository();
    const trip = await tripRepo.create(
      tripFixture({ status: "AT_RISK", recoveryAllowance: 150, finalCost: 500, tripBudget: 5000, fundedAmount: 5000 }),
    );
    const booked = optionFixture(trip.id, { id: `opt_${trip.id}`, providerOfferId: "off_booked", totalAmount: 500 });
    await optionRepo.replaceForTrip(trip.id, [booked]);
    // A candidate that is eligible + funded + within budget, but £181 over → OVER_ALLOWANCE.
    const candidate = optionFixture(trip.id, {
      id: `cand_${trip.id}`,
      providerOfferId: "off_candidate",
      totalAmount: 681,
      selected: false,
      recommended: false,
      segments: [{ from: "LHR", to: "JFK", departAt: ymd(21) + "T09:00:00Z", arriveAt: ymd(21) + "T17:00:00Z" }],
      arriveAt: ymd(21) + "T17:00:00Z",
    });
    // Booking client throws if ever called — proving no provider order is attempted.
    const guard = spyDuffel({ getOfferThrows: true, createThrows: true });
    const out = await runRecovery(trip.id, {
      tripRepo,
      optionRepo,
      disruptionRepo: new InMemoryDisruptionRepository(),
      recoveryRepo,
      candidates: [candidate],
      booking: guard,
    });
    expect(out.status === "escalated", `Recovery escalated instead of booking (status=${out.status}).`, `Expected escalated, got ${out.status}.`);
    expect(out.evaluation?.decision.escalationReason === "OVER_ALLOWANCE", "Escalation reason is OVER_ALLOWANCE.", `Reason=${out.evaluation?.decision.escalationReason}.`);
    expect(guard.orders.length === 0, "No Duffel order was attempted (blocked before provider).", "A provider order was attempted despite over-allowance.");
    const after = (await tripRepo.getById(trip.id))!;
    expect(after.status === "AT_RISK" && after.bookingStatus === undefined, "Trip not advanced; no CONFIRMED/RESOLVED.", `Trip advanced wrongly (status=${after.status}).`);
  }
  line();

  // --- [4] Funding gate: insufficient funding → blocked before Duffel --------
  line("[4] Funding gate: funds below cost is blocked before Duffel");
  {
    const tripRepo = new InMemoryTripRepository();
    const optionRepo = new InMemoryFlightOptionRepository();
    const trip = await tripRepo.create(tripFixture({ fundedAmount: 100 })); // < 500 cost
    await optionRepo.replaceForTrip(trip.id, [optionFixture(trip.id, { providerOfferId: "off_fund" })]);
    const guard = spyDuffel();
    const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel: guard });
    expect(r.status === "DENIED" && r.denialReason === "INSUFFICIENT_FUNDING", `Refused with INSUFFICIENT_FUNDING (status=${r.status}).`, `Expected INSUFFICIENT_FUNDING, got ${r.denialReason}.`);
    expect(guard.orders.length === 0, "No Duffel order attempted.", "A provider order was attempted despite short funding.");
  }
  line();

  // --- [5] Invalid/expired offer → blocked -----------------------------------
  line("[5] Invalid/expired offer protection");
  {
    // (a) Local expiry — refused by the precondition gate, provider never called.
    const tripRepo = new InMemoryTripRepository();
    const optionRepo = new InMemoryFlightOptionRepository();
    const trip = await tripRepo.create(tripFixture());
    await optionRepo.replaceForTrip(trip.id, [
      optionFixture(trip.id, { providerOfferId: "off_exp", expiresAt: new Date(Date.now() - 3_600_000).toISOString() }),
    ]);
    const guard = spyDuffel();
    const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel: guard });
    expect(r.status === "DENIED" && r.denialReason === "OFFER_EXPIRED", `Locally-expired fare refused (status=${r.status}).`, `Expected OFFER_EXPIRED, got ${r.denialReason}.`);
    expect(guard.orders.length === 0, "No Duffel order attempted for the expired fare.", "A provider order was attempted for an expired fare.");
  }
  {
    // (b) Real provider check — a bogus offer id that Duffel does not recognise.
    const tripRepo = new InMemoryTripRepository();
    const optionRepo = new InMemoryFlightOptionRepository();
    const trip = await tripRepo.create(tripFixture());
    await optionRepo.replaceForTrip(trip.id, [
      optionFixture(trip.id, { providerOfferId: "off_0000000000000000000000", expiresAt: null }),
    ]);
    const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel: httpDuffel });
    expect(
      r.ok === false && (r.denialReason === "OFFER_EXPIRED" || r.status === "PROVIDER_FAILED"),
      `Real Duffel rejected an unknown offer id (status=${r.status}, reason=${r.denialReason ?? "n/a"}). Nothing booked.`,
      `Unknown offer id was NOT rejected (status=${r.status}).`,
    );
  }
  line();

  // --- [6] Provider failure → no false confirmation --------------------------
  line("[6] Provider failure never yields a false CONFIRMED");
  {
    const tripRepo = new InMemoryTripRepository();
    const optionRepo = new InMemoryFlightOptionRepository();
    const trip = await tripRepo.create(tripFixture());
    await optionRepo.replaceForTrip(trip.id, [optionFixture(trip.id, { providerOfferId: "off_pf" })]);
    const guard = spyDuffel({ createThrows: true });
    const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel: guard });
    expect(r.status === "PROVIDER_FAILED" && r.ok === false, `Order failure surfaced honestly (status=${r.status}).`, `Expected PROVIDER_FAILED, got ${r.status}.`);
    expect(!r.duffelOrderId && !r.bookingReference, "No fabricated order id / reference.", "Fabricated order id or reference on failure.");
    const after = (await tripRepo.getById(trip.id))!;
    expect(after.status === "READY" && after.bookingStatus === "FAILED", "Trip stayed READY; booking recorded FAILED (no CONFIRMED/RESOLVED).", `Wrong post-failure state (status=${after.status}, bookingStatus=${after.bookingStatus}).`);
  }
  line();

  // --- [7] Duplicate execution protection ------------------------------------
  line("[7] Duplicate execution does not create a second order");
  {
    const tripRepo = new InMemoryTripRepository();
    const optionRepo = new InMemoryFlightOptionRepository();
    const trip = await tripRepo.create(tripFixture());
    await optionRepo.replaceForTrip(trip.id, [optionFixture(trip.id, { providerOfferId: "off_dup" })]);
    const guard = spyDuffel();
    const first = await bookTrip(trip.id, { tripRepo, optionRepo, duffel: guard });
    expect(first.status === "CONFIRMED" && guard.orders.length === 1, "First booking confirmed (1 order).", `First booking not confirmed (status=${first.status}, orders=${guard.orders.length}).`);
    // Second execute_booking on the now-CONFIRMED trip.
    const second = await bookTrip(trip.id, { tripRepo, optionRepo, duffel: guard });
    expect(
      second.ok === false && second.status === "DENIED" && second.denialReason === "TRIP_NOT_AUTHORIZED",
      `Re-booking a CONFIRMED trip is refused (status=${second.status}, reason=${second.denialReason}).`,
      `Duplicate booking not refused (status=${second.status}).`,
    );
    expect(guard.orders.length === 1, "Still exactly ONE Duffel order after a duplicate attempt.", `Duplicate created ${guard.orders.length} orders.`);
  }
  line();

  line("=== Summary ===");
  if (failures === 0) {
    line("RESULT: ALL CHECKS PASSED. Real Duffel TEST booking path verified end to end.");
  } else {
    line(`RESULT: ${failures} CHECK(S) FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("VERIFICATION ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
