/**
 * Space Zero — Supabase row shape for `payments` + row↔domain mappers.
 * The only place that knows the payments column layout. Money is numeric (exact).
 *
 * The provider's RAW response is never stored — only its id and a sanitized
 * status/reason — so a later read of a payment can carry nothing sensitive.
 */

import type { Payment, PaymentKind, PaymentStatus } from "../../domain/payment";
import { PAYMENT_KINDS, PAYMENT_STATUSES } from "../../domain/payment";

export interface PaymentRow {
  id: string;
  trip_id: string;
  kind: string;
  status: string;
  amount: number | string | null;
  currency: string | null;
  idempotency_key: string;
  provider: string | null;
  provider_payment_id: string | null;
  provider_status: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Columns written on insert (created_at/updated_at are DB-managed). */
export type PaymentInsertRow = Omit<PaymentRow, "created_at" | "updated_at">;

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function asKind(v: string): PaymentKind {
  return (PAYMENT_KINDS as readonly string[]).includes(v) ? (v as PaymentKind) : "FUNDING";
}

function asStatus(v: string): PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(v) ? (v as PaymentStatus) : "FAILED";
}

export function rowToPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    tripId: row.trip_id,
    kind: asKind(row.kind),
    status: asStatus(row.status),
    amount: toNum(row.amount),
    currency: row.currency ?? "GBP",
    idempotencyKey: row.idempotency_key,
    provider: row.provider ?? "airwallex",
    providerPaymentId: row.provider_payment_id,
    providerStatus: row.provider_status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function paymentToInsertRow(p: Payment): PaymentInsertRow {
  return {
    id: p.id,
    trip_id: p.tripId,
    kind: p.kind,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    idempotency_key: p.idempotencyKey,
    provider: p.provider,
    provider_payment_id: p.providerPaymentId,
    provider_status: p.providerStatus,
    failure_reason: p.failureReason,
  };
}
