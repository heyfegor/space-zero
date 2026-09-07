/**
 * Space Zero — normalize Duffel offers into the provider-agnostic FlightOption
 * shape (deterministic; no ranking here). Duration is computed from the actual
 * first-departure → last-arrival timestamps, which is timezone-safe.
 */

import type { DuffelOffer } from "../../providers/duffel";
import type { FlightOption, FlightSegment } from "../../domain/flight-option";

function minutesBetween(startIso: string, endIso: string): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 60000);
}

/**
 * Normalize a single Duffel offer into a FlightOption (rank/recommended/selected
 * are placeholders set later by the ranking step). Multi-slice offers are
 * flattened into one ordered segment list. Returns null for a malformed offer.
 */
export function normalizeOffer(offer: DuffelOffer, tripId: string, makeId: () => string): FlightOption | null {
  const segments: FlightSegment[] = [];
  for (const slice of offer.slices ?? []) {
    for (const seg of slice.segments ?? []) {
      const from = seg.origin?.iata_code;
      const to = seg.destination?.iata_code;
      if (!from || !to || !seg.departing_at || !seg.arriving_at) continue;
      segments.push({
        from,
        to,
        departAt: seg.departing_at,
        arriveAt: seg.arriving_at,
        carrier: seg.marketing_carrier?.iata_code,
        flightNumber: seg.marketing_carrier_flight_number
          ? `${seg.marketing_carrier?.iata_code ?? ""}${seg.marketing_carrier_flight_number}`
          : undefined,
      });
    }
  }
  if (segments.length === 0) return null;

  const departAt = segments[0].departAt;
  const arriveAt = segments[segments.length - 1].arriveAt;
  const totalAmount = Number(offer.total_amount);

  return {
    id: makeId(),
    tripId,
    providerOfferId: offer.id,
    segments,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    currency: offer.total_currency ?? "GBP",
    durationMinutes: minutesBetween(departAt, arriveAt),
    connections: segments.length - 1,
    departAt,
    arriveAt,
    rank: 0,
    recommended: false,
    selected: false,
    expiresAt: offer.expires_at ?? null,
  };
}

export function normalizeOffers(offers: DuffelOffer[], tripId: string, makeId: () => string): FlightOption[] {
  return offers.map((o) => normalizeOffer(o, tripId, makeId)).filter((o): o is FlightOption => o !== null);
}
