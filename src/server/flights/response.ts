/**
 * Space Zero — API view of a flight option (no internal-only fields). Segments
 * are included so the client can render the route without another lookup.
 */

import type { FlightOption } from "../../domain/flight-option";

export interface FlightOptionResponse {
  id: string;
  providerOfferId: string;
  origin: string;
  destination: string;
  via: string[];
  segments: { from: string; to: string; departAt: string; arriveAt: string; carrier?: string; flightNumber?: string }[];
  totalAmount: number;
  currency: string;
  durationMinutes: number;
  connections: number;
  departAt: string;
  arriveAt: string;
  rank: number;
  recommended: boolean;
  selected: boolean;
  expiresAt: string | null;
}

export function toFlightOptionResponse(o: FlightOption): FlightOptionResponse {
  const origin = o.segments[0]?.from ?? "";
  const destination = o.segments.at(-1)?.to ?? "";
  const via = o.segments.slice(0, -1).map((s) => s.to);
  return {
    id: o.id,
    providerOfferId: o.providerOfferId,
    origin,
    destination,
    via,
    segments: o.segments.map((s) => ({
      from: s.from,
      to: s.to,
      departAt: s.departAt,
      arriveAt: s.arriveAt,
      carrier: s.carrier,
      flightNumber: s.flightNumber,
    })),
    totalAmount: o.totalAmount,
    currency: o.currency,
    durationMinutes: o.durationMinutes,
    connections: o.connections,
    departAt: o.departAt,
    arriveAt: o.arriveAt,
    rank: o.rank,
    recommended: o.recommended,
    selected: o.selected,
    expiresAt: o.expiresAt,
  };
}
