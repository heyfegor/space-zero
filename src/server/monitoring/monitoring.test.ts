/**
 * Space Zero — flight monitoring tests (deterministic; no provider key, no network).
 *
 * Covers the pure disruption detector, the monitoring service over a fake
 * flight-status provider + in-memory repos (normal status, delay, connection
 * failure, cancellation, arrival breach), disruption persistence + the
 * operational event + state transition, provider failure/unconfigured, and the
 * persisted monitoring view.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { assessDisruption, type MonitoredSegment } from "../../domain/disruption";
import {
  monitorTrip,
  getMonitoringView,
  type MonitorDeps,
} from "./monitoring-service";
import { InMemoryTripRepository } from "../persistence/in-memory-trip-repository";
import { InMemoryFlightOptionRepository } from "../persistence/flight-option-repository";
import { InMemoryDisruptionRepository } from "../persistence/disruption-repository";
import {
  rowToDisruption,
  disruptionToInsertRow,
  type DisruptionRow,
} from "../persistence/disruption-row";
import {
  normalizeAeroApiResponse,
  type FlightStatusProvider,
  type FlightStatusQuery,
  type ProviderFlightStatus,
} from "../../providers/flight-status";
import { fixtureFlightAwareProvider, rawResponsesFor } from "./flightaware-fixtures";
import type { Trip } from "../../domain/trip";
import type { FlightOption, FlightSegment } from "../../domain/flight-option";

// --- fixtures ---------------------------------------------------------------

let seq = 0;
const makeId = () => `dis_${++seq}`;

const DEADLINE = "2026-09-05T21:00:00Z";

const SEG1: FlightSegment = {
  from: "LHR",
  to: "SIN",
  departAt: "2026-09-04T21:00:00Z",
  arriveAt: "2026-09-05T14:00:00Z",
  carrier: "SQ",
  flightNumber: "SQ317",
};
const SEG2: FlightSegment = {
  from: "SIN",
  to: "SYD",
  departAt: "2026-09-05T16:00:00Z",
  arriveAt: "2026-09-05T19:35:00Z",
  carrier: "SQ",
  flightNumber: "SQ231",
};

function bookedTrip(over: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    userId: "u1",
    status: "CONFIRMED",
    brief: "b",
    origin: "London",
    destination: "Sydney",
    segments: [],
    arrivalDeadline: DEADLINE,
    currency: "GBP",
    tripBudget: 2000,
    recoveryAllowance: 150,
    checkedBags: 1,
    autoRebook: true,
    bookingStatus: "CONFIRMED",
    bookingReference: "SZ-4471",
    selectedOptionId: "opt-1",
    ...over,
  };
}

function bookedOption(over: Partial<FlightOption> = {}): FlightOption {
  return {
    id: "opt-1",
    tripId: "trip-1",
    providerOfferId: "off-1",
    segments: [SEG1, SEG2],
    totalAmount: 1468,
    currency: "GBP",
    durationMinutes: 1355,
    connections: 1,
    departAt: SEG1.departAt,
    arriveAt: SEG2.arriveAt,
    rank: 0,
    recommended: true,
    selected: true,
    expiresAt: null,
    ...over,
  };
}

type Override = Partial<ProviderFlightStatus>;

/** Fake provider keyed by "FROM-TO"; on-time by default, override per leg. */
function fakeProvider(overrides: Record<string, Override> = {}): FlightStatusProvider {
  const scheduled: Record<string, { dep: string; arr: string }> = {
    "LHR-SIN": { dep: SEG1.departAt, arr: SEG1.arriveAt },
    "SIN-SYD": { dep: SEG2.departAt, arr: SEG2.arriveAt },
  };
  return {
    async getFlightStatus(q: FlightStatusQuery): Promise<ProviderFlightStatus | null> {
      const key = `${q.from}-${q.to}`;
      const s = scheduled[key];
      if (!s) return null;
      return {
        status: "SCHEDULED",
        cancelled: false,
        diverted: false,
        scheduledDepartAt: s.dep,
        estimatedDepartAt: null,
        scheduledArriveAt: s.arr,
        estimatedArriveAt: null,
        ...overrides[key],
      };
    },
  };
}

function throwingProvider(): FlightStatusProvider {
  return {
    async getFlightStatus() {
      throw new Error("provider boom");
    },
  };
}

async function setup(trip: Trip, option: FlightOption | null) {
  const tripRepo = new InMemoryTripRepository();
  await tripRepo.create(trip);
  const optionRepo = new InMemoryFlightOptionRepository();
  if (option) await optionRepo.replaceForTrip(trip.id, [option]);
  const disruptionRepo = new InMemoryDisruptionRepository();
  return { tripRepo, optionRepo, disruptionRepo };
}

function deps(
  provider: FlightStatusProvider,
  repos: Awaited<ReturnType<typeof setup>>,
): MonitorDeps {
  return {
    provider,
    tripRepo: repos.tripRepo,
    optionRepo: repos.optionRepo,
    disruptionRepo: repos.disruptionRepo,
    now: new Date("2026-09-04T12:00:00Z"),
    makeId,
  };
}

// --- pure detector ----------------------------------------------------------

function seg(over: Partial<MonitoredSegment>): MonitoredSegment {
  return {
    index: 0,
    from: "LHR",
    to: "SIN",
    flightNumber: "SQ317",
    status: "SCHEDULED",
    cancelled: false,
    diverted: false,
    scheduledDepartAt: SEG1.departAt,
    scheduledArriveAt: SEG1.arriveAt,
    estimatedDepartAt: null,
    estimatedArriveAt: null,
    ...over,
  };
}

test("detector: on-time, connected, before deadline → no threat", () => {
  const a = assessDisruption(
    [seg({ index: 0 }), seg({ index: 1, from: "SIN", to: "SYD", scheduledDepartAt: SEG2.departAt, scheduledArriveAt: SEG2.arriveAt })],
    { arrivalDeadline: DEADLINE },
  );
  assert.equal(a.threatened, false);
  assert.equal(a.disruptions.length, 0);
});

test("detector: cancellation always threatens", () => {
  const a = assessDisruption([seg({ cancelled: true, status: "CANCELLED" })], { arrivalDeadline: DEADLINE });
  assert.equal(a.threatened, true);
  assert.equal(a.disruptions[0].type, "CANCELLATION");
  assert.equal(a.disruptions[0].severity, "CRITICAL");
});

test("detector: delay eating the connection → MISSED_CONNECTION", () => {
  const a = assessDisruption(
    [
      seg({ index: 0, estimatedArriveAt: "2026-09-05T15:30:00Z" }), // 90m late; leaves 30m
      seg({ index: 1, from: "SIN", to: "SYD", scheduledDepartAt: SEG2.departAt, scheduledArriveAt: SEG2.arriveAt }),
    ],
    { arrivalDeadline: DEADLINE, minConnectionMinutes: 45 },
  );
  assert.equal(a.threatened, true);
  assert.equal(a.disruptions[0].type, "MISSED_CONNECTION");
  assert.equal(a.disruptions[0].segmentIndex, 0);
});

test("detector: final-leg slip past the deadline → ARRIVAL_BREACH", () => {
  const a = assessDisruption(
    [
      seg({ index: 0 }),
      seg({ index: 1, from: "SIN", to: "SYD", scheduledDepartAt: SEG2.departAt, scheduledArriveAt: SEG2.arriveAt, estimatedArriveAt: "2026-09-05T22:00:00Z" }),
    ],
    { arrivalDeadline: DEADLINE },
  );
  assert.equal(a.threatened, true);
  assert.equal(a.disruptions[0].type, "ARRIVAL_BREACH");
});

test("detector: small slip within limits → informational DELAY, no threat", () => {
  const a = assessDisruption(
    [
      seg({ index: 0 }),
      seg({ index: 1, from: "SIN", to: "SYD", scheduledDepartAt: SEG2.departAt, scheduledArriveAt: SEG2.arriveAt, estimatedArriveAt: "2026-09-05T20:15:00Z" }), // 40m late, before deadline
    ],
    { arrivalDeadline: DEADLINE },
  );
  assert.equal(a.threatened, false);
  assert.equal(a.disruptions.length, 1);
  assert.equal(a.disruptions[0].type, "DELAY");
  assert.equal(a.disruptions[0].threatensTrip, false);
});

test("detector: no deadline known → arrival breach not asserted, connection still checked", () => {
  const a = assessDisruption(
    [seg({ index: 1, from: "SIN", to: "SYD", scheduledDepartAt: SEG2.departAt, scheduledArriveAt: SEG2.arriveAt, estimatedArriveAt: "2026-09-06T05:00:00Z" })],
    { arrivalDeadline: null },
  );
  // Late final leg but no requirement to breach → a DELAY, not an ARRIVAL_BREACH.
  assert.equal(a.disruptions.some((d) => d.type === "ARRIVAL_BREACH"), false);
});

// --- service: normal status -------------------------------------------------

test("monitor: normal status → ok, no disruptions, CONFIRMED → MONITORING", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const outcome = await monitorTrip("trip-1", deps(fakeProvider(), repos));
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.threatened, false);
  assert.equal(outcome.disruptions.length, 0);
  assert.equal(outcome.segments.length, 2);
  assert.equal(outcome.tripStatus, "MONITORING"); // monitoring has begun
  assert.equal(outcome.operationalEvent, undefined);
  assert.equal((await repos.disruptionRepo.listForTrip("trip-1")).length, 0);
});

// --- service: delay detection (arrival breach) ------------------------------

test("monitor: delay past the deadline → disrupted (ARRIVAL_BREACH)", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const provider = fakeProvider({ "SIN-SYD": { estimatedArriveAt: "2026-09-05T22:30:00Z", status: "DELAYED" } });
  const outcome = await monitorTrip("trip-1", deps(provider, repos));
  assert.equal(outcome.status, "disrupted");
  assert.equal(outcome.threatened, true);
  assert.equal(outcome.disruptions[0].type, "ARRIVAL_BREACH");
  assert.ok(outcome.disruptions[0].delayMinutes > 0);
});

// --- service: recovery hand-off ---------------------------------------------

test("monitor: triggers the recovery hand-off once, on a NEW threatening disruption", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const provider = fakeProvider({ "LHR-SIN": { estimatedArriveAt: "2026-09-05T15:40:00Z", status: "DELAYED" } });

  const events: Array<{ type: string; tripId: string }> = [];
  const outcome = await monitorTrip("trip-1", { ...deps(provider, repos), onDisruption: (e) => { events.push(e); } });
  assert.equal(outcome.status, "disrupted");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "DISRUPTION_DETECTED");
  assert.equal(events[0].tripId, "trip-1");

  // A re-poll of the same (already-known) disruption does not re-trigger.
  const again: Array<{ type: string }> = [];
  await monitorTrip("trip-1", { ...deps(provider, repos), onDisruption: (e) => { again.push(e); } });
  assert.equal(again.length, 0);
});

test("monitor: a normal pass does not trigger recovery", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  let called = 0;
  await monitorTrip("trip-1", { ...deps(fakeProvider(), repos), onDisruption: () => { called += 1; } });
  assert.equal(called, 0);
});

// --- service: connection failure --------------------------------------------

test("monitor: broken connection → disrupted, trip AT_RISK, operational event", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const provider = fakeProvider({ "LHR-SIN": { estimatedArriveAt: "2026-09-05T15:40:00Z", status: "DELAYED" } });
  const outcome = await monitorTrip("trip-1", deps(provider, repos));

  assert.equal(outcome.status, "disrupted");
  assert.equal(outcome.threatened, true);
  assert.equal(outcome.disruptions[0].type, "MISSED_CONNECTION");
  assert.equal(outcome.tripStatus, "AT_RISK"); // deterministic transition
  assert.ok(outcome.operationalEvent);
  assert.equal(outcome.operationalEvent!.type, "DISRUPTION_DETECTED");
  assert.equal(outcome.operationalEvent!.triggersRecovery, true);
  assert.equal(outcome.operationalEvent!.tripStatusAfter, "AT_RISK");
  assert.equal(outcome.operationalEvent!.disruptionId, outcome.disruptions[0].id);

  // The trip really moved to AT_RISK in the store (the recovery flow's signal).
  const trip = await repos.tripRepo.getById("trip-1");
  assert.equal(trip!.status, "AT_RISK");
});

// --- service: disruption persistence + dedupe -------------------------------

test("monitor: persists the disruption and does not duplicate on re-poll", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const provider = fakeProvider({ "LHR-SIN": { estimatedArriveAt: "2026-09-05T15:40:00Z", status: "DELAYED" } });

  const first = await monitorTrip("trip-1", deps(provider, repos));
  assert.equal(first.disruptions.length, 1);
  const stored = await repos.disruptionRepo.listForTrip("trip-1");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].type, "MISSED_CONNECTION");
  assert.equal(stored[0].triggersRecovery, true);
  assert.equal(stored[0].tripId, "trip-1");

  // Re-poll: same disruption is not persisted twice; still surfaced as threatened.
  const second = await monitorTrip("trip-1", deps(provider, repos));
  assert.equal(second.status, "disrupted");
  assert.equal(second.disruptions.length, 0); // nothing NEW persisted
  assert.equal((await repos.disruptionRepo.listForTrip("trip-1")).length, 1);
  assert.ok(second.operationalEvent); // still points at the on-record disruption
});

test("monitor: cancellation is detected, persisted, and threatening", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const provider = fakeProvider({ "LHR-SIN": { cancelled: true, status: "CANCELLED" } });
  const outcome = await monitorTrip("trip-1", deps(provider, repos));
  assert.equal(outcome.status, "disrupted");
  assert.equal(outcome.disruptions[0].type, "CANCELLATION");
  assert.equal((await repos.disruptionRepo.listForTrip("trip-1"))[0].type, "CANCELLATION");
});

// --- service: provider failure (no fabrication) -----------------------------

test("monitor: provider failure → provider_error, nothing persisted, no state change", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const outcome = await monitorTrip("trip-1", deps(throwingProvider(), repos));
  assert.equal(outcome.status, "provider_error");
  assert.equal(outcome.threatened, false);
  assert.equal(outcome.disruptions.length, 0);
  assert.equal((await repos.disruptionRepo.listForTrip("trip-1")).length, 0);
  const trip = await repos.tripRepo.getById("trip-1");
  assert.equal(trip!.status, "CONFIRMED"); // untouched
});

// --- service: honest unavailable + guards -----------------------------------

test("monitor: provider unconfigured → honest unavailable, nothing invented", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  // No provider injected and no key set in tests → unconfigured.
  const outcome = await monitorTrip("trip-1", {
    tripRepo: repos.tripRepo,
    optionRepo: repos.optionRepo,
    disruptionRepo: repos.disruptionRepo,
    makeId,
  });
  assert.equal(outcome.status, "provider_unconfigured");
  assert.equal(outcome.segments.length, 0);
  assert.equal(outcome.disruptions.length, 0);
});

test("monitor: not_booked when the trip has no confirmed booking", async () => {
  const repos = await setup(bookedTrip({ status: "READY", bookingStatus: undefined }), bookedOption());
  const outcome = await monitorTrip("trip-1", deps(fakeProvider(), repos));
  assert.equal(outcome.status, "not_booked");
});

test("monitor: trip_not_found for an unknown id", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const outcome = await monitorTrip("missing", deps(fakeProvider(), repos));
  assert.equal(outcome.status, "trip_not_found");
});

// --- persisted monitoring view ----------------------------------------------

test("view: reports monitored + persisted disruptions (no provider call)", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const provider = fakeProvider({ "LHR-SIN": { estimatedArriveAt: "2026-09-05T15:40:00Z", status: "DELAYED" } });
  await monitorTrip("trip-1", deps(provider, repos));

  const view = await getMonitoringView("trip-1", {
    tripRepo: repos.tripRepo,
    optionRepo: repos.optionRepo,
    disruptionRepo: repos.disruptionRepo,
    providerConfigured: false,
  });
  assert.ok(view);
  assert.equal(view!.monitored, true);
  assert.equal(view!.providerConfigured, false); // honest unavailable
  assert.equal(view!.threatened, true);
  assert.equal(view!.disruptions.length, 1);
  assert.equal(view!.tripStatus, "AT_RISK");
  assert.ok(view!.lastDisruptionAt);
});

test("view: null for an unknown trip", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const view = await getMonitoringView("nope", { tripRepo: repos.tripRepo, optionRepo: repos.optionRepo, disruptionRepo: repos.disruptionRepo });
  assert.equal(view, null);
});

// --- row mapper -------------------------------------------------------------

// --- raw AeroAPI normalization (the real normalizer over fixture responses) --

const Q = { from: "LHR", to: "SIN", departureDate: "2026-09-04" };

test("normalize: scheduled flight → SCHEDULED, on-time estimates", () => {
  const raw = rawResponsesFor("on_time")["LHR-SIN"];
  const n = normalizeAeroApiResponse(raw, Q)!;
  assert.equal(n.status, "SCHEDULED");
  assert.equal(n.cancelled, false);
  assert.equal(n.diverted, false);
  // Picks the leg on the requested date, not the previous-day decoy.
  assert.equal(n.scheduledDepartAt, "2026-09-04T21:00:00Z");
});

test("normalize: delayed flight → DELAYED with the provider estimate", () => {
  const raw = rawResponsesFor("missed_connection")["LHR-SIN"];
  const n = normalizeAeroApiResponse(raw, Q)!;
  assert.equal(n.status, "DELAYED");
  assert.equal(n.estimatedArriveAt, "2026-09-05T15:40:00Z");
});

test("normalize: cancelled flight → CANCELLED", () => {
  const n = normalizeAeroApiResponse(rawResponsesFor("cancelled")["LHR-SIN"], Q)!;
  assert.equal(n.status, "CANCELLED");
  assert.equal(n.cancelled, true);
});

test("normalize: diverted flight → DIVERTED", () => {
  const n = normalizeAeroApiResponse(rawResponsesFor("diverted")["LHR-SIN"], Q)!;
  assert.equal(n.status, "DIVERTED");
  assert.equal(n.diverted, true);
});

test("normalize: departed flight (actual_out) → ACTIVE", () => {
  const n = normalizeAeroApiResponse(rawResponsesFor("departed")["LHR-SIN"], Q)!;
  assert.equal(n.status, "ACTIVE");
  assert.equal(n.estimatedDepartAt, "2026-09-04T21:05:00Z");
});

test("normalize: arrived flight (actual_in) → LANDED", () => {
  const n = normalizeAeroApiResponse(rawResponsesFor("arrived")["LHR-SIN"], Q)!;
  assert.equal(n.status, "LANDED");
  assert.equal(n.estimatedArriveAt, "2026-09-05T13:55:00Z");
});

test("normalize: empty flights → null (never fabricate a status)", () => {
  assert.equal(normalizeAeroApiResponse({ flights: [] }, Q), null);
});

// --- deterministic demo path: fixture raw response → full pipeline -----------

test("demo path: fixture CANCELLED response → normalize → detect → AT_RISK → recovery hand-off", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const provider = fixtureFlightAwareProvider("cancelled"); // real normalization, canned raw input

  const events: Array<{ type: string; tripId: string }> = [];
  const outcome = await monitorTrip("trip-1", {
    ...deps(provider, repos),
    onDisruption: (e) => { events.push(e); }, // the existing recovery hand-off point
  });

  // Detected deterministically from the fixture, not decided by the provider.
  assert.equal(outcome.status, "disrupted");
  assert.equal(outcome.disruptions[0].type, "CANCELLATION");
  assert.equal(outcome.tripStatus, "AT_RISK");
  assert.ok(outcome.operationalEvent);
  assert.equal(outcome.operationalEvent!.triggersRecovery, true);

  // The trip really moved to AT_RISK and the recovery workflow was handed off once.
  assert.equal((await repos.tripRepo.getById("trip-1"))!.status, "AT_RISK");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "DISRUPTION_DETECTED");

  // No fabricated recovery/RESOLVED — monitoring only hands off; it never resolves.
  assert.notEqual(outcome.tripStatus, "RESOLVED");
});

test("demo path: fixture ARRIVAL_BREACH response → deterministic ARRIVAL_BREACH, AT_RISK", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  const outcome = await monitorTrip("trip-1", deps(fixtureFlightAwareProvider("arrival_breach"), repos));
  assert.equal(outcome.status, "disrupted");
  assert.equal(outcome.disruptions[0].type, "ARRIVAL_BREACH");
  assert.equal(outcome.tripStatus, "AT_RISK");
});

test("demo path: fixture ON_TIME response → ok, no disruption, no recovery", async () => {
  const repos = await setup(bookedTrip(), bookedOption());
  let called = 0;
  const outcome = await monitorTrip("trip-1", {
    ...deps(fixtureFlightAwareProvider("on_time"), repos),
    onDisruption: () => { called += 1; },
  });
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.threatened, false);
  assert.equal(called, 0);
});

test("mapper: disruption row round-trips through the domain", () => {
  const row: DisruptionRow = {
    id: "d1", trip_id: "t1", type: "MISSED_CONNECTION", severity: "CRITICAL",
    threatens_trip: true, triggers_recovery: true, segment_index: 0,
    origin: "LHR", destination: "SIN", flight_number: "SQ317", delay_minutes: 100,
    scheduled_arrive_at: "2026-09-05T14:00:00Z", estimated_arrive_at: "2026-09-05T15:40:00Z",
    summary: "Connection at SIN no longer works", detail: "…", detected_at: "2026-09-04T12:00:00Z",
    created_at: "2026-09-04T12:00:00Z",
  };
  const d = rowToDisruption(row);
  assert.equal(d.type, "MISSED_CONNECTION");
  assert.equal(d.threatensTrip, true);
  assert.equal(d.from, "LHR");
  const back = disruptionToInsertRow(d);
  assert.equal(back.type, "MISSED_CONNECTION");
  assert.equal(back.origin, "LHR");
  assert.equal(back.triggers_recovery, true);
});
