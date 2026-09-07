/**
 * Space Zero — Supabase row shape for `flight_options` + row↔domain mappers.
 * The only place that knows the flight_options column layout. Money is numeric
 * (exact); segments are stored as jsonb.
 */

import type { FlightOption, FlightSegment } from "../../domain/flight-option";

export interface FlightOptionRow {
  id: string;
  trip_id: string;
  provider_offer_id: string;
  segments: FlightSegment[] | string | null;
  total_amount: number | string | null;
  currency: string | null;
  duration_minutes: number | null;
  connections: number | null;
  depart_at: string | null;
  arrive_at: string | null;
  rank: number | null;
  recommended: boolean | null;
  selected: boolean | null;
  expires_at: string | null;
  created_at: string;
}

export type FlightOptionInsertRow = Omit<FlightOptionRow, "created_at">;

function toNumber(v: number | string | null | undefined, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function toSegments(v: FlightSegment[] | string | null): FlightSegment[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as FlightSegment[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function rowToFlightOption(row: FlightOptionRow): FlightOption {
  const segments = toSegments(row.segments);
  return {
    id: row.id,
    tripId: row.trip_id,
    providerOfferId: row.provider_offer_id,
    segments,
    totalAmount: toNumber(row.total_amount),
    currency: row.currency ?? "GBP",
    durationMinutes: toNumber(row.duration_minutes),
    connections: toNumber(row.connections, Math.max(0, segments.length - 1)),
    departAt: row.depart_at ?? segments[0]?.departAt ?? "",
    arriveAt: row.arrive_at ?? segments.at(-1)?.arriveAt ?? "",
    rank: toNumber(row.rank),
    recommended: Boolean(row.recommended),
    selected: Boolean(row.selected),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function flightOptionToInsertRow(o: FlightOption): FlightOptionInsertRow {
  return {
    id: o.id,
    trip_id: o.tripId,
    provider_offer_id: o.providerOfferId,
    segments: o.segments,
    total_amount: o.totalAmount,
    currency: o.currency,
    duration_minutes: o.durationMinutes,
    connections: o.connections,
    depart_at: o.departAt || null,
    arrive_at: o.arriveAt || null,
    rank: o.rank,
    recommended: o.recommended,
    selected: o.selected,
    expires_at: o.expiresAt,
  };
}
