/**
 * Space Zero — payment service (server-side orchestration; the money-movement
 * boundary). This is the ONE place that turns an authorized, funded intention
 * into an actual sandbox charge, and it is deliberately conservative:
 *
 *   1. Provider availability — if Airwallex is not configured (and none is
 *      injected), it returns PROVIDER_UNCONFIGURED so the caller keeps the
 *      existing demo/fallback behavior. It never fabricates a charge.
 *   2. Deterministic gate — assessPaymentAuthorization MUST pass first (authority
 *      + funding for a recovery; a valid amount for funding). A refusal means NO
 *      provider call at all.
 *   3. Idempotency — a payment already recorded under the same idempotency key is
 *      REPLAYED (returned as-is), so the provider is called at most once per
 *      logical charge. This is what prevents duplicate charges.
 *   4. Persistence — a PENDING record is written before the provider call (it
 *      reserves the idempotency key and creates the audit row), then reconciled
 *      to the provider's honest outcome. Provider ids are stored; raw provider
 *      responses are not.
 *
 * Only a SUCCEEDED result is a green light — callers must never mark a trip
 * booked/funded/resolved on anything else. Dependencies are injectable so the
 * whole flow is testable with a fake provider + in-memory repo (no key, network).
 */

import {
  assessPaymentAuthorization,
  isPaymentConfirmed,
  type Payment,
  type PaymentGateCode,
  type PaymentKind,
  type PaymentStatus,
} from "../../domain/payment";
import {
  getAirwallexClient,
  isAirwallexConfigured,
  type PaymentProvider,
} from "../../providers/airwallex";
import { getPaymentRepository, type PaymentRepository } from "../persistence/payment-repository";

/** True when a real payment provider (Airwallex sandbox) is configured. */
export function isPaymentProviderConfigured(): boolean {
  return isAirwallexConfigured();
}

const PROVIDER_NAME = "airwallex";

export interface CapturePaymentInput {
  tripId: string;
  kind: PaymentKind;
  /** The amount to charge (must be positive). */
  amount: number;
  currency: string;
  /** Stable key that makes a repeat of the SAME logical charge a no-op. */
  idempotencyKey: string;
  description?: string;
  /** Settled funds available for the trip (funding-coverage check). */
  fundedAmount: number | null;
  /** RECOVERY only — extra spend over the original booking (authority check). */
  additionalCost?: number;
  /** RECOVERY only — the trip's recovery allowance (authority ceiling). */
  recoveryAllowance?: number;
}

export type PaymentResultStatus = PaymentStatus | "REFUSED" | "PROVIDER_UNCONFIGURED";

export interface PaymentResult {
  /** True ONLY when the provider confirmed a SUCCEEDED charge. */
  ok: boolean;
  status: PaymentResultStatus;
  /** Set when the deterministic gate refused the charge (no provider call). */
  code?: PaymentGateCode;
  /** The persisted payment record, or null when refused/unconfigured. */
  payment: Payment | null;
  /** Human-readable, brand-voice explanation. Honest about the outcome. */
  reason: string;
}

export interface CapturePaymentDeps {
  provider?: PaymentProvider;
  paymentRepo?: PaymentRepository;
  makeId?: () => string;
}

/** Truncate a message for the sanitized audit reason (our own thrown text). */
function sanitize(message: string): string {
  return message.slice(0, 300);
}

/**
 * Attempt a payment through the provider, enforcing the gate and idempotency,
 * and persisting an honest record. Never charges twice for the same key, never
 * charges when the gate refuses, and never reports success without a confirmed
 * provider result.
 */
export async function capturePayment(
  input: CapturePaymentInput,
  deps: CapturePaymentDeps = {},
): Promise<PaymentResult> {
  const repo = deps.paymentRepo ?? getPaymentRepository();
  const makeId = deps.makeId ?? (() => crypto.randomUUID());

  // 1. Provider availability — keep the demo/fallback path when unconfigured.
  const provider = deps.provider ?? (isPaymentProviderConfigured() ? getAirwallexClient() : null);
  if (!provider) {
    return {
      ok: false,
      status: "PROVIDER_UNCONFIGURED",
      payment: null,
      reason: "No payment provider is configured, so no real charge was made.",
    };
  }

  // 2. Deterministic gate — authority + funding must pass BEFORE any charge.
  const gate = assessPaymentAuthorization({
    kind: input.kind,
    amount: input.amount,
    currency: input.currency,
    fundedAmount: input.fundedAmount,
    additionalCost: input.additionalCost,
    recoveryAllowance: input.recoveryAllowance,
  });
  if (!gate.permitted) {
    return { ok: false, status: "REFUSED", code: gate.code, payment: null, reason: gate.reason };
  }

  // 3. Idempotency — replay an existing charge for this key; never re-charge.
  const existing = await repo.findByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return {
      ok: isPaymentConfirmed(existing.status),
      status: existing.status,
      payment: existing,
      reason:
        existing.status === "SUCCEEDED"
          ? "This charge was already completed; returning the existing payment (not charged again)."
          : `A payment already exists for this request (${existing.status}); it was not charged again.`,
    };
  }

  // 4a. Reserve the key + write the PENDING audit row before calling the provider.
  const pending: Payment = {
    id: makeId(),
    tripId: input.tripId,
    kind: input.kind,
    status: "PENDING",
    amount: input.amount,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
    provider: PROVIDER_NAME,
    providerPaymentId: null,
    providerStatus: null,
    failureReason: null,
  };

  let record: Payment;
  try {
    record = await repo.add(pending);
  } catch {
    // A concurrent insert won the unique idempotency key — replay that record.
    const raced = await repo.findByIdempotencyKey(input.idempotencyKey);
    if (raced) {
      return {
        ok: isPaymentConfirmed(raced.status),
        status: raced.status,
        payment: raced,
        reason: `A payment already exists for this request (${raced.status}); it was not charged again.`,
      };
    }
    throw new Error("Could not record the payment attempt.");
  }

  // 4b. Call the provider. Only a confirmed result becomes a success.
  try {
    const result = await provider.createPayment({
      requestId: input.idempotencyKey,
      merchantOrderId: `${input.kind.toLowerCase()}:${input.tripId}`,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
    });

    const updated = (await repo.update(record.id, {
      status: result.status,
      providerPaymentId: result.providerPaymentId,
      providerStatus: result.providerStatus,
      failureReason:
        result.status === "SUCCEEDED" || result.status === "PENDING"
          ? null
          : `Provider reported ${result.providerStatus ?? result.status}.`,
    })) ?? record;

    return {
      ok: isPaymentConfirmed(updated.status),
      status: updated.status,
      payment: updated,
      reason: reasonFor(updated.status, input.currency, input.amount),
    };
  } catch (err) {
    // Honest failure — nothing confirmed, recorded as FAILED, no fabricated success.
    const message = err instanceof Error ? err.message : String(err);
    const updated = (await repo.update(record.id, {
      status: "FAILED",
      failureReason: sanitize(message),
    })) ?? { ...record, status: "FAILED" as PaymentStatus };
    return {
      ok: false,
      status: "FAILED",
      payment: updated,
      reason: "The payment provider did not confirm the charge. Nothing was captured; try again.",
    };
  }
}

function reasonFor(status: PaymentStatus, currency: string, amount: number): string {
  switch (status) {
    case "SUCCEEDED":
      return `Payment of ${currency}${amount} confirmed by the provider.`;
    case "PENDING":
      return `Payment of ${currency}${amount} is pending confirmation with the provider; nothing is settled yet.`;
    case "DECLINED":
      return "The payment was declined by the provider. Nothing was captured.";
    default:
      return "The payment could not be completed. Nothing was captured.";
  }
}
