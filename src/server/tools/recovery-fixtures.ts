/**
 * Space Zero — deterministic recovery-option fixtures (server-side, dev).
 *
 * Reproducible stand-ins for a real recovery search, so demo behavior is
 * identical every run. For the disrupted LHR → SIN → SYD trip these are
 * alternatives for the broken SIN → SYD connection.
 *
 * Two scenarios:
 *   - the standard demo trip → a £96 option (within the £150 allowance) plus
 *     a £181 option (over it), exercising both authority paths;
 *   - the over-limit demo trip → only options above the £150 allowance, so the
 *     agent has no permitted recovery and must stop.
 */

import type { Trip } from "../../domain/trip";
import { DEMO_TRIP_OVER_LIMIT_ID } from "./dev-store";

export interface RecoveryOption {
  id: string;
  from: string;
  to: string;
  /** Extra cost beyond the existing booking. */
  additionalCost: number;
  currency: string;
  /** ISO 8601 new arrival timestamp. */
  newArrival: string;
  /** Human label for the new arrival, e.g. "08:40 SUN". */
  newArrivalLabel: string;
}

/** The connection point being recovered: the origin of the last segment. */
function connectionPoint(trip: Trip): string {
  return trip.segments.at(-1)?.from ?? trip.origin;
}

type OptionSpec = Pick<
  RecoveryOption,
  "id" | "additionalCost" | "newArrival" | "newArrivalLabel"
>;

const STANDARD_OPTIONS: OptionSpec[] = [
  { id: "rec_a", additionalCost: 96, newArrival: "2026-09-06T08:40:00+10:00", newArrivalLabel: "08:40 SUN" },
  { id: "rec_b", additionalCost: 181, newArrival: "2026-09-06T07:55:00+10:00", newArrivalLabel: "07:55 SUN" },
];

const OVER_LIMIT_OPTIONS: OptionSpec[] = [
  { id: "rec_x", additionalCost: 181, newArrival: "2026-09-06T07:55:00+10:00", newArrivalLabel: "07:55 SUN" },
  { id: "rec_y", additionalCost: 230, newArrival: "2026-09-06T06:20:00+10:00", newArrivalLabel: "06:20 SUN" },
];

/** Deterministic recovery options for an at-risk trip. */
export function recoveryOptionsFor(trip: Trip): RecoveryOption[] {
  const specs =
    trip.id === DEMO_TRIP_OVER_LIMIT_ID ? OVER_LIMIT_OPTIONS : STANDARD_OPTIONS;
  const from = connectionPoint(trip);
  const to = trip.destination;
  return specs.map((s) => ({
    id: s.id,
    from,
    to,
    additionalCost: s.additionalCost,
    currency: trip.currency,
    newArrival: s.newArrival,
    newArrivalLabel: s.newArrivalLabel,
  }));
}
