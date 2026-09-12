/**
 * Space Zero — Supabase row shape for `recoveries` + row↔domain mappers.
 * The only place that knows the recoveries column layout. Money is numeric (exact).
 */

import type { EscalationReason, Recovery, RecoveryStatus } from "../../domain/recovery";
import { ESCALATION_REASONS, RECOVERY_STATUSES } from "../../domain/recovery";

export interface RecoveryRow {
  id: string;
  trip_id: string;
  disruption_id: string | null;
  status: string;
  origin: string | null;
  destination: string | null;
  currency: string | null;
  additional_cost: number | string | null;
  total_amount: number | string | null;
  new_arrival: string | null;
  new_arrival_label: string | null;
  previous_arrival_label: string | null;
  booking_reference: string | null;
  duffel_order_id: string | null;
  final_cost: number | string | null;
  escalation_reason: string | null;
  over_by: number | string | null;
  reason: string | null;
  created_at: string;
}

export type RecoveryInsertRow = Omit<RecoveryRow, "created_at">;

function asStatus(v: string): RecoveryStatus {
  return (RECOVERY_STATUSES as readonly string[]).includes(v) ? (v as RecoveryStatus) : "ESCALATED";
}

function asEscalationReason(v: string | null): EscalationReason | null {
  if (!v) return null;
  return (ESCALATION_REASONS as readonly string[]).includes(v) ? (v as EscalationReason) : null;
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function rowToRecovery(row: RecoveryRow): Recovery {
  return {
    id: row.id,
    tripId: row.trip_id,
    disruptionId: row.disruption_id,
    status: asStatus(row.status),
    from: row.origin ?? "",
    to: row.destination ?? "",
    currency: row.currency ?? "GBP",
    additionalCost: toNum(row.additional_cost),
    totalAmount: toNum(row.total_amount),
    newArrival: row.new_arrival,
    newArrivalLabel: row.new_arrival_label,
    previousArrivalLabel: row.previous_arrival_label,
    bookingReference: row.booking_reference,
    duffelOrderId: row.duffel_order_id,
    finalCost: toNumOrNull(row.final_cost),
    escalationReason: asEscalationReason(row.escalation_reason),
    overBy: toNumOrNull(row.over_by),
    reason: row.reason ?? "",
    createdAt: row.created_at,
  };
}

export function recoveryToInsertRow(r: Recovery): RecoveryInsertRow {
  return {
    id: r.id,
    trip_id: r.tripId,
    disruption_id: r.disruptionId,
    status: r.status,
    origin: r.from || null,
    destination: r.to || null,
    currency: r.currency,
    additional_cost: r.additionalCost,
    total_amount: r.totalAmount,
    new_arrival: r.newArrival,
    new_arrival_label: r.newArrivalLabel,
    previous_arrival_label: r.previousArrivalLabel,
    booking_reference: r.bookingReference,
    duffel_order_id: r.duffelOrderId,
    final_cost: r.finalCost,
    escalation_reason: r.escalationReason,
    over_by: r.overBy,
    reason: r.reason || null,
  };
}
