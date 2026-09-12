/**
 * Space Zero — disruption LIFECYCLE integration tests (deterministic; no keys, no network).
 *
 * These drive the WHOLE chain end to end, through the existing components, over a
 * single shared in-memory persistence layer — never a second orchestration path:
 *
 *   monitorTrip (real flight-status observation)
 *     → deterministic detection persists a Disruption + advances CONFIRMED→AT_RISK
 *     → onDisruption hands off to triggerRecoveryWorkflow (the SAME entry the
 *       /monitor route uses; deterministicOnly = the choke point, no model key)
 *     → searchRecoveryAlternatives queries the (faked) Duffel provider + ranks
 *     → evaluateRecovery applies arrival / connection / allowance / funding / budget
 *       / auto-recovery checks deterministically
 *     → runRecovery books ONLY a permitted option through the provider (getOffer
 *       re-price re-check → createOrder), else records an escalation
 *     → persist trip state + recovery outcome
 *
 * After each flow we RE-READ getMonitoringView from the same repos to prove the
 * Disruption/Resolution/Trips screens read real persisted state and that a refresh
 * preserves it. recoveryOutcomeEvents is checked to confirm only user-safe
 * OPERATIONAL stages are streamed — never chain-of-thought.
 *
 * Covers: (1) permitted → resolved, (2) allowance exceeded → escalated,
 * (3) insufficient funding → escalated, (4) provider failure → honest failure.
 * The £96/£181 STAGED demo determinism is asserted against the seeded demo trips.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { monitorTrip, getMonitoringView } from "../monitoring/monitoring-service";
import { triggerRecoveryWorkflow, recoveryOutcomeEvents } from "./recovery-agent";
import { InMemoryTripRepository } from "../persistence/in-memory-trip-repository";
import { InMemoryFlightOptionRepository } from "../persistence/flight-option-repository";
import { InMemoryDisruptionRepository } from "../persistence/disruption-repository";
import { InMemoryRecoveryRepository } from "../persistence/recovery-repository";
import { executeBookingTool } from "../tools/execute-booking";
import {
  DEMO_TRIP_ID,
  DEMO_TRIP_OVER_LIMIT_ID,
  resetDemoTrip,
  getTripById,
} from "../tools/dev-store";
import { stagedBookingReference } from "../../domain/booking";
import type { Trip } from "../../domain/trip";
import type { FlightOption, FlightSegment } from "../../domain/flight-option";
import type { FlightStatusProvider } from "../../providers/flight-status";
import type {
  DuffelBookingClient,
  DuffelClient,
  DuffelCreateOrderParams,
  DuffelOffer,
  DuffelOrder,
} from "../../providers/duffel";

const DEADLINE = "2026-09-05T21:00:00Z";
const NOW = new Date("2026-09-04T12:00:00Z");
const ORIGINAL_COST = 1468;

let seq = 0;
const makeId = () => `id_${++seq}`;

// --- fixtures ---------------------------------------------------------------

/** The booked LHR→SIN→SYD itinerary; a 120-min SIN connection when on schedule. */
const BOOKED_SEGS: FlightSegment[] = [
  { from: "LHR", to: "SIN", departAt: "2026-09-04T21:00:00Z", arriveAt: "2026-09-05T14:00:00Z", carrier: "SQ", flightNumber: "SQ317" },
  { from: "SIN", to: "SYD", departAt: "2026-09-05T16:00:00Z", arriveAt: "2026-09-05T19:35:00Z", carrier: "SQ", flightNumber: "SQ231" },
];

/**
 * A CONFIRMED, monitored trip (not yet disrupted). Monitoring will advance it.
 * Each scenario uses a DISTINCT id: runRecovery caches search candidates in a
 * process-global map keyed by trip id (as in production, where trips are
 * distinct), so sharing an id across tests would leak one search into the next.
 */
function monitoredTrip(id: string, over: Partial<Trip> = {}): Trip {
  return {
    id, userId: "u1", status: "CONFIRMED", brief: "b",
    origin: "London", destination: "Sydney", segments: [], arrivalDeadline: DEADLINE,
    currency: "GBP", tripBudget: 2000, recoveryAllowance: 150, checkedBags: 1,
    autoRebook: true, bookingStatus: "CONFIRMED", bookingReference: "SZ-4471",
    finalCost: ORIGINAL_COST, fundedAmount: 1600, selectedOptionId: "opt-booked",
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

/**
 * A flight-status provider that delays the LHR→SIN leg so it lands 15:40 — 20 min
 * before the SIN→SYD departs at 16:00, under the 45-min minimum. The DETERMINISTIC
 * detector (not the provider) then raises a threatening MISSED_CONNECTION.
 */
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
      return null; // SIN→SYD: no change, detector uses the booked schedule.
    },
  };
}

/** A search provider returning one direct LHR→SYD alternative at the given fare. */
function fakeDuffelSearch(amount: string, arriveAt = "2026-09-05T18:00:00Z"): DuffelClient {
  return {
    async searchOffers(): Promise<DuffelOffer[]> {
      return [
        {
          id: "off_alt", total_amount: amount, total_currency: "GBP", expires_at: "2026-09-05T00:00:00Z",
          slices: [
            {
              segments: [
                {
                  origin: { iata_code: "LHR" },
                  destination: { iata_code: "SYD" },
                  departing_at: "2026-09-04T22:00:00Z",
                  arriving_at: arriveAt,
                },
              ],
            },
          ],
        },
      ];
    },
  };
}

function fakeBooking(opts: { liveTotal?: number; getOfferThrows?: boolean; createThrows?: boolean } = {}): DuffelBookingClient {
  return {
    async getOffer(offerId: string): Promise<DuffelOffer | null> {
      if (opts.getOfferThrows) throw new Error("offer boom");
      return {
        id: offerId, total_amount: String(opts.liveTotal ?? 1550), total_currency: "GBP",
        expires_at: "2026-09-05T00:00:00Z", slices: [], passengers: [{ id: "pas_1", type: "adult" }],
      };
    },
    async createOrder(p: DuffelCreateOrderParams): Promise<DuffelOrder> {
      if (opts.createThrows) throw new Error("order boom");
      return { id: "ord_rec_1", booking_reference: "PNR-REC", total_amount: p.amount, total_currency: p.currency };
    },
  };
}

type Repos = {
  tripRepo: InMemoryTripRepository;
  optionRepo: InMemoryFlightOptionRepository;
  disruptionRepo: InMemoryDisruptionRepository;
  recoveryRepo: InMemoryRecoveryRepository;
};

async function setup(trip: Trip): Promise<Repos> {
  const tripRepo = new InMemoryTripRepository();
  await tripRepo.create(trip);
  const optionRepo = new InMemoryFlightOptionRepository();
  await optionRepo.replaceForTrip(trip.id, [bookedOption(trip.id)]);
  const disruptionRepo = new InMemoryDisruptionRepository();
  const recoveryRepo = new InMemoryRecoveryRepository();
  return { tripRepo, optionRepo, disruptionRepo, recoveryRepo };
}

/**
 * Drive monitoring with the recovery hand-off wired EXACTLY as POST /monitor does:
 * onDisruption → triggerRecoveryWorkflow(deterministicOnly). Provider/Duffel are
 * faked and repos are shared, so the whole existing pipeline runs with no key.
 */
async function runLifecycle(
  tripId: string,
  repos: Repos,
  wiring: { provider: FlightStatusProvider; duffel?: DuffelClient; booking?: DuffelBookingClient },
) {
  let recovery: Awaited<ReturnType<typeof triggerRecoveryWorkflow>> | undefined;
  const monitor = await monitorTrip(tripId, {
    provider: wiring.provider,
    ...repos,
    now: NOW,
    makeId,
    onDisruption: async () => {
      recovery = await triggerRecoveryWorkflow(tripId, {
        ...repos,
        now: NOW,
        makeId,
        duffel: wiring.duffel,
        booking: wiring.booking,
        deterministicOnly: true,
      });
    },
  });
  return { monitor, recovery };
}

// --- 1. disruption detected → permitted recovery → resolved -----------------

test("lifecycle: disruption detected → permitted recovery → RESOLVED (persisted + refresh)", async () => {
  const TID = "trip-perm";
  const repos = await setup(monitoredTrip(TID));
  const { monitor, recovery } = await runLifecycle(TID, repos, {
    provider: connectionBreakingProvider(),
    duffel: fakeDuffelSearch("1550.00"),
    booking: fakeBooking({ liveTotal: 1550 }),
  });

  // Monitoring: deterministic detection + persisted disruption + AT_RISK.
  assert.equal(monitor.status, "disrupted");
  assert.equal(monitor.tripStatus, "AT_RISK");
  assert.equal(monitor.disruptions.length, 1);
  assert.equal(monitor.disruptions[0].type, "MISSED_CONNECTION");
  assert.equal(monitor.disruptions[0].threatensTrip, true);
  assert.ok(monitor.operationalEvent, "monitoring emits the recovery-trigger event");

  // Recovery ran through the choke point and CONFIRMED a real (faked) order.
  assert.equal(recovery!.status, "recovered");
  assert.equal(recovery!.tripStatus, "RESOLVED");
  assert.equal(recovery!.recovery?.status, "RECOVERED");
  assert.equal(recovery!.recovery?.bookingReference, "PNR-REC");
  assert.equal(recovery!.recovery?.duffelOrderId, "ord_rec_1");

  // Persisted trip state — RESOLVED only after confirmed provider success.
  const trip = await repos.tripRepo.getById(TID);
  assert.equal(trip!.status, "RESOLVED");
  assert.equal(trip!.duffelOrderId, "ord_rec_1");
  assert.equal(trip!.finalCost, 1550);
  assert.equal(trip!.bookingStatus, "CONFIRMED");

  // Refresh: the read the Disruption/Resolution/Trips screens use reflects it.
  const view = await getMonitoringView(TID, { ...repos, providerConfigured: true });
  assert.equal(view!.tripStatus, "RESOLVED");
  assert.equal(view!.threatened, true);
  assert.equal(view!.disruptions.length, 1);
  assert.equal(view!.recovery?.status, "RECOVERED");
  assert.equal(view!.recovery?.bookingReference, "PNR-REC");

  // SSE: only user-safe operational stages — never chain-of-thought.
  const stages = recoveryOutcomeEvents(recovery!).map((e) => e.stage);
  assert.deepEqual(stages, ["SEARCHING", "EVALUATING", "REBOOKING", "RESOLVED"]);
  assert.ok(!JSON.stringify(recoveryOutcomeEvents(recovery!)).match(/prompt|reason.*binding|systemPrompt/i));
});

// --- 2. disruption detected → allowance exceeded → escalated ----------------

test("lifecycle: disruption detected → allowance exceeded → ESCALATED (no booking)", async () => {
  // Fully funded (1800) so funding/budget pass and the allowance is the binding gate.
  const TID = "trip-allow";
  const repos = await setup(monitoredTrip(TID, { fundedAmount: 1800 }));
  const { monitor, recovery } = await runLifecycle(TID, repos, {
    provider: connectionBreakingProvider(),
    duffel: fakeDuffelSearch("1700.00"), // +232 over the £150 recovery allowance
    booking: fakeBooking(),
  });

  assert.equal(monitor.status, "disrupted");
  assert.equal(recovery!.status, "escalated");
  assert.equal(recovery!.recovery?.status, "ESCALATED");
  assert.equal(recovery!.recovery?.escalationReason, "OVER_ALLOWANCE");

  // Nothing booked; the trip stays AT_RISK for the traveler's decision.
  const trip = await repos.tripRepo.getById(TID);
  assert.equal(trip!.status, "AT_RISK");
  assert.equal(trip!.duffelOrderId ?? null, null);

  const view = await getMonitoringView(TID, { ...repos, providerConfigured: true });
  assert.equal(view!.tripStatus, "AT_RISK");
  assert.equal(view!.recovery?.status, "ESCALATED");
  assert.equal(view!.recovery?.escalationReason, "OVER_ALLOWANCE");

  const stages = recoveryOutcomeEvents(recovery!).map((e) => e.stage);
  assert.deepEqual(stages, ["SEARCHING", "EVALUATING", "ESCALATED"]);
});

// --- 3. disruption detected → insufficient funding → escalated --------------

test("lifecycle: disruption detected → insufficient funding → ESCALATED (no booking)", async () => {
  // Funds (1500) short of the £1600 alternative, though its +132 is within allowance.
  const TID = "trip-fund";
  const repos = await setup(monitoredTrip(TID, { fundedAmount: 1500 }));
  const { recovery } = await runLifecycle(TID, repos, {
    provider: connectionBreakingProvider(),
    duffel: fakeDuffelSearch("1600.00"),
    booking: fakeBooking(),
  });

  assert.equal(recovery!.status, "escalated");
  assert.equal(recovery!.recovery?.escalationReason, "INSUFFICIENT_FUNDING");

  const trip = await repos.tripRepo.getById(TID);
  assert.equal(trip!.status, "AT_RISK");
  assert.equal(trip!.duffelOrderId ?? null, null);

  const view = await getMonitoringView(TID, { ...repos, providerConfigured: true });
  assert.equal(view!.tripStatus, "AT_RISK");
  assert.equal(view!.recovery?.escalationReason, "INSUFFICIENT_FUNDING");
});

// --- 4. provider failure → honest failure state -----------------------------

test("lifecycle: disruption detected → provider failure on booking → honest failure (nothing faked)", async () => {
  const TID = "trip-fail";
  const repos = await setup(monitoredTrip(TID));
  const { recovery } = await runLifecycle(TID, repos, {
    provider: connectionBreakingProvider(),
    duffel: fakeDuffelSearch("1550.00"), // permitted, so booking is attempted
    booking: fakeBooking({ createThrows: true }), // the provider fails to confirm
  });

  // Honest failure: no confirmation, no state advance, no fabricated success.
  assert.equal(recovery!.status, "provider_error");
  assert.equal(recovery!.recovery, undefined);

  const trip = await repos.tripRepo.getById(TID);
  assert.equal(trip!.status, "AT_RISK"); // never RESOLVED without a confirmed order
  assert.equal(trip!.bookingStatus, "FAILED");
  assert.equal(trip!.duffelOrderId ?? null, null);
  assert.equal((await repos.recoveryRepo.listForTrip(TID)).length, 0);

  // Refresh preserves the honest at-risk state — no recovery recorded.
  const view = await getMonitoringView(TID, { ...repos, providerConfigured: true });
  assert.equal(view!.tripStatus, "AT_RISK");
  assert.equal(view!.recovery, null);
  assert.equal(view!.threatened, true);

  const stages = recoveryOutcomeEvents(recovery!).map((e) => e.stage);
  assert.deepEqual(stages, ["SEARCHING", "EVALUATING", "UNAVAILABLE"]);
});

// --- demo: the permitted £96 / denied £181 recovery run deterministically ---

test("demo: £96 recovery is permitted and resolves the demo trip (STAGED, deterministic)", async () => {
  resetDemoTrip(DEMO_TRIP_ID); // fresh AT_RISK
  const r = (await executeBookingTool.invoke({ tripId: DEMO_TRIP_ID, amount: 96, description: "Recovery SIN → SYD" })) as {
    ok: boolean; mode: string; bookingReference?: string;
  };
  assert.equal(r.ok, true);
  assert.equal(r.mode, "STAGED");
  assert.equal(r.bookingReference, stagedBookingReference(DEMO_TRIP_ID, 96)); // deterministic
  const after = getTripById(DEMO_TRIP_ID)!;
  assert.equal(after.status, "RESOLVED"); // AT_RISK → RECOVERING → RESOLVED
});

test("demo: £181 recovery is denied by authority and leaves the trip AT_RISK", async () => {
  resetDemoTrip(DEMO_TRIP_OVER_LIMIT_ID); // fresh AT_RISK, £150 allowance
  const r = (await executeBookingTool.invoke({ tripId: DEMO_TRIP_OVER_LIMIT_ID, amount: 181 })) as { ok: boolean };
  assert.equal(r.ok, false); // 181 > 150 allowance
  const after = getTripById(DEMO_TRIP_OVER_LIMIT_ID)!;
  assert.equal(after.status, "AT_RISK"); // no state advance on denial
});
