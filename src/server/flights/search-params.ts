/**
 * Space Zero — derive Duffel search parameters from a persisted trip
 * (deterministic). Resolves origin/destination to IATA, maps the cabin, and
 * derives a concrete departure date. Returns a typed failure when origin or
 * destination cannot be resolved, so the caller can show an honest state.
 */

import type { Trip } from "../../domain/trip";
import type { CabinClass, DuffelSearchParams } from "../../providers/duffel";
import { resolvePlaceToIata } from "./airports";

export type DeriveResult =
  | { ok: true; params: DuffelSearchParams; deadline: string | null }
  | { ok: false; reason: "origin_unknown" | "destination_unknown" };

function mapCabin(cabin: string | undefined): CabinClass {
  const c = (cabin ?? "").toLowerCase();
  if (c.includes("first")) return "first";
  if (c.includes("business")) return "business";
  if (c.includes("premium")) return "premium_economy";
  return "economy";
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Best-effort concrete departure date. Uses a parseable date in the label,
 *  otherwise a near-future default the traveler can refine. */
export function deriveDepartureDate(depart: string | undefined, now: Date = new Date()): string {
  if (depart) {
    const parsed = Date.parse(depart);
    if (Number.isFinite(parsed)) return toYmd(new Date(parsed));
  }
  const fallback = new Date(now.getTime());
  fallback.setDate(fallback.getDate() + 21);
  return toYmd(fallback);
}

export function deriveSearchParams(trip: Trip): DeriveResult {
  const origin = resolvePlaceToIata(trip.origin);
  if (!origin) return { ok: false, reason: "origin_unknown" };
  const destination = resolvePlaceToIata(trip.destination);
  if (!destination) return { ok: false, reason: "destination_unknown" };

  const deadline =
    trip.arrivalDeadline && Number.isFinite(Date.parse(trip.arrivalDeadline))
      ? trip.arrivalDeadline
      : null;

  return {
    ok: true,
    params: {
      origin,
      destination,
      departureDate: deriveDepartureDate(trip.depart),
      passengers: 1,
      cabinClass: mapCabin(trip.cabin),
    },
    deadline,
  };
}
