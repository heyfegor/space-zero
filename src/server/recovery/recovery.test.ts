/**
 * Space Zero — autonomous recovery tests (deterministic; no keys, no network).
 *
 * Covers the pure recovery evaluator and the recovery service over in-memory
 * repos + fake Duffel clients: permitted auto-recovery, authority denial,
 * insufficient funding, auto-recovery disabled, no-eligible-option escalation,
 * and provider failure — plus the search path, the workflow trigger, and the
 * execute_booking recovery routing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRecovery,
  connectionsFeasible,
  type RecoveryContext,
} from "../../domain/recovery";
import {
  runRecovery,
  searchRecoveryAlternatives,
  evaluateRecoveryOptions,
  type RecoveryDeps,
} from "./recovery-service";
import { triggerRecoveryWorkflow } from "./recovery-agent";
import { InMemoryTripRepository } from "../persistence/in-memory-trip-repository";
import { InMemoryFlightOptionRepository } from "../persistence/flight-option-repository";
import { InMemoryDisruptionRepository } from "../persistence/disruption-repository";
import { InMemoryRecoveryRepository } from "../persistence/recovery-repository";
import type { Trip } from "../../domain/trip";
import type { FlightOption, FlightSegment } from "../../domain/flight-option";
import type { Disruption } from "../../domain/disruption";
import type {
  DuffelBookingClient,
  DuffelClient,
  DuffelCreateOrderParams,
  DuffelOffer,
  DuffelOrder,
  DuffelSearchParams,
} from "../../providers/duffel";

const DEADLINE = "2026-09-05T21:00:00Z";
const NOW = new Date("2026-09-04T12:00:00Z");
const ORIGINAL_COST = 1468;

let seq = 0;
const makeId = () => `id_${++seq}`;

// --- fixtures ---------------------------------------------------------------

const BOOKED_SEGS: FlightSegment[] = [
  { from: "LHR", to: "SIN", departAt: "2026-09-04T21:00:00Z", arriveAt: "2026-09-05T14:00:00Z", carrier: "SQ", flightNumber: "SQ317" },
  { from: "SIN", to: "SYD", departAt: "2026-09-05T16:00:00Z", arriveAt: "2026-09-05T19:35:00Z", carrier: "SQ", flightNumber: "SQ231" },
];

function bookedTrip(over: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1", userId: "u1", status: "AT_RISK", brief: "b",
    origin: "London", destination: "Sydney", segments: [], arrivalDeadline: DEADLINE,
    currency: "GBP", tripBudget: 2000, recoveryAllowance: 150, checkedBags: 1,
    autoRebook: true, bookingStatus: "CONFIRMED", bookingReference: "SZ-4471",
    finalCost: ORIGINAL_COST, fundedAmount: 1600, selectedOptionId: "opt-booked",
    ...over,
  };
}

function bookedOption(): FlightOption {
  return {
    id: "opt-booked", tripId: "trip-1", providerOfferId: "off-booked", segments: BOOKED_SEGS,
    totalAmount: ORIGINAL_COST, currency: "GBP", durationMinutes: 1355, connections: 1,
    departAt: BOOKED_SEGS[0].departAt, arriveAt: BOOKED_SEGS[1].arriveAt,
    rank: 0, recommended: true, selected: true, expiresAt: null,
  };
}

/** A direct LHR→SYD alternative candidate (connections trivially feasible). */
function alt(over: Partial<FlightOption> = {}): FlightOption {
  return {
    id: over.id ?? "alt-1", tripId: "trip-1", providerOfferId: over.providerOfferId ?? "off-alt",
    segments: [{ from: "LHR", to: "SYD", departAt: "2026-09-04T22:00:00Z", arriveAt: over.arriveAt ?? "2026-09-05T18:00:00Z" }],
    totalAmount: over.totalAmount ?? 1550, currency: "GBP", durationMinutes: 1200, connections: 0,
    departAt: "2026-09-04T22:00:00Z", arriveAt: over.arriveAt ?? "2026-09-05T18:00:00Z",
    rank: over.rank ?? 0, recommended: true, selected: false, expiresAt: null, ...over,
  };
}

function disruption(): Disruption {
  return {
    id: "dis-1", tripId: "trip-1", type: "MISSED_CONNECTION", severity: "CRITICAL",
    threatensTrip: true, triggersRecovery: true, segmentIndex: 0, from: "LHR", to: "SIN",
    flightNumber: "SQ317", delayMinutes: 120, scheduledArriveAt: "2026-09-05T14:00:00Z",
    estimatedArriveAt: "2026-09-05T15:40:00Z", summary: "Connection at SIN no longer works",
    detail: "…", detectedAt: NOW.toISOString(),
  };
}

async function setup(trip: Trip) {
  const tripRepo = new InMemoryTripRepository();
  await tripRepo.create(trip);
  const optionRepo = new InMemoryFlightOptionRepository();
  await optionRepo.replaceForTrip(trip.id, [bookedOption()]);
  const disruptionRepo = new InMemoryDisruptionRepository();
  await disruptionRepo.add([disruption()]);
  const recoveryRepo = new InMemoryRecoveryRepository();
  return { tripRepo, optionRepo, disruptionRepo, recoveryRepo };
}

function fakeBooking(opts: { liveTotal?: number; getOfferThrows?: boolean; createThrows?: boolean; expires?: string } = {}): DuffelBookingClient {
  return {
    async getOffer(offerId: string): Promise<DuffelOffer | null> {
      if (opts.getOfferThrows) throw new Error("offer boom");
      return {
        id: offerId,
        total_amount: String(opts.liveTotal ?? 1550),
        total_currency: "GBP",
        expires_at: opts.expires ?? "2026-09-05T00:00:00Z",
        slices: [],
        passengers: [{ id: "pas_1", type: "adult" }],
      };
    },
    async createOrder(p: DuffelCreateOrderParams): Promise<DuffelOrder> {
      if (opts.createThrows) throw new Error("order boom");
      return { id: "ord_rec_1", booking_reference: "PNR-REC", total_amount: p.amount, total_currency: p.currency };
    },
  };
}

function deps(repos: Awaited<ReturnType<typeof setup>>, extra: Partial<RecoveryDeps> = {}): RecoveryDeps {
  return { ...repos, now: NOW, makeId, ...extra };
}

function ctx(over: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    arrivalRequirement: DEADLINE, originalCost: ORIGINAL_COST, recoveryAllowance: 150,
    fundedAmount: 1600, tripBudget: 2000, currency: "GBP", autoRecovery: true, ...over,
  };
}

// --- pure evaluator ---------------------------------------------------------

test("evaluator: within arrival, connection, authority, funding → AUTO_BOOK", () => {
  const e = evaluateRecovery([alt({ totalAmount: 1550 })], ctx());
  assert.equal(e.decision.kind, "AUTO_BOOK");
  assert.equal(e.best?.bookable, true);
  assert.equal(e.best?.additionalCost, 82);
});

test("evaluator: extra cost over the recovery allowance → ESCALATE OVER_ALLOWANCE", () => {
  const e = evaluateRecovery([alt({ totalAmount: 1700 })], ctx({ fundedAmount: 1800 }));
  assert.equal(e.decision.kind, "ESCALATE");
  assert.equal(e.decision.escalationReason, "OVER_ALLOWANCE");
  assert.equal(e.decision.overBy, 1700 - ORIGINAL_COST - 150);
});

test("evaluator: funds short of the alternative → ESCALATE INSUFFICIENT_FUNDING", () => {
  const e = evaluateRecovery([alt({ totalAmount: 1600 })], ctx({ fundedAmount: 1500 }));
  assert.equal(e.decision.kind, "ESCALATE");
  assert.equal(e.decision.escalationReason, "INSUFFICIENT_FUNDING");
});

test("evaluator: auto-recovery off → ESCALATE even when otherwise bookable", () => {
  const e = evaluateRecovery([alt({ totalAmount: 1550 })], ctx({ autoRecovery: false }));
  assert.equal(e.decision.kind, "ESCALATE");
  assert.equal(e.decision.escalationReason, "AUTO_RECOVERY_DISABLED");
});

test("evaluator: nothing meets the arrival requirement → NO_OPTION", () => {
  const e = evaluateRecovery([alt({ arriveAt: "2026-09-05T23:00:00Z" })], ctx());
  assert.equal(e.decision.kind, "NO_OPTION");
  assert.equal(e.best, null);
});

test("evaluator: an infeasible connection is not eligible", () => {
  const tight: FlightSegment[] = [
    { from: "LHR", to: "DXB", departAt: "2026-09-04T22:00:00Z", arriveAt: "2026-09-05T06:00:00Z" },
    { from: "DXB", to: "SYD", departAt: "2026-09-05T06:20:00Z", arriveAt: "2026-09-05T18:00:00Z" }, // 20m connection
  ];
  assert.equal(connectionsFeasible(tight, 45), false);
  const opt = alt({ segments: tight, connections: 1, arriveAt: "2026-09-05T18:00:00Z" });
  const e = evaluateRecovery([opt], ctx());
  assert.equal(e.best, null);
  assert.equal(e.decision.kind, "NO_OPTION");
});

// --- service: the six required scenarios ------------------------------------

test("recovery: permitted auto-recovery books and resolves the trip", async () => {
  const repos = await setup(bookedTrip());
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt({ totalAmount: 1550 })], booking: fakeBooking({ liveTotal: 1550 }) }));

  assert.equal(outcome.status, "recovered");
  assert.equal(outcome.tripStatus, "RESOLVED");
  assert.equal(outcome.recovery?.status, "RECOVERED");
  assert.equal(outcome.recovery?.bookingReference, "PNR-REC");
  assert.equal(outcome.recovery?.duffelOrderId, "ord_rec_1");
  assert.equal(outcome.recovery?.additionalCost, 82);

  const trip = await repos.tripRepo.getById("trip-1");
  assert.equal(trip!.status, "RESOLVED");
  assert.equal(trip!.duffelOrderId, "ord_rec_1");
  assert.equal(trip!.finalCost, 1550);
  assert.equal((await repos.recoveryRepo.latestForTrip("trip-1"))!.status, "RECOVERED");
});

test("recovery: authority denial escalates and does not book", async () => {
  const repos = await setup(bookedTrip({ fundedAmount: 1800 }));
  const booking = fakeBooking();
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt({ totalAmount: 1700 })], booking }));

  assert.equal(outcome.status, "escalated");
  assert.equal(outcome.recovery?.status, "ESCALATED");
  assert.equal(outcome.recovery?.escalationReason, "OVER_ALLOWANCE");
  const trip = await repos.tripRepo.getById("trip-1");
  assert.equal(trip!.status, "AT_RISK"); // untouched
  assert.equal(trip!.duffelOrderId ?? null, null);
});

test("recovery: insufficient funding escalates and does not book", async () => {
  const repos = await setup(bookedTrip({ fundedAmount: 1500 }));
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt({ totalAmount: 1600 })], booking: fakeBooking() }));

  assert.equal(outcome.status, "escalated");
  assert.equal(outcome.recovery?.escalationReason, "INSUFFICIENT_FUNDING");
  assert.equal((await repos.tripRepo.getById("trip-1"))!.status, "AT_RISK");
});

test("recovery: auto-recovery disabled escalates for approval", async () => {
  const repos = await setup(bookedTrip({ autoRebook: false }));
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt({ totalAmount: 1550 })], booking: fakeBooking() }));

  assert.equal(outcome.status, "escalated");
  assert.equal(outcome.recovery?.escalationReason, "AUTO_RECOVERY_DISABLED");
  assert.equal((await repos.tripRepo.getById("trip-1"))!.status, "AT_RISK");
});

test("recovery: no eligible option escalates (nothing meets the deadline)", async () => {
  const repos = await setup(bookedTrip());
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt({ arriveAt: "2026-09-05T23:30:00Z" })], booking: fakeBooking() }));

  assert.equal(outcome.status, "escalated");
  assert.equal(outcome.recovery?.escalationReason, "NO_ELIGIBLE_OPTION");
  assert.equal((await repos.tripRepo.getById("trip-1"))!.status, "AT_RISK");
});

test("recovery: provider failure during booking is honest, books nothing", async () => {
  const repos = await setup(bookedTrip());
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt({ totalAmount: 1550 })], booking: fakeBooking({ getOfferThrows: true }) }));

  assert.equal(outcome.status, "provider_error");
  assert.equal(outcome.recovery, undefined);
  const trip = await repos.tripRepo.getById("trip-1");
  assert.equal(trip!.status, "AT_RISK"); // no state advance
  assert.equal((await repos.recoveryRepo.listForTrip("trip-1")).length, 0);
});

test("recovery: order failure records FAILED and does not resolve", async () => {
  const repos = await setup(bookedTrip());
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt({ totalAmount: 1550 })], booking: fakeBooking({ createThrows: true }) }));
  assert.equal(outcome.status, "provider_error");
  const trip = await repos.tripRepo.getById("trip-1");
  assert.equal(trip!.status, "AT_RISK");
  assert.equal(trip!.bookingStatus, "FAILED");
});

// --- service: guards + re-price ---------------------------------------------

test("recovery: a live re-price beyond authority escalates instead of overspending", async () => {
  const repos = await setup(bookedTrip({ fundedAmount: 1800 }));
  // Candidate looks within allowance (+82) but the provider re-prices to +300.
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt({ totalAmount: 1550 })], booking: fakeBooking({ liveTotal: 1768 }) }));
  assert.equal(outcome.status, "escalated");
  assert.equal(outcome.recovery?.escalationReason, "OVER_ALLOWANCE");
  assert.equal((await repos.tripRepo.getById("trip-1"))!.status, "AT_RISK");
});

test("recovery: not_at_risk for a trip that is not disrupted", async () => {
  const repos = await setup(bookedTrip({ status: "MONITORING" }));
  const outcome = await runRecovery("trip-1", deps(repos, { candidates: [alt()], booking: fakeBooking() }));
  assert.equal(outcome.status, "not_at_risk");
});

test("recovery: trip_not_found for an unknown id", async () => {
  const repos = await setup(bookedTrip());
  const outcome = await runRecovery("missing", deps(repos, { candidates: [alt()], booking: fakeBooking() }));
  assert.equal(outcome.status, "trip_not_found");
});

// --- search path ------------------------------------------------------------

function fakeDuffel(offers: DuffelOffer[] | "throw"): DuffelClient {
  return {
    async searchOffers(_p: DuffelSearchParams) {
      if (offers === "throw") throw new Error("search boom");
      return offers;
    },
  };
}

function offer(id: string, amount: string, arr: string): DuffelOffer {
  return {
    id, total_amount: amount, total_currency: "GBP", expires_at: "2026-09-05T00:00:00Z",
    slices: [{ segments: [{ origin: { iata_code: "LHR" }, destination: { iata_code: "SYD" }, departing_at: "2026-09-04T22:00:00Z", arriving_at: arr }] }],
  };
}

test("search: provider unconfigured → honest state, nothing invented", async () => {
  const repos = await setup(bookedTrip());
  const r = await searchRecoveryAlternatives("trip-1", { ...repos });
  assert.equal(r.status, "provider_unconfigured");
  assert.equal(r.candidates.length, 0);
});

test("search: ranks and returns alternatives; evaluate then uses them", async () => {
  const repos = await setup(bookedTrip());
  const duffel = fakeDuffel([offer("off_a", "1550.00", "2026-09-05T18:00:00Z")]);
  const r = await searchRecoveryAlternatives("trip-1", { ...repos, duffel, makeId });
  assert.equal(r.status, "ok");
  assert.equal(r.candidates.length, 1);

  const evaln = await evaluateRecoveryOptions("trip-1", { ...repos, candidates: r.candidates });
  assert.equal(evaln!.evaluation.decision.kind, "AUTO_BOOK");
});

test("search: provider error surfaces (no fabrication)", async () => {
  const repos = await setup(bookedTrip());
  const r = await searchRecoveryAlternatives("trip-1", { ...repos, duffel: fakeDuffel("throw"), makeId });
  assert.equal(r.status, "provider_error");
  assert.equal(r.candidates.length, 0);
});

test("runRecovery: searches when no candidates are supplied (end to end)", async () => {
  const repos = await setup(bookedTrip());
  const duffel = fakeDuffel([offer("off_a", "1550.00", "2026-09-05T18:00:00Z")]);
  const outcome = await runRecovery("trip-1", deps(repos, { duffel, booking: fakeBooking({ liveTotal: 1550 }) }));
  assert.equal(outcome.status, "recovered");
  assert.equal((await repos.tripRepo.getById("trip-1"))!.status, "RESOLVED");
});

// --- workflow trigger -------------------------------------------------------

test("trigger: deterministicOnly completes recovery through the choke point", async () => {
  const repos = await setup(bookedTrip());
  const duffel = fakeDuffel([offer("off_a", "1550.00", "2026-09-05T18:00:00Z")]);
  const outcome = await triggerRecoveryWorkflow("trip-1", {
    ...deps(repos, { duffel, booking: fakeBooking({ liveTotal: 1550 }) }),
    deterministicOnly: true,
  });
  assert.equal(outcome.status, "recovered");
  assert.equal((await repos.tripRepo.getById("trip-1"))!.status, "RESOLVED");
});

test("trigger: uses the injected agent runner when provided", async () => {
  const repos = await setup(bookedTrip());
  let ran = false;
  // The injected agent 'runs' by booking through the deterministic choke point.
  const outcome = await triggerRecoveryWorkflow("trip-1", {
    recoveryRepo: repos.recoveryRepo,
    runAgent: async (tripId: string) => {
      ran = true;
      await runRecovery(tripId, deps(repos, { candidates: [alt({ totalAmount: 1550 })], booking: fakeBooking({ liveTotal: 1550 }) }));
    },
  });
  assert.equal(ran, true);
  assert.equal(outcome.status, "recovered");
  assert.equal(outcome.recovery?.status, "RECOVERED");
});
