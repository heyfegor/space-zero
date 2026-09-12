/**
 * Space Zero — Supabase row shape for `disruptions` + row↔domain mappers.
 * The only place that knows the disruptions column layout.
 */

import type {
  Disruption,
  DisruptionSeverity,
  DisruptionType,
} from "../../domain/disruption";
import { DISRUPTION_SEVERITIES, DISRUPTION_TYPES } from "../../domain/disruption";

export interface DisruptionRow {
  id: string;
  trip_id: string;
  type: string;
  severity: string;
  threatens_trip: boolean | null;
  triggers_recovery: boolean | null;
  segment_index: number | null;
  origin: string | null;
  destination: string | null;
  flight_number: string | null;
  delay_minutes: number | null;
  scheduled_arrive_at: string | null;
  estimated_arrive_at: string | null;
  summary: string | null;
  detail: string | null;
  detected_at: string;
  created_at: string;
}

export type DisruptionInsertRow = Omit<DisruptionRow, "created_at">;

function asType(v: string): DisruptionType {
  return (DISRUPTION_TYPES as readonly string[]).includes(v) ? (v as DisruptionType) : "DELAY";
}

function asSeverity(v: string): DisruptionSeverity {
  return (DISRUPTION_SEVERITIES as readonly string[]).includes(v)
    ? (v as DisruptionSeverity)
    : "MINOR";
}

function toNumber(v: number | null | undefined, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function rowToDisruption(row: DisruptionRow): Disruption {
  return {
    id: row.id,
    tripId: row.trip_id,
    type: asType(row.type),
    severity: asSeverity(row.severity),
    threatensTrip: Boolean(row.threatens_trip),
    triggersRecovery: Boolean(row.triggers_recovery),
    segmentIndex: toNumber(row.segment_index),
    from: row.origin ?? "",
    to: row.destination ?? "",
    flightNumber: row.flight_number,
    delayMinutes: toNumber(row.delay_minutes),
    scheduledArriveAt: row.scheduled_arrive_at ?? "",
    estimatedArriveAt: row.estimated_arrive_at,
    summary: row.summary ?? "",
    detail: row.detail ?? "",
    detectedAt: row.detected_at,
    createdAt: row.created_at,
  };
}

export function disruptionToInsertRow(d: Disruption): DisruptionInsertRow {
  return {
    id: d.id,
    trip_id: d.tripId,
    type: d.type,
    severity: d.severity,
    threatens_trip: d.threatensTrip,
    triggers_recovery: d.triggersRecovery,
    segment_index: d.segmentIndex,
    origin: d.from || null,
    destination: d.to || null,
    flight_number: d.flightNumber ?? null,
    delay_minutes: d.delayMinutes,
    scheduled_arrive_at: d.scheduledArriveAt || null,
    estimated_arrive_at: d.estimatedArriveAt,
    summary: d.summary || null,
    detail: d.detail || null,
    detected_at: d.detectedAt,
  };
}
