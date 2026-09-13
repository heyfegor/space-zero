/**
 * Space Zero — autonomous RECOVERY LOOP verification (Task 9).
 *
 * Proves the existing end-to-end chain, unchanged:
 *
 *   Duffel booking → FlightAware monitoring → disruption → Strands recovery
 *   → alternative flight → deterministic authority → execute_booking
 *   → resolution / escalation
 *
 * Two clearly-separated sources of truth:
 *   • [LIVE PROVIDER DATA]      — a real FlightAware AeroAPI call, best effort,
 *     only to prove authentication/integration. It is NEVER used to fabricate a
 *     disruption (live APIs cannot produce one on demand).
 *   • [DEMO / SIMULATED]        — a deterministic FlightAware FIXTURE (raw AeroAPI
 *     JSON) fed through the SAME normalizeAeroApiResponse the live client uses,
 *     then through the SAME monitoring → detect → AT_RISK → recovery → authority
 *     → execute_booking code path. Nothing downstream is faked or shortcut.
 *
 * The recovery decision (arrival, connection, cost, funding, allowance, budget)
 * is made ONLY by the deterministic backend (domain/recovery + recovery-service).
 * The LLM decides nothing financial; here recovery runs deterministicOnly (the
 * same choke point the /monitor route falls back to when no model key is set).
 *
 * Persistence is in-memory (Supabase env unset below) — no file, no DB touched.
 * Booking + payment providers are controlled SPIES so the loop is verified with
 * no live booking and no live charge. No secret is printed.
 *
 * Run: node --env-file=.env.local --import tsx scripts/verify-recovery-loop.ts
 */

// In-memory persistence for this verification only (mirrors verify-duffel.ts).
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import { monitorTrip, getMonitoringView } from "../src/server/monitoring/monitoring-service";
import { triggerRecoveryWorkflow } from "../src/server/recovery/recovery-agent";
import {
  fixtureFlightAwareProvider,
  DEMO_ITINERARY,
} from "../src/server/monitoring/flightaware-fixtures";
import {
  isFlightStatusConfigured,
  HttpFlightAwareClient,
} from "../src/providers/flight-status";
import { isPaymentProviderConfigured } from "../src/server/payments/payment-service";
import { InMemoryTripRepository } from "../src/server/persistence/in-memory-trip-repository";
import { InMemoryFlightOptionRepository } from "../src/server/persistence/flight-option-repository";
import { InMemoryDisruptionRepository } from "../src/server/persistence/disruption-repository";
import { InMemoryRecoveryRepository } from "../src/server/persistence/recovery-repository";
import { InMemoryPaymentRepository } from "../src/server/persistence/payment-repository";
import type { Trip } from "../src/domain/trip";
import type { FlightOption, FlightSegment } from "../src/domain/flight-option";
import type { FlightStatusProvider } from "../src/providers/flight-status";
import type {
  DuffelBookingClient,
  DuffelClient,
  DuffelCreateOrderParams,
  DuffelOffer,
  DuffelOrder,
} from "../src/providers/duffel";
import type {
  AirwallexPaymentRequest,
  AirwallexPaymentResult,
  PaymentProvider,
} from "../src/providers/airwallex";
import type { PaymentStatus } from "../src/domain/payment";

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

// --- fixtures (aligned with the monitoring/lifecycle tests) -----------------

const DEADLINE = DEMO_ITINERARY.deadline; // 2026-09-05T21:00:00Z
const NOW = new Date("2026-09-04T12:00:00Z");
const ORIGINAL_COST = 1468;
let seq = 0;
const makeId = () => `id_${++seq}`;

const BOOKED_SEGS: FlightSegment[] = [
  { from: "LHR", to: "SIN", departAt: "2026-09-04T21:00:00Z", arriveAt: "2026-09-05T14:00:00Z", carrier: "SQ", flightNumber: "SQ317" },
  { from: "SIN", to: "SYD", departAt: "2026-09-05T16:00:00Z", arriveAt: "2026-09-05T19:35:00Z", carrier: "SQ", flightNumber: "SQ231" },
];

function monitoredTrip(id: string, over: Partial<Trip> = {}): Trip {
  return {
    id, userId: "u1", status: "CONFIRMED", brief: "b",
    origin: "London", destination: "Sydney", segments: [], arrivalDeadline: DEADLINE,
    currency: "GBP", tripBudget: 2000, recoveryAllowance: 150, checkedBags: 1,
    autoRebook: true, bookingStatus: "CONFIRMED", bookingReference: "SZ-4471",
    finalCost: ORIGINAL_COST, fundedAmount: 1800, selectedOptionId: "opt-booked",
    ...over,
  };
}

function bookedOption(tripId: string): FlightOption {
  return {
    id: "opt-booked", tripId, providerOfferId: "off-booked", segments: BOOKED_SEGS,
    totalAmount: ORIGINAL_COST, currency: "GBP", durationMinutes: 1355, connections: 1,
    departAt: BOOKED_SEGS[0].departAt, arriveAt: BOOKED_SEGS[1].arriveAt,
    rank: 0, recommended: true, selected: true, expiresAt: null,
  };
}

/** DEMO/SIMULATED: delays LHR→SIN so it lands 15:40 — 20 min before the 16:00
 *  connection (under the 45-min minimum). The DETERMINISTIC detector raises the
 *  threatening MISSED_CONNECTION; the provider never "decides" it. */
function connectionBreakingProvider(): FlightStatusProvider {
  return {
    async getFlightStatus(q) {
      if (q.from === "LHR" && q.to === "SIN") {
        return {
          status: "DELAYED", cancelled: false, diverted: false,
          scheduledDepartAt: "2026-09-04T21:00:00Z", estimatedDepartAt: null,
          scheduledArriveAt: "2026-09-05T14:00:00Z", estimatedArriveAt: "2026-09-05T15:40:00Z",
        };
      }
      return null;
    },
  };
}

/** One direct LHR→SYD alternative at `amount`, arriving before the deadline. */
function fakeDuffelSearch(amount: string): DuffelClient {
  return {
    async searchOffers(): Promise<DuffelOffer[]> {
      return [{
        id: "off_alt", total_amount: amount, total_currency: "GBP", expires_at: "2026-09-05T00:00:00Z",
        slices: [{ segments: [{ origin: { iata_code: "LHR" }, destination: { iata_code: "SYD" }, departing_at: "2026-09-04T22:00:00Z", arriving_at: "2026-09-05T18:00:00Z" }] }],
      }];
    },
  };
}

/** Spy booking client — counts getOffer/createOrder so we can prove 0 attempts. */
function spyBooking(opts: { liveTotal: number; createThrows?: boolean } = { liveTotal: 0 }) {
  const calls = { getOffer: 0, createOrder: 0 };
  const client: DuffelBookingClient = {
    async getOffer(offerId: string): Promise<DuffelOffer | null> {
      calls.getOffer++;
      return { id: offerId, total_amount: String(opts.liveTotal), total_currency: "GBP", expires_at: "2026-09-05T00:00:00Z", slices: [], passengers: [{ id: "pas_1", type: "adult" }] };
    },
    async createOrder(p: DuffelCreateOrderParams): Promise<DuffelOrder> {
      calls.createOrder++;
      if (opts.createThrows) throw new Error("order boom");
      return { id: "ord_rec_1", booking_reference: "PNR-REC", total_amount: p.amount, total_currency: p.currency };
    },
  };
  return { client, calls };
}

/** Spy Airwallex provider — counts createPayment and returns a controlled status. */
function spyPayment(status: PaymentStatus) {
  const calls = { createPayment: 0 };
  const provider: PaymentProvider = {
    async createPayment(_req: AirwallexPaymentRequest): Promise<AirwallexPaymentResult> {
      calls.createPayment++;
      return { providerPaymentId: "int_spy", status, providerStatus: status };
    },
  };
  return { provider, calls };
}

type Repos = {
  tripRepo: InMemoryTripRepository;
  optionRepo: InMemoryFlightOptionRepository;
  disruptionRepo: InMemoryDisruptionRepository;
  recoveryRepo: InMemoryRecoveryRepository;
  paymentRepo: InMemoryPaymentRepository;
};

async function setup(trip: Trip): Promise<Repos> {
  const tripRepo = new InMemoryTripRepository();
  await tripRepo.create(trip);
  const optionRepo = new InMemoryFlightOptionRepository();
  await optionRepo.replaceForTrip(trip.id, [bookedOption(trip.id)]);
  return {
    tripRepo, optionRepo,
    disruptionRepo: new InMemoryDisruptionRepository(),
    recoveryRepo: new InMemoryRecoveryRepository(),
    paymentRepo: new InMemoryPaymentRepository(),
  };
}

/** Drive monitoring with the recovery hand-off wired EXACTLY as POST /monitor:
 *  onDisruption → triggerRecoveryWorkflow(deterministicOnly). */
async function runLoop(
  tripId: string,
  repos: Repos,
  wiring: { provider: FlightStatusProvider; duffel?: DuffelClient; booking?: DuffelBookingClient; paymentProvider?: PaymentProvider },
) {
  let recovery: Awaited<ReturnType<typeof triggerRecoveryWorkflow>> | undefined;
  const monitor = await monitorTrip(tripId, {
    provider: wiring.provider,
    tripRepo: repos.tripRepo, optionRepo: repos.optionRepo, disruptionRepo: repos.disruptionRepo,
    now: NOW, makeId,
    onDisruption: async () => {
      recovery = await triggerRecoveryWorkflow(tripId, {
        tripRepo: repos.tripRepo, optionRepo: repos.optionRepo,
        disruptionRepo: repos.disruptionRepo, recoveryRepo: repos.recoveryRepo,
        paymentRepo: repos.paymentRepo,
        now: NOW, makeId,
        duffel: wiring.duffel, booking: wiring.booking, paymentProvider: wiring.paymentProvider,
        deterministicOnly: true,
      });
    },
  });
  return { monitor, recovery };
}

async function main() {
  line("=== Space Zero — autonomous recovery loop verification (Task 9) ===");
  line(`duffel configured      : ${Boolean(process.env.DUFFEL_API_KEY)} (mode ${String(process.env.DUFFEL_API_KEY).startsWith("duffel_test") ? "TEST" : "?"})`);
  line(`flightaware configured : ${isFlightStatusConfigured()}`);
  line(`airwallex configured   : ${isPaymentProviderConfigured()}`);
  line();

  // === [LIVE PROVIDER DATA] real FlightAware auth probe (best effort) ========
  line("[LIVE PROVIDER DATA] FlightAware AeroAPI authentication probe");
  line("  (proves the live integration authenticates; NOT used to create a disruption)");
  if (isFlightStatusConfigured()) {
    try {
      const live = new HttpFlightAwareClient();
      const obs = await live.getFlightStatus({ carrier: "BA", flightNumber: "BA117", departureDate: NOW.toISOString().slice(0, 10), from: "LHR", to: "JFK" });
      pass(`Live AeroAPI reachable and authenticated; normalized observation = ${obs ? obs.status : "no record for that flight/date (null, honest)"}.`);
    } catch (err) {
      line(`  ⚠ Live AeroAPI call could not complete (${err instanceof Error ? err.message : String(err)}). Integration code is exercised deterministically below; not counted as a failure.`);
    }
  } else {
    line("  ⚠ FlightAware key not configured; skipping the live probe.");
  }
  line();

  // === [DEMO / SIMULATED DISRUPTION] fixture through the real pipeline ========
  line("[DEMO / SIMULATED DISRUPTION] raw AeroAPI FIXTURE → real normalization → real pipeline");
  line("  itinerary: LHR →(SQ317)→ SIN →(SQ231)→ SYD   (fixture 'cancelled' scenario)");
  {
    const repos = await setup(monitoredTrip("sim-cancel"));
    // Fixture provider: canned RAW AeroAPI JSON run through the SAME
    // normalizeAeroApiResponse the live HttpFlightAwareClient uses.
    const monitor = await monitorTrip("sim-cancel", {
      provider: fixtureFlightAwareProvider("cancelled"),
      tripRepo: repos.tripRepo, optionRepo: repos.optionRepo, disruptionRepo: repos.disruptionRepo,
      now: NOW, makeId,
    });
    expect(monitor.segments.length === 2 && monitor.segments[0].status === "CANCELLED",
      "FlightAware fixture normalized into the monitoring model (LHR→SIN = CANCELLED).",
      "Fixture did not normalize into the expected monitoring segment status.");
    expect(monitor.status === "disrupted" && monitor.disruptions[0]?.type === "CANCELLATION" && monitor.disruptions[0]?.threatensTrip,
      "Deterministic detector raised a threatening CANCELLATION (backend decided, not the provider).",
      "Detector did not raise a threatening cancellation.");
    expect(monitor.tripStatus === "AT_RISK",
      "Meaningful disruption advanced the trip CONFIRMED → AT_RISK via the state machine.",
      `Trip did not move to AT_RISK (status=${monitor.tripStatus}).`);
  }
  line();

  // === 1. Monitoring + Strands recovery hand-off (MISSED_CONNECTION) =========
  line("[1] Monitoring → AT_RISK → Strands recovery workflow hand-off");
  {
    const repos = await setup(monitoredTrip("hook"));
    const { monitor, recovery } = await runLoop("hook", repos, {
      provider: connectionBreakingProvider(),
      duffel: fakeDuffelSearch(String(ORIGINAL_COST + 96)),
      booking: spyBooking({ liveTotal: ORIGINAL_COST + 96 }).client,
      paymentProvider: spyPayment("SUCCEEDED").provider,
    });
    expect(monitor.tripStatus === "AT_RISK" && !!monitor.operationalEvent,
      "Monitoring emitted the DISRUPTION_DETECTED operational event that triggers recovery.",
      "Monitoring did not emit a recovery-trigger event.");
    expect(!!recovery,
      "triggerRecoveryWorkflow ran (the same entry POST /monitor uses; deterministic choke point).",
      "Recovery workflow did not run.");
  }
  line();

  // === 2/3. Automatic recovery: £96 additional / £150 allowance → RESOLVED ====
  line("[2/3] Automatic recovery — recovery cost £96 / allowance £150 → PERMITTED → execute_booking");
  {
    const repos = await setup(monitoredTrip("perm96", { recoveryAllowance: 150, fundedAmount: 1800 }));
    const book = spyBooking({ liveTotal: ORIGINAL_COST + 96 });
    const pay = spyPayment("SUCCEEDED");
    const { recovery } = await runLoop("perm96", repos, {
      provider: connectionBreakingProvider(),
      duffel: fakeDuffelSearch(String(ORIGINAL_COST + 96)), // additional = £96
      booking: book.client,
      paymentProvider: pay.provider,
    });
    expect(recovery?.evaluation?.decision.kind === "AUTO_BOOK",
      "Deterministic engine PERMITTED the £96 recovery (AUTO_BOOK) — not the LLM.",
      `Expected AUTO_BOOK, got ${recovery?.evaluation?.decision.kind}.`);
    expect(pay.calls.createPayment === 1,
      "Authorized recovery payment (£96) was captured through the payment service (1 attempt).",
      `Expected 1 payment attempt, got ${pay.calls.createPayment}.`);
    expect(book.calls.createOrder === 1,
      "execute_booking created exactly one provider order after authority passed.",
      `Expected 1 booking, got ${book.calls.createOrder}.`);
    const trip = await repos.tripRepo.getById("perm96");
    expect(recovery?.status === "recovered" && trip?.status === "RESOLVED" && trip?.bookingStatus === "CONFIRMED",
      `Trip advanced to RESOLVED only after the provider confirmed (order ${recovery?.recovery?.duffelOrderId}, PNR ${recovery?.recovery?.bookingReference}).`,
      `Trip did not resolve correctly (status=${trip?.status}).`);
    const view = await getMonitoringView("perm96", { ...repos, providerConfigured: true });
    expect(view?.recovery?.status === "RECOVERED",
      "Persisted view reads RECOVERED (Disruption/Resolution screens reflect real state).",
      "Persisted recovery view is not RECOVERED.");
  }
  line();

  // === 4. Human escalation: £181 additional / £150 allowance → ESCALATED ======
  line("[4] Human escalation — recovery cost £181 / allowance £150 → DENIED → ESCALATED");
  {
    const repos = await setup(monitoredTrip("esc181", { recoveryAllowance: 150, fundedAmount: 1800 }));
    const book = spyBooking({ liveTotal: ORIGINAL_COST + 181 });
    const pay = spyPayment("SUCCEEDED");
    const { recovery } = await runLoop("esc181", repos, {
      provider: connectionBreakingProvider(),
      duffel: fakeDuffelSearch(String(ORIGINAL_COST + 181)), // additional = £181 > £150
      booking: book.client,
      paymentProvider: pay.provider,
    });
    expect(recovery?.status === "escalated" && recovery?.recovery?.escalationReason === "OVER_ALLOWANCE",
      "Deterministic authority DENIED it → ESCALATED (OVER_ALLOWANCE).",
      `Expected escalated/OVER_ALLOWANCE, got ${recovery?.status}/${recovery?.recovery?.escalationReason}.`);
    expect(pay.calls.createPayment === 0, "0 payment attempts.", `Expected 0 payments, got ${pay.calls.createPayment}.`);
    expect(book.calls.createOrder === 0, "0 unauthorized booking attempts.", `Expected 0 bookings, got ${book.calls.createOrder}.`);
    const trip = await repos.tripRepo.getById("esc181");
    expect(trip?.status === "AT_RISK" && (trip?.duffelOrderId ?? null) === null,
      "No RESOLVED — trip stays AT_RISK for the traveler's decision.",
      `Trip advanced wrongly (status=${trip?.status}).`);
  }
  line();

  // === 4b. Insufficient funding → ESCALATED ==================================
  line("[4b] Insufficient funding → ESCALATED (no payment, no booking)");
  {
    // Alternative +£132 (within the £150 allowance) but funds £1500 < £1600 total.
    const repos = await setup(monitoredTrip("fund", { recoveryAllowance: 150, fundedAmount: 1500 }));
    const book = spyBooking({ liveTotal: ORIGINAL_COST + 132 });
    const pay = spyPayment("SUCCEEDED");
    const { recovery } = await runLoop("fund", repos, {
      provider: connectionBreakingProvider(),
      duffel: fakeDuffelSearch(String(ORIGINAL_COST + 132)),
      booking: book.client,
      paymentProvider: pay.provider,
    });
    expect(recovery?.status === "escalated" && recovery?.recovery?.escalationReason === "INSUFFICIENT_FUNDING",
      "Insufficient funding → ESCALATED (INSUFFICIENT_FUNDING).",
      `Expected INSUFFICIENT_FUNDING escalation, got ${recovery?.recovery?.escalationReason}.`);
    expect(pay.calls.createPayment === 0 && book.calls.createOrder === 0, "0 payments and 0 bookings attempted.", "A payment or booking was attempted despite short funding.");
    const trip = await repos.tripRepo.getById("fund");
    expect(trip?.status === "AT_RISK", "No RESOLVED — trip stays AT_RISK.", `status=${trip?.status}.`);
  }
  line();

  // === 5a. Provider failure — Duffel order fails → never RESOLVED ============
  line("[5a] Duffel provider failure on booking → honest failure, never RESOLVED");
  {
    const repos = await setup(monitoredTrip("dufffail", { recoveryAllowance: 150, fundedAmount: 1800 }));
    const book = spyBooking({ liveTotal: ORIGINAL_COST + 96, createThrows: true });
    const pay = spyPayment("SUCCEEDED");
    const { recovery } = await runLoop("dufffail", repos, {
      provider: connectionBreakingProvider(),
      duffel: fakeDuffelSearch(String(ORIGINAL_COST + 96)),
      booking: book.client,
      paymentProvider: pay.provider,
    });
    expect(recovery?.status === "provider_error" && !recovery?.recovery,
      "Order failure surfaced as provider_error; no recovery recorded.",
      `Expected provider_error, got ${recovery?.status}.`);
    const trip = await repos.tripRepo.getById("dufffail");
    expect(trip?.status === "AT_RISK" && trip?.bookingStatus === "FAILED" && (trip?.duffelOrderId ?? null) === null,
      "Trip remains AT_RISK with bookingStatus=FAILED — no fabricated RESOLVED.",
      `Wrong post-failure state (status=${trip?.status}, bookingStatus=${trip?.bookingStatus}).`);
  }
  line();

  // === 5b. Provider failure — Airwallex payment declined → never RESOLVED ====
  line("[5b] Airwallex payment declined → nothing booked, never RESOLVED");
  {
    const repos = await setup(monitoredTrip("payfail", { recoveryAllowance: 150, fundedAmount: 1800 }));
    const book = spyBooking({ liveTotal: ORIGINAL_COST + 96 });
    const pay = spyPayment("DECLINED"); // provider declines the recovery charge
    const { recovery } = await runLoop("payfail", repos, {
      provider: connectionBreakingProvider(),
      duffel: fakeDuffelSearch(String(ORIGINAL_COST + 96)),
      booking: book.client,
      paymentProvider: pay.provider,
    });
    expect(recovery?.status === "provider_error",
      "Declined payment stopped the recovery (provider_error) — payment gate before booking.",
      `Expected provider_error, got ${recovery?.status}.`);
    expect(pay.calls.createPayment === 1 && book.calls.createOrder === 0,
      "Payment was attempted once and DECLINED; NO booking followed.",
      `Expected 1 payment / 0 bookings, got ${pay.calls.createPayment}/${book.calls.createOrder}.`);
    const trip = await repos.tripRepo.getById("payfail");
    expect(trip?.status === "AT_RISK" && (trip?.duffelOrderId ?? null) === null,
      "Trip remains AT_RISK — no fabricated RESOLVED on a failed charge.",
      `Wrong state after declined payment (status=${trip?.status}).`);
  }
  line();

  line("=== Summary ===");
  if (failures === 0) {
    line("RESULT: ALL CHECKS PASSED. Autonomous recovery loop verified end to end through the real pipeline.");
  } else {
    line(`RESULT: ${failures} CHECK(S) FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("VERIFICATION ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
