/**
 * Space Zero — payment domain (deterministic, server-safe; NO LLM/DB/provider).
 *
 * Payment is the money-MOVEMENT concern, distinct from funding (is money set
 * aside?) and authority (may the agent spend it?). This module is pure state +
 * the deterministic gate that MUST pass before any charge is attempted, plus the
 * shape of a persisted payment record. It never calls a provider, a DB, or the
 * model — same inputs always yield the same decision, so the "no charge unless
 * authorized and funded" rule is enforced in code and testable in isolation.
 *
 * The actual provider call (Airwallex, sandbox) lives behind the provider seam
 * (src/providers/airwallex.ts); the orchestration that combines this gate, the
 * provider, idempotency, and persistence lives in the payment service
 * (src/server/payments/payment-service.ts).
 */

import { evaluateAuthority } from "./authority";
import { isSufficient } from "./funding";

/**
 * The honest payment lifecycle. There is deliberately no "unknown" — a provider
 * result that cannot be classified is treated as FAILED, never as success.
 *  - PENDING   — the provider accepted the request but has not settled it
 *                (e.g. a payment intent awaiting confirmation/capture).
 *  - SUCCEEDED — the provider CONFIRMED the money moved. The only green light.
 *  - FAILED    — the provider errored, or the result could not be confirmed.
 *  - DECLINED  — the provider actively refused the charge (e.g. card declined).
 */
export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "DECLINED";

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "DECLINED",
] as const;

/** What the payment is for. Funding tops up the trip; recovery pays the extra. */
export type PaymentKind = "FUNDING" | "RECOVERY";

export const PAYMENT_KINDS: readonly PaymentKind[] = ["FUNDING", "RECOVERY"] as const;

/** Only a confirmed SUCCEEDED payment may unlock a booking/resolution. */
export function isPaymentConfirmed(status: PaymentStatus): boolean {
  return status === "SUCCEEDED";
}

/**
 * Normalize an arbitrary/legacy value to a known PaymentStatus. Anything
 * unrecognized becomes FAILED — never a fabricated success.
 */
export function asPaymentStatus(v: string | null | undefined): PaymentStatus {
  if (!v) return "FAILED";
  const upper = v.toUpperCase();
  return (PAYMENT_STATUSES as readonly string[]).includes(upper) ? (upper as PaymentStatus) : "FAILED";
}

/**
 * A persisted payment record — the audit of every charge attempt. Provider ids
 * are stored server-side only; the provider's raw response is NEVER kept here
 * (only a sanitized status/reason), so nothing sensitive can leak to a client
 * that later reads a payment.
 */
export interface Payment {
  id: string;
  tripId: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amount: number;
  currency: string;
  /** The key that makes a repeat of the SAME logical charge a no-op. */
  idempotencyKey: string;
  /** Which provider handled it (e.g. "airwallex"). */
  provider: string;
  /** The provider's own id for the payment/intent, or null before one exists. */
  providerPaymentId: string | null;
  /** The provider's own status string, sanitized (never raw JSON). */
  providerStatus: string | null;
  /** A short, sanitized reason on a non-success outcome; never provider secrets. */
  failureReason: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Why a charge was refused BEFORE any provider call (fail closed). */
export type PaymentGateCode = "OK" | "INVALID_AMOUNT" | "INSUFFICIENT_FUNDING" | "OVER_ALLOWANCE";

export interface PaymentGateInput {
  kind: PaymentKind;
  /** The amount to charge (must be a finite, positive number). */
  amount: number;
  currency: string;
  /** Settled funds available for the trip (for the funding-coverage check). */
  fundedAmount: number | null;
  /** RECOVERY only — the extra spend over the original booking (authority check). */
  additionalCost?: number;
  /** RECOVERY only — the trip's recovery allowance (authority ceiling). */
  recoveryAllowance?: number;
}

export interface PaymentGateResult {
  permitted: boolean;
  code: PaymentGateCode;
  /** Human-readable, brand-voice explanation. */
  reason: string;
}

/**
 * The deterministic gate that MUST pass before any charge. Fail closed:
 *   - Every payment needs a finite, positive amount.
 *   - A RECOVERY payment additionally requires the extra spend to be WITHIN the
 *     recovery allowance (authority) AND the total to be covered by set-aside
 *     funds (funding). These are the "existing deterministic authority and
 *     funding checks" that must pass first.
 *   - A FUNDING payment is the money coming IN, so it has no authority ceiling
 *     and no prior funding to cover — only the amount must be valid.
 *
 * This never mutates anything; it only decides whether a charge is allowed.
 */
export function assessPaymentAuthorization(input: PaymentGateInput): PaymentGateResult {
  const { kind, amount, currency } = input;

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      permitted: false,
      code: "INVALID_AMOUNT",
      reason: `A payment needs a positive amount; ${amount} is not valid. Nothing was charged.`,
    };
  }

  if (kind === "RECOVERY") {
    const additionalCost = input.additionalCost ?? amount;
    const recoveryAllowance = input.recoveryAllowance ?? 0;

    const authority = evaluateAuthority(additionalCost, recoveryAllowance, currency);
    if (!authority.permitted) {
      return { permitted: false, code: "OVER_ALLOWANCE", reason: authority.reason };
    }

    if (!isSufficient(input.fundedAmount, amount)) {
      return {
        permitted: false,
        code: "INSUFFICIENT_FUNDING",
        reason: `The funds set aside do not cover this ${currency}${amount} payment. Nothing was charged.`,
      };
    }
  }

  return { permitted: true, code: "OK", reason: "Authorized to charge." };
}

/**
 * Build a deterministic idempotency key from stable parts. The SAME logical
 * charge (same trip, same purpose, same amount) always produces the same key,
 * so a retry re-uses the existing payment instead of charging twice. Parts are
 * sanitized to a compact, key-safe form.
 */
export function buildIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => (p === null || p === undefined ? "_" : String(p)))
    .map((s) => s.replace(/[^A-Za-z0-9._:-]/g, "-"))
    .join(":");
}
