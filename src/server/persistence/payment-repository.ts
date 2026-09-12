/**
 * Space Zero — payment persistence boundary (server-side only).
 *
 * Mirrors the recovery/disruption repositories: a Supabase-backed store when
 * configured, an in-memory store for local dev and tests. Payments are the audit
 * of every charge attempt. The `idempotency_key` is UNIQUE — `findByIdempotencyKey`
 * lets the payment service turn a repeat of the same logical charge into a no-op,
 * which is what prevents duplicate charges.
 */

import type { Payment, PaymentStatus } from "../../domain/payment";
import { isSupabaseConfigured } from "./trip-repository";
import { getSupabaseAdmin } from "./supabase-client";
import { rowToPayment, paymentToInsertRow, type PaymentRow } from "./payment-row";

/** A sanitized patch to a payment's outcome (never provider raw data). */
export interface PaymentPatch {
  status?: PaymentStatus;
  providerPaymentId?: string | null;
  providerStatus?: string | null;
  failureReason?: string | null;
}

export interface PaymentRepository {
  /** Persist a new payment record. Returns the stored record. */
  add(payment: Payment): Promise<Payment>;
  /** Look up a payment by its idempotency key, or null. */
  findByIdempotencyKey(key: string): Promise<Payment | null>;
  /** Apply a sanitized outcome patch. Returns the updated record, or null. */
  update(id: string, patch: PaymentPatch): Promise<Payment | null>;
  /** List a trip's payments, newest first. */
  listForTrip(tripId: string): Promise<Payment[]>;
}

// --- In-memory --------------------------------------------------------------

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly byId = new Map<string, Payment>();
  private readonly byKey = new Map<string, string>();

  async add(payment: Payment): Promise<Payment> {
    const now = new Date().toISOString();
    const record: Payment = {
      ...payment,
      createdAt: payment.createdAt ?? now,
      updatedAt: now,
    };
    this.byId.set(record.id, record);
    this.byKey.set(record.idempotencyKey, record.id);
    return { ...record };
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    const id = this.byKey.get(key);
    if (!id) return null;
    const record = this.byId.get(id);
    return record ? { ...record } : null;
  }

  async update(id: string, patch: PaymentPatch): Promise<Payment | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;
    const updated: Payment = { ...existing, updatedAt: new Date().toISOString() };
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.providerPaymentId !== undefined) updated.providerPaymentId = patch.providerPaymentId;
    if (patch.providerStatus !== undefined) updated.providerStatus = patch.providerStatus;
    if (patch.failureReason !== undefined) updated.failureReason = patch.failureReason;
    this.byId.set(id, updated);
    return { ...updated };
  }

  async listForTrip(tripId: string): Promise<Payment[]> {
    return [...this.byId.values()]
      .filter((p) => p.tripId === tripId)
      .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))
      .map((p) => ({ ...p }));
  }

  clear(): void {
    this.byId.clear();
    this.byKey.clear();
  }
}

// --- Supabase ---------------------------------------------------------------

export class SupabasePaymentRepository implements PaymentRepository {
  async add(payment: Payment): Promise<Payment> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("payments")
      .insert(paymentToInsertRow(payment))
      .select("*")
      .single();
    if (error) throw new Error(`Failed to persist payment: ${error.message}`);
    return rowToPayment(data as PaymentRow);
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("payments")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) throw new Error(`Failed to look up payment: ${error.message}`);
    return data ? rowToPayment(data as PaymentRow) : null;
  }

  async update(id: string, patch: PaymentPatch): Promise<Payment | null> {
    const db = getSupabaseAdmin();
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.providerPaymentId !== undefined) row.provider_payment_id = patch.providerPaymentId;
    if (patch.providerStatus !== undefined) row.provider_status = patch.providerStatus;
    if (patch.failureReason !== undefined) row.failure_reason = patch.failureReason;
    const { data, error } = await db.from("payments").update(row).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`Failed to update payment: ${error.message}`);
    return data ? rowToPayment(data as PaymentRow) : null;
  }

  async listForTrip(tripId: string): Promise<Payment[]> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("payments")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to load payments: ${error.message}`);
    return (data as PaymentRow[]).map(rowToPayment);
  }
}

// --- Factory ----------------------------------------------------------------

let inMemorySingleton: PaymentRepository | null = null;
let supabaseSingleton: PaymentRepository | null = null;

export function getPaymentRepository(): PaymentRepository {
  if (isSupabaseConfigured()) {
    if (!supabaseSingleton) supabaseSingleton = new SupabasePaymentRepository();
    return supabaseSingleton;
  }
  if (!inMemorySingleton) inMemorySingleton = new InMemoryPaymentRepository();
  return inMemorySingleton;
}
