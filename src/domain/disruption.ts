/**
 * Space Zero — disruption detection (deterministic, server-safe; NO LLM/DB/provider).
 *
 * This is the ONE place that decides whether an observed change to a booked
 * itinerary THREATENS the trip's requirements. It is pure arithmetic over the
 * booked segments, their observed flight statuses, and the arrival requirement —
 * never a model judgement. The monitoring service normalizes a provider's data
 * into `MonitoredSegment`s and hands them here; the provider never gets to
 * "decide" that a trip is disrupted (see the architecture rule: provider data is
 * an input, not an LLM decision).
 *
 * Detection rules (fail toward flagging a real threat, first meaningful hit per
 * segment wins):
 *   - CANCELLATION    — a booked flight is cancelled. Always threatens.
 *   - DIVERSION       — a booked flight is diverted. Always threatens.
 *   - MISSED_CONNECTION — a delay leaves less than the minimum connection time
 *     before the next booked segment departs. Threatens.
 *   - ARRIVAL_BREACH  — the final booked segment's effective arrival is after the
 *     trip's hard arrival deadline. Threatens. (Only evaluated when a machine
 *     deadline is known; we never invent one.)
 *   - DELAY           — a delay past the noise threshold that does NOT breach a
 *     connection or the deadline. Informational; does not threaten the trip.
 */

/** Provider-agnostic, normalized status of a single booked flight. */
export type ObservedStatus =
  | "SCHEDULED"
  | "ACTIVE"
  | "LANDED"
  | "DELAYED"
  | "CANCELLED"
  | "DIVERTED"
  | "UNKNOWN";

/** The kinds of disruption the deterministic detector can raise. */
export type DisruptionType =
  | "CANCELLATION"
  | "DIVERSION"
  | "MISSED_CONNECTION"
  | "ARRIVAL_BREACH"
  | "DELAY";

export const DISRUPTION_TYPES: readonly DisruptionType[] = [
  "CANCELLATION",
  "DIVERSION",
  "MISSED_CONNECTION",
  "ARRIVAL_BREACH",
  "DELAY",
] as const;

/**
 * Severity of a detected disruption.
 *  - CRITICAL — threatens the trip requirement; the recovery flow should run.
 *  - MINOR    — a real change worth surfacing, but the trip still holds.
 */
export type DisruptionSeverity = "MINOR" | "CRITICAL";

export const DISRUPTION_SEVERITIES: readonly DisruptionSeverity[] = ["MINOR", "CRITICAL"] as const;

/**
 * One booked segment plus its observed status. `scheduled*` come from the
 * authoritative booked itinerary; `estimated*` come from the flight-status
 * provider (null when the provider has no estimate). The detector uses the
 * estimate when present, else the schedule.
 */
export interface MonitoredSegment {
  /** 0-based position in the booked itinerary. */
  index: number;
  from: string;
  to: string;
  flightNumber?: string | null;
  status: ObservedStatus;
  cancelled: boolean;
  diverted: boolean;
  /** ISO 8601 scheduled departure/arrival from the booked itinerary. */
  scheduledDepartAt: string;
  scheduledArriveAt: string;
  /** ISO 8601 provider estimate, or null if unknown. */
  estimatedDepartAt: string | null;
  estimatedArriveAt: string | null;
}

/** A disruption the detector raised for one segment. */
export interface DetectedDisruption {
  type: DisruptionType;
  severity: DisruptionSeverity;
  /** True only for CRITICAL disruptions — the trip requirement is threatened. */
  threatensTrip: boolean;
  segmentIndex: number;
  from: string;
  to: string;
  flightNumber?: string | null;
  /** Arrival delay in minutes vs the booked schedule (0 for on-time/cancelled). */
  delayMinutes: number;
  scheduledArriveAt: string;
  estimatedArriveAt: string | null;
  /** Short, brand-voice one-liner. Factual, no reassurance filler. */
  summary: string;
  /** A sentence of operational consequence. */
  detail: string;
}

export interface DisruptionAssessment {
  /** True when at least one CRITICAL disruption was detected. */
  threatened: boolean;
  /** Every disruption detected this run (MINOR and CRITICAL), segment order. */
  disruptions: DetectedDisruption[];
}

/**
 * A persisted disruption — a `DetectedDisruption` given identity and a detection
 * timestamp, plus whether it created an operational event that can trigger the
 * existing Strands recovery flow later. This is the record stored in Supabase
 * and read by the Trips/Disruption screens.
 */
export interface Disruption extends DetectedDisruption {
  id: string;
  tripId: string;
  /**
   * True when this disruption created an operational event for the recovery flow
   * (equals `threatensTrip`). Recovery is NOT run automatically here.
   */
  triggersRecovery: boolean;
  /** ISO 8601 detection time. */
  detectedAt: string;
  createdAt?: string;
}

export interface AssessOptions {
  /** Hard arrival requirement (ISO 8601), or null when none is known. */
  arrivalDeadline?: string | null;
  /** Minimum minutes needed between arrival and the next departure. Default 45. */
  minConnectionMinutes?: number;
  /** Delay (minutes) below which a slip is treated as noise. Default 15. */
  delayThresholdMinutes?: number;
}

const DEFAULT_MIN_CONNECTION_MINUTES = 45;
const DEFAULT_DELAY_THRESHOLD_MINUTES = 15;

function minutesBetween(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 60000);
}

/** Effective (best-known) arrival: the estimate if present, else the schedule. */
function effectiveArrive(seg: MonitoredSegment): string {
  return seg.estimatedArriveAt ?? seg.scheduledArriveAt;
}

/** Effective (best-known) departure: the estimate if present, else the schedule. */
function effectiveDepart(seg: MonitoredSegment): string {
  return seg.estimatedDepartAt ?? seg.scheduledDepartAt;
}

function arrivalDelayMinutes(seg: MonitoredSegment): number {
  const delta = minutesBetween(seg.scheduledArriveAt, effectiveArrive(seg));
  if (delta === null) return 0;
  return Math.max(0, delta);
}

function hours(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Deterministically assess whether the observed statuses threaten the trip.
 * Pure: same inputs → same output. No I/O, no model, no clock unless a deadline
 * is supplied by the caller.
 */
export function assessDisruption(
  segments: MonitoredSegment[],
  options: AssessOptions = {},
): DisruptionAssessment {
  const minConnection = options.minConnectionMinutes ?? DEFAULT_MIN_CONNECTION_MINUTES;
  const delayThreshold = options.delayThresholdMinutes ?? DEFAULT_DELAY_THRESHOLD_MINUTES;
  const deadline = options.arrivalDeadline ?? null;

  const ordered = [...segments].sort((a, b) => a.index - b.index);
  const disruptions: DetectedDisruption[] = [];

  ordered.forEach((seg, i) => {
    const delay = arrivalDelayMinutes(seg);
    const base = {
      segmentIndex: seg.index,
      from: seg.from,
      to: seg.to,
      flightNumber: seg.flightNumber ?? null,
      delayMinutes: delay,
      scheduledArriveAt: seg.scheduledArriveAt,
      estimatedArriveAt: seg.estimatedArriveAt,
    };

    // 1. Cancellation — unconditionally threatening.
    if (seg.cancelled || seg.status === "CANCELLED") {
      disruptions.push({
        ...base,
        type: "CANCELLATION",
        severity: "CRITICAL",
        threatensTrip: true,
        delayMinutes: 0,
        summary: `Flight ${seg.flightNumber ?? `${seg.from}→${seg.to}`} cancelled`,
        detail: `Your booked ${seg.from} → ${seg.to} flight has been cancelled. This leg of the journey no longer exists.`,
      });
      return;
    }

    // 2. Diversion — unconditionally threatening.
    if (seg.diverted || seg.status === "DIVERTED") {
      disruptions.push({
        ...base,
        type: "DIVERSION",
        severity: "CRITICAL",
        threatensTrip: true,
        summary: `Flight ${seg.flightNumber ?? `${seg.from}→${seg.to}`} diverted`,
        detail: `Your booked ${seg.from} → ${seg.to} flight has been diverted from its route. The onward journey no longer holds.`,
      });
      return;
    }

    // 3. Missed connection — a delay eats the connection to the next segment.
    const next = ordered[i + 1];
    if (next) {
      const connectionMins = minutesBetween(effectiveArrive(seg), effectiveDepart(next));
      if (connectionMins !== null && connectionMins < minConnection) {
        disruptions.push({
          ...base,
          type: "MISSED_CONNECTION",
          severity: "CRITICAL",
          threatensTrip: true,
          summary: `Connection at ${seg.to} no longer works`,
          detail:
            connectionMins < 0
              ? `${seg.from} → ${seg.to} now lands after your ${next.from} → ${next.to} connection departs. The booked journey no longer connects.`
              : `${seg.from} → ${seg.to} is delayed, leaving ${hours(connectionMins)} to connect at ${seg.to} — under the ${hours(minConnection)} minimum. The connection is no longer reachable.`,
        });
        return;
      }
    }

    // 4. Arrival-deadline breach — only the final leg, only if we know a deadline.
    const isFinal = i === ordered.length - 1;
    if (isFinal && deadline) {
      const overrun = minutesBetween(deadline, effectiveArrive(seg));
      if (overrun !== null && overrun > 0) {
        disruptions.push({
          ...base,
          type: "ARRIVAL_BREACH",
          severity: "CRITICAL",
          threatensTrip: true,
          summary: `Arrival now after your deadline`,
          detail: `The booked journey now arrives ${hours(overrun)} after your required arrival. It no longer meets your trip.`,
        });
        return;
      }
    }

    // 5. Delay past the noise threshold that does NOT threaten the trip.
    if (delay >= delayThreshold) {
      disruptions.push({
        ...base,
        type: "DELAY",
        severity: "MINOR",
        threatensTrip: false,
        summary: `Flight ${seg.flightNumber ?? `${seg.from}→${seg.to}`} delayed ${hours(delay)}`,
        detail: `${seg.from} → ${seg.to} is running ${hours(delay)} late, but the booked journey still holds.`,
      });
    }
  });

  return {
    threatened: disruptions.some((d) => d.threatensTrip),
    disruptions,
  };
}
