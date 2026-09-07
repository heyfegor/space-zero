/**
 * Space Zero — trip state machine (deterministic, server-side, NO LLM).
 *
 * Only the transitions Space Zero currently needs are defined. This is NOT a
 * generic workflow engine. Invalid transitions fail deterministically (throw),
 * so the system can never silently do DRAFT → RESOLVED or CONFIRMED → DRAFT.
 */

import type { Trip, TripStatus } from "./trip";

/**
 * Allowed forward transitions. The happy path is the documented linear
 * lifecycle; the only branches are the minimal ones the recovery loop needs:
 *   - MONITORING → RESOLVED   (trip completes with no disruption)
 *   - RECOVERING → MONITORING (rebooked, resume monitoring)
 */
const ALLOWED_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  DRAFT: ["PLANNING"],
  PLANNING: ["AWAITING_AUTHORITY"],
  AWAITING_AUTHORITY: ["READY"],
  READY: ["BOOKING"],
  BOOKING: ["CONFIRMED"],
  CONFIRMED: ["MONITORING"],
  MONITORING: ["AT_RISK", "RESOLVED"],
  AT_RISK: ["RECOVERING"],
  RECOVERING: ["MONITORING", "RESOLVED"],
  RESOLVED: [],
};

/** Pure predicate: is moving from `from` to `to` allowed? */
export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Thrown when an invalid transition is attempted. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TripStatus,
    readonly to: TripStatus,
  ) {
    super(
      `Invalid trip transition: ${from} → ${to}. Allowed from ${from}: ${
        ALLOWED_TRANSITIONS[from].join(", ") || "(none — terminal)"
      }.`,
    );
    this.name = "InvalidTransitionError";
  }
}

/** Throws InvalidTransitionError if the transition is not allowed. */
export function assertTransition(from: TripStatus, to: TripStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Returns a new Trip with the updated status. Does not mutate the input.
 * Throws on an invalid transition so callers cannot advance state unsafely.
 */
export function transition(trip: Trip, to: TripStatus): Trip {
  assertTransition(trip.status, to);
  return { ...trip, status: to };
}
