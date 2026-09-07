/**
 * Space Zero — real booking tests (deterministic; no Duffel key, no network).
 *
 * Proves the REAL booking choke point: every required server-side verification
 * (authorized, option selected, offer valid, funded, within budget) is enforced
 * against authoritative store data, the provider is the ONLY source of a
 * confirmed success, failures are honest, and the outcome is persisted with the
 * trip advanced through the validated state machine. The staged/demo path stays
 * intact (see src/server/tools/tools.test.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { bookTrip } from "./booking-service";
import { verifyBookingPreconditions } from "../../domain/booking";
import { InMemoryTripRepository } from "../persistence/in-memory-trip-repository";
import {
  InMemoryFlightOptionRepository,
  getFlightOptionRepository,
} from "../persistence/flight-option-repository";
import { getTripRepository } from "../persistence/trip-repository";
import { executeBookingTool } from "../tools/execute-booking";
import type { Trip } from "../../domain/trip";
import type { FlightOption } from "../../domain/flight-option";
import type {
  DuffelBookingClient,
  DuffelCreateOrderParams,
  DuffelOffer,
  DuffelOrder,
} from "../../providers/duffel";

// --- fixtures ---------------------------------------------------------------

const NOW = new Date("2026-09-07T00:00:00Z");
const FUTURE = "2026-09-07T01:00:00Z"; // after NOW
const PAST = "2026-09-06T23:00:00Z"; // before NOW

let seq = 0;

function bookableTrip(over: Partial<Trip> = {}): Trip {
  seq += 1;
  return {
    id: `t_book_${seq}`,
    userId: "u1",
    status: "READY",
    brief: "b",
    origin: "London",
    destination: "Sydney",
    segments: [],
    arrivalDeadline: "",
    currency: "GBP",
    tripBudget: 2000,
    recoveryAllowance: 150,
    checkedBags: 0,
    autoRebook: true,
    fundedAmount: 600,
    fundingStatus: "FUNDED",
    selectedOptionId: null,
    ...over,
  };
}

function bookableOption(tripId: string, over: Partial<FlightOption> = {}): FlightOption {
  return {
    id: `opt_${tripId}`,
    tripId,
    providerOfferId: "off_1",
    segments: [],
    totalAmount: 500,
    currency: "GBP",
    durationMinutes: 600,
    connections: 0,
    departAt: "",
    arriveAt: "",
    rank: 0,
    recommended: true,
    selected: true,
    expiresAt: FUTURE,
    ...over,
  };
}

interface FakeOpts {
  /** What getOffer returns; undefined → a default live offer. null → gone. */
  offer?: DuffelOffer | null;
  getOfferThrows?: boolean;
  createThrows?: boolean;
  order?: DuffelOrder;
}

function fakeDuffel(opts: FakeOpts = {}): DuffelBookingClient & { orders: DuffelCreateOrderParams[] } {
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
        expires_at: FUTURE,
        slices: [],
        passengers: [{ id: "pas_1", type: "adult" }],
      };
    },
    async createOrder(params: DuffelCreateOrderParams): Promise<DuffelOrder> {
      orders.push(params);
      if (opts.createThrows) throw new Error("provider down");
      return (
        opts.order ?? {
          id: "ord_123",
          booking_reference: "ABC123",
          total_amount: params.amount,
          total_currency: params.currency,
        }
      );
    },
  };
}

async function seed(tripOver: Partial<Trip> = {}, optionOver: Partial<FlightOption> = {}) {
  const tripRepo = new InMemoryTripRepository();
  const optionRepo = new InMemoryFlightOptionRepository();
  const trip = await tripRepo.create(bookableTrip(tripOver));
  await optionRepo.replaceForTrip(trip.id, [bookableOption(trip.id, optionOver)]);
  return { tripRepo, optionRepo, trip };
}

// --- successful booking ------------------------------------------------------

test("success: confirmed order → persists order id, reference, final cost, and advances state", async () => {
  const { tripRepo, optionRepo, trip } = await seed();
  const duffel = fakeDuffel();

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, true);
  assert.equal(r.mode, "REAL");
  assert.equal(r.status, "CONFIRMED");
  assert.equal(r.duffelOrderId, "ord_123");
  assert.equal(r.bookingReference, "ABC123");
  assert.equal(r.finalCost, 500);

  // Passenger details are derived from the LIVE offer, not the client.
  assert.equal(duffel.orders.length, 1);
  assert.equal(duffel.orders[0].passengers[0].id, "pas_1");

  const after = (await tripRepo.getById(trip.id))!;
  assert.equal(after.status, "CONFIRMED"); // READY → BOOKING → CONFIRMED
  assert.equal(after.bookingStatus, "CONFIRMED");
  assert.equal(after.duffelOrderId, "ord_123");
  assert.equal(after.bookingReference, "ABC123");
  assert.equal(after.finalCost, 500);
});

// --- authorization denial ----------------------------------------------------

test("authorization denial: a trip that is not READY/BOOKING is refused, nothing booked", async () => {
  const { tripRepo, optionRepo, trip } = await seed({ status: "DRAFT" });
  const duffel = fakeDuffel();

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "DENIED");
  assert.equal(r.denialReason, "TRIP_NOT_AUTHORIZED");
  assert.equal(duffel.orders.length, 0); // provider never called

  const after = (await tripRepo.getById(trip.id))!;
  assert.equal(after.status, "DRAFT"); // unchanged
  assert.equal(after.bookingStatus, undefined);
});

// --- no option selected ------------------------------------------------------

test("no option selected: refused before any provider call", async () => {
  const { tripRepo, optionRepo, trip } = await seed({ selectedOptionId: null }, { selected: false });
  const duffel = fakeDuffel();

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "DENIED");
  assert.equal(r.denialReason, "NO_OPTION_SELECTED");
  assert.equal(duffel.orders.length, 0);
});

// --- expired offer -----------------------------------------------------------

test("expired offer: a stale selected fare is refused (local expiry check)", async () => {
  const { tripRepo, optionRepo, trip } = await seed({}, { expiresAt: PAST });
  const duffel = fakeDuffel();

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "DENIED");
  assert.equal(r.denialReason, "OFFER_EXPIRED");
  assert.equal(duffel.orders.length, 0);
});

test("expired offer: passes local check but the live offer is gone → refused", async () => {
  const { tripRepo, optionRepo, trip } = await seed();
  const duffel = fakeDuffel({ offer: null }); // provider says the offer no longer exists

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "DENIED");
  assert.equal(r.denialReason, "OFFER_EXPIRED");
  assert.equal(duffel.orders.length, 0);
});

// --- insufficient funding ----------------------------------------------------

test("insufficient funding: funds below cost is refused, nothing booked", async () => {
  const { tripRepo, optionRepo, trip } = await seed({ fundedAmount: 100 }); // < 500 cost
  const duffel = fakeDuffel();

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "DENIED");
  assert.equal(r.denialReason, "INSUFFICIENT_FUNDING");
  assert.equal(duffel.orders.length, 0);
});

test("insufficient funding: a silent live re-price above funding is refused", async () => {
  const { tripRepo, optionRepo, trip } = await seed({ fundedAmount: 600 });
  // Stored cost 500 (funded 600 covers it) but the live fare re-priced to 700.
  const duffel = fakeDuffel({
    offer: { id: "off_1", total_amount: "700.00", total_currency: "GBP", expires_at: FUTURE, slices: [], passengers: [{ id: "pas_1" }] },
  });

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "DENIED");
  assert.equal(r.denialReason, "INSUFFICIENT_FUNDING");
  assert.equal(duffel.orders.length, 0);
});

// --- over budget -------------------------------------------------------------

test("over budget: cost above the trip budget is refused", async () => {
  const { tripRepo, optionRepo, trip } = await seed({ tripBudget: 300, fundedAmount: 600 }); // cost 500 > 300
  const duffel = fakeDuffel();

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "DENIED");
  assert.equal(r.denialReason, "OVER_BUDGET");
  assert.equal(duffel.orders.length, 0);
});

// --- provider failure --------------------------------------------------------

test("provider failure: order creation throwing yields an honest failure, records FAILED, no state advance", async () => {
  const { tripRepo, optionRepo, trip } = await seed();
  const duffel = fakeDuffel({ createThrows: true });

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "PROVIDER_FAILED");
  assert.equal(r.duffelOrderId, undefined);
  assert.equal(r.bookingReference, undefined);

  const after = (await tripRepo.getById(trip.id))!;
  assert.equal(after.status, "READY"); // NOT advanced on failure
  assert.equal(after.bookingStatus, "FAILED"); // honest audit trail
  assert.equal(after.duffelOrderId ?? null, null);
});

test("provider failure: getOffer throwing is surfaced honestly, nothing booked", async () => {
  const { tripRepo, optionRepo, trip } = await seed();
  const duffel = fakeDuffel({ getOfferThrows: true });

  const r = await bookTrip(trip.id, { tripRepo, optionRepo, duffel, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "PROVIDER_FAILED");
  assert.equal(duffel.orders.length, 0);
});

// --- provider unconfigured / trip not found ---------------------------------

test("provider unconfigured: refuses rather than fabricating a booking", async () => {
  const { tripRepo, optionRepo, trip } = await seed();
  // No injected duffel and no DUFFEL_API_KEY in tests → honest unconfigured state.
  const r = await bookTrip(trip.id, { tripRepo, optionRepo, now: NOW });

  assert.equal(r.ok, false);
  assert.equal(r.status, "PROVIDER_UNCONFIGURED");
});

test("trip not found: an unknown persisted trip id fails cleanly", async () => {
  const tripRepo = new InMemoryTripRepository();
  const optionRepo = new InMemoryFlightOptionRepository();
  const r = await bookTrip("missing", { tripRepo, optionRepo, duffel: fakeDuffel(), now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.status, "TRIP_NOT_FOUND");
});

// --- domain precondition gate (pure) ----------------------------------------

test("verifyBookingPreconditions: passes only when every gate holds", () => {
  const base = {
    tripStatus: "READY" as const,
    selectedOption: bookableOption("t1"),
    fundedAmount: 600,
    tripBudget: 2000,
    cost: 500,
    currency: "GBP",
    now: NOW,
  };
  assert.equal(verifyBookingPreconditions(base).ok, true);
  assert.equal(verifyBookingPreconditions({ ...base, tripStatus: "MONITORING" }).reason, "TRIP_NOT_AUTHORIZED");
  assert.equal(verifyBookingPreconditions({ ...base, selectedOption: null }).reason, "NO_OPTION_SELECTED");
  assert.equal(verifyBookingPreconditions({ ...base, fundedAmount: 10 }).reason, "INSUFFICIENT_FUNDING");
  assert.equal(verifyBookingPreconditions({ ...base, tripBudget: 100 }).reason, "OVER_BUDGET");
});

// --- tool routing ------------------------------------------------------------

test("tool: a persisted trip routes execute_booking to the REAL path", async () => {
  const tripRepo = getTripRepository();
  const optionRepo = getFlightOptionRepository();
  const trip = await tripRepo.create(bookableTrip({ id: `t_tool_${Date.now()}` }));
  // null expiry keeps this clock-independent (the tool uses the real `now`).
  await optionRepo.replaceForTrip(trip.id, [bookableOption(trip.id, { id: `o_${trip.id}`, expiresAt: null })]);

  const r = (await executeBookingTool.invoke({ tripId: trip.id })) as { mode?: string; status?: string };
  // No DUFFEL_API_KEY in tests → the real path honestly reports it, proving the
  // trip took the REAL branch rather than the staged one.
  assert.equal(r.mode, "REAL");
  assert.equal(r.status, "PROVIDER_UNCONFIGURED");
});
