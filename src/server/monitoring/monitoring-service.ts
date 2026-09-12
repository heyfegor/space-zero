/**
 * Space Zero — flight monitoring orchestration (deterministic; server-side).
 *
 * Watches a booked trip's segments using AUTHORITATIVE data: the booked
 * itinerary from the store (the selected flight option's segments) plus live
 * observations from a flight-status provider. It:
 *   1. Loads the trip and refuses to monitor one that has no confirmed booking.
 *   2. Refuses to fabricate a status when the provider is unconfigured (honest
 *      "unavailable" state) or when the provider call fails.
 *   3. Normalizes provider observations against the booked schedule.
 *   4. Runs the DETERMINISTIC disruption detector (src/domain/disruption.ts) —
 *      the provider/model never "decides" a trip is disrupted; the backend does.
 *   5. Persists meaningful (threatening) disruptions in Supabase.
 *   6. On a meaningful disruption, creates an operational event by advancing the
 *      trip to AT_RISK through the validated state machine — the signal the
 *      existing Strands recovery flow keys on. Recovery is NOT run here.
 *
 * Dependencies are injectable so the whole pipeline is testable without a key or
 * the network (tests pass a fake provider and in-memory repos).
 */

import {
  assessDisruption,
  type Disruption,
  type MonitoredSegment,
} from "../../domain/disruption";
import { canTransition } from "../../domain/trip-state";
import type { Trip, TripStatus } from "../../domain/trip";
import type { FlightOption } from "../../domain/flight-option";
import {
  getFlightStatusProvider,
  isFlightStatusConfigured,
  type FlightStatusProvider,
} from "../../providers/flight-status";
import { getTripRepository, type TripRepository } from "../persistence/trip-repository";
import {
  getFlightOptionRepository,
  type FlightOptionRepository,
} from "../persistence/flight-option-repository";
import {
  getDisruptionRepository,
  type DisruptionRepository,
} from "../persistence/disruption-repository";
import {
  getRecoveryRepository,
  type RecoveryRepository,
} from "../persistence/recovery-repository";
import type { Recovery } from "../../domain/recovery";

export type MonitorStatus =
  | "ok" // monitored; no threatening disruption
  | "disrupted" // a threatening disruption was detected and persisted
  | "provider_unconfigured" // no flight-status key — honest unavailable, nothing invented
  | "provider_error" // the provider call failed — nothing invented, nothing persisted
  | "not_booked" // the trip has no confirmed booking / itinerary to monitor
  | "trip_not_found";

/** The operational event a meaningful disruption creates for the recovery flow. */
export interface OperationalEvent {
  type: "DISRUPTION_DETECTED";
  tripId: string;
  /** The critical disruption that triggered it. */
  disruptionId: string;
  /** Trip status after the deterministic transition (AT_RISK when triggered). */
  tripStatusAfter: TripStatus;
  /** The recovery flow may run later; monitoring never runs it. */
  triggersRecovery: true;
}

/** A per-segment status line for the UI (no judgement — that's the detector's job). */
export interface MonitoredSegmentView {
  segmentIndex: number;
  from: string;
  to: string;
  flightNumber: string | null;
  status: MonitoredSegment["status"];
  scheduledDepartAt: string;
  scheduledArriveAt: string;
  estimatedDepartAt: string | null;
  estimatedArriveAt: string | null;
  delayMinutes: number;
}

export interface MonitorOutcome {
  status: MonitorStatus;
  tripId: string;
  tripStatus: TripStatus | null;
  segments: MonitoredSegmentView[];
  disruptions: Disruption[];
  threatened: boolean;
  operationalEvent?: OperationalEvent;
}

export interface MonitorDeps {
  provider?: FlightStatusProvider;
  tripRepo?: TripRepository;
  optionRepo?: FlightOptionRepository;
  disruptionRepo?: DisruptionRepository;
  now?: Date;
  makeId?: () => string;
  /** Minimum connection minutes for the detector (default in the domain). */
  minConnectionMinutes?: number;
  /**
   * Trigger fired when a meaningful disruption moves the trip to AT_RISK — this
   * is how monitoring hands off to the Strands recovery workflow. Invoked with
   * the operational event. Awaited failures are swallowed so monitoring still
   * returns its result; the route wires this to the recovery workflow.
   */
  onDisruption?: (event: OperationalEvent) => void | Promise<void>;
}

/** A trip is monitorable once a real booking is confirmed. */
function hasConfirmedBooking(trip: Trip): boolean {
  return (
    trip.bookingStatus === "CONFIRMED" ||
    trip.status === "MONITORING" ||
    trip.status === "AT_RISK" ||
    trip.status === "RECOVERING"
  );
}

/** The booked itinerary is the selected option (never client/LLM supplied). */
function bookedItinerary(trip: Trip, options: FlightOption[]): FlightOption | null {
  return (
    options.find((o) => o.selected) ??
    (trip.selectedOptionId ? options.find((o) => o.id === trip.selectedOptionId) : undefined) ??
    null
  );
}

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Compute the next status a successful monitoring pass should move the trip to,
 * or null to stay put. Uses ONLY transitions the validated machine allows:
 *   - CONFIRMED → MONITORING once monitoring has begun.
 *   - MONITORING → AT_RISK when a threatening disruption is detected.
 * An already AT_RISK/RECOVERING trip is left alone (recovery owns it).
 */
function nextMonitoringStatus(current: TripStatus, threatened: boolean): TripStatus | null {
  if (current === "CONFIRMED") {
    if (threatened && canTransition("MONITORING", "AT_RISK")) return "AT_RISK"; // via MONITORING
    return canTransition("CONFIRMED", "MONITORING") ? "MONITORING" : null;
  }
  if (current === "MONITORING" && threatened) {
    return canTransition("MONITORING", "AT_RISK") ? "AT_RISK" : null;
  }
  return null;
}

export async function monitorTrip(tripId: string, deps: MonitorDeps = {}): Promise<MonitorOutcome> {
  const tripRepo = deps.tripRepo ?? getTripRepository();
  const optionRepo = deps.optionRepo ?? getFlightOptionRepository();
  const disruptionRepo = deps.disruptionRepo ?? getDisruptionRepository();
  const now = deps.now ?? new Date();
  const makeId = deps.makeId ?? (() => crypto.randomUUID());

  const empty = { segments: [] as MonitoredSegmentView[], disruptions: [] as Disruption[], threatened: false };

  const trip = await tripRepo.getById(tripId);
  if (!trip) return { status: "trip_not_found", tripId, tripStatus: null, ...empty };

  const options = await optionRepo.listForTrip(tripId);
  const itinerary = bookedItinerary(trip, options);
  if (!hasConfirmedBooking(trip) || !itinerary || itinerary.segments.length === 0) {
    return { status: "not_booked", tripId, tripStatus: trip.status, ...empty };
  }

  // Honest: without a configured provider we do not invent a flight status.
  if (!deps.provider && !isFlightStatusConfigured()) {
    return { status: "provider_unconfigured", tripId, tripStatus: trip.status, ...empty };
  }
  const provider = deps.provider ?? getFlightStatusProvider();

  // Observe each booked segment. Any provider failure is surfaced honestly.
  const monitored: MonitoredSegment[] = [];
  try {
    for (let i = 0; i < itinerary.segments.length; i++) {
      const seg = itinerary.segments[i];
      const obs = await provider.getFlightStatus({
        carrier: seg.carrier,
        flightNumber: seg.flightNumber ?? "",
        departureDate: dateOf(seg.departAt),
        from: seg.from,
        to: seg.to,
      });
      monitored.push({
        index: i,
        from: seg.from,
        to: seg.to,
        flightNumber: seg.flightNumber ?? null,
        status: obs?.status ?? "UNKNOWN",
        cancelled: obs?.cancelled ?? false,
        diverted: obs?.diverted ?? false,
        scheduledDepartAt: obs?.scheduledDepartAt ?? seg.departAt,
        scheduledArriveAt: obs?.scheduledArriveAt ?? seg.arriveAt,
        estimatedDepartAt: obs?.estimatedDepartAt ?? null,
        estimatedArriveAt: obs?.estimatedArriveAt ?? null,
      });
    }
  } catch {
    return { status: "provider_error", tripId, tripStatus: trip.status, ...empty };
  }

  // 4. DETERMINISTIC detection — the backend decides, never the provider/model.
  const assessment = assessDisruption(monitored, {
    arrivalDeadline: trip.arrivalDeadline || null,
    minConnectionMinutes: deps.minConnectionMinutes,
  });

  const segments: MonitoredSegmentView[] = monitored.map((m) => {
    const d = assessment.disruptions.find((x) => x.segmentIndex === m.index);
    return {
      segmentIndex: m.index,
      from: m.from,
      to: m.to,
      flightNumber: m.flightNumber ?? null,
      status: m.status,
      scheduledDepartAt: m.scheduledDepartAt,
      scheduledArriveAt: m.scheduledArriveAt,
      estimatedDepartAt: m.estimatedDepartAt,
      estimatedArriveAt: m.estimatedArriveAt,
      delayMinutes: d?.delayMinutes ?? 0,
    };
  });

  // 5. Persist the MEANINGFUL (threatening) disruptions, de-duplicated against
  // what is already recorded for this segment+type so repeated polls don't spam.
  const meaningful = assessment.disruptions.filter((d) => d.threatensTrip);
  const existing = await disruptionRepo.listForTrip(tripId);
  const seen = new Set(existing.map((d) => `${d.segmentIndex}:${d.type}`));
  const toPersist: Disruption[] = meaningful
    .filter((d) => !seen.has(`${d.segmentIndex}:${d.type}`))
    .map((d) => ({
      ...d,
      id: makeId(),
      tripId,
      triggersRecovery: d.threatensTrip,
      detectedAt: now.toISOString(),
    }));
  const persisted = toPersist.length > 0 ? await disruptionRepo.add(toPersist) : [];

  // 6. Advance trip state deterministically. A meaningful disruption moves the
  // trip to AT_RISK — the operational event the recovery flow later consumes.
  const target = nextMonitoringStatus(trip.status, assessment.threatened);
  let tripStatusAfter: TripStatus = trip.status;
  if (target && target !== trip.status) {
    const updated = await tripRepo.update(tripId, { status: target });
    tripStatusAfter = updated?.status ?? trip.status;
  }

  let operationalEvent: OperationalEvent | undefined;
  if (assessment.threatened) {
    // Prefer a disruption persisted this run; else the earliest already-recorded
    // critical one — the event should always point at a real disruption record.
    const critical =
      persisted[0] ?? existing.find((d) => d.triggersRecovery) ?? persisted[0];
    if (critical) {
      operationalEvent = {
        type: "DISRUPTION_DETECTED",
        tripId,
        disruptionId: critical.id,
        tripStatusAfter,
        triggersRecovery: true,
      };
      // Hand off to the recovery workflow. Fire only when a NEW disruption was
      // persisted this run (not on every re-poll of an already-known one), so
      // recovery is triggered once per detection.
      if (deps.onDisruption && persisted.length > 0) {
        try {
          await deps.onDisruption(operationalEvent);
        } catch {
          // Never let a recovery-trigger failure break the monitoring result.
        }
      }
    }
  }

  return {
    status: assessment.threatened ? "disrupted" : "ok",
    tripId,
    tripStatus: tripStatusAfter,
    segments,
    disruptions: persisted,
    threatened: assessment.threatened,
    operationalEvent,
  };
}

// ---------------------------------------------------------------------------
// Persisted monitoring view (read-only; runs NO provider call). This is what the
// Trips/Disruption screens read for real, persisted monitoring/disruption data.
// ---------------------------------------------------------------------------

export interface MonitoringView {
  tripId: string;
  tripStatus: TripStatus;
  /** True when the trip has a confirmed booking + a booked itinerary to watch. */
  monitored: boolean;
  /** Honest availability of the flight-status provider. */
  providerConfigured: boolean;
  /** True when a threatening disruption is on record. */
  threatened: boolean;
  /** Persisted disruptions, newest first. */
  disruptions: Disruption[];
  /** Detection time of the most recent disruption, or null. */
  lastDisruptionAt: string | null;
  /** The latest recovery outcome (booked or escalated), or null. */
  recovery: Recovery | null;
}

export interface MonitoringViewDeps {
  tripRepo?: TripRepository;
  optionRepo?: FlightOptionRepository;
  disruptionRepo?: DisruptionRepository;
  recoveryRepo?: RecoveryRepository;
  providerConfigured?: boolean;
}

export async function getMonitoringView(
  tripId: string,
  deps: MonitoringViewDeps = {},
): Promise<MonitoringView | null> {
  const tripRepo = deps.tripRepo ?? getTripRepository();
  const optionRepo = deps.optionRepo ?? getFlightOptionRepository();
  const disruptionRepo = deps.disruptionRepo ?? getDisruptionRepository();
  const recoveryRepo = deps.recoveryRepo ?? getRecoveryRepository();
  const providerConfigured = deps.providerConfigured ?? isFlightStatusConfigured();

  const trip = await tripRepo.getById(tripId);
  if (!trip) return null;

  const options = await optionRepo.listForTrip(tripId);
  const itinerary = bookedItinerary(trip, options);
  const monitored = hasConfirmedBooking(trip) && Boolean(itinerary && itinerary.segments.length > 0);

  const disruptions = await disruptionRepo.listForTrip(tripId);
  const threatened = disruptions.some((d) => d.threatensTrip);
  const recovery = await recoveryRepo.latestForTrip(tripId);

  return {
    tripId,
    tripStatus: trip.status,
    monitored,
    providerConfigured,
    threatened,
    disruptions,
    lastDisruptionAt: disruptions[0]?.detectedAt ?? null,
    recovery,
  };
}
