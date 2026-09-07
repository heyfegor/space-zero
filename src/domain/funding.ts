/**
 * Space Zero — funding domain (deterministic, server-safe; no LLM/DB/provider).
 *
 * Funding answers ONE question: "is money set aside for this trip?" It is
 * deliberately SEPARATE from authority (what the agent may spend on its own) and
 * from the recovery allowance (extra it may authorize on disruption). Those live
 * on the Trip as `tripBudget` / `recoveryAllowance` and are enforced by the
 * authority engine; funding never touches them.
 *
 * Nothing here moves money or claims a charge. Airwallex is not wired yet — this
 * layer is pure state + arithmetic over an amount that has been *set aside*, and
 * the estimated cost of the selected itinerary. It exists so the funding state
 * is trustworthy and testable independent of any payment provider.
 */

/**
 * The funding lifecycle.
 *  - UNFUNDED     — no balance set aside yet.
 *  - PROCESSING   — an allocation is in flight (a real async funding step later).
 *  - FUNDED       — a sufficient balance is set aside (covers the estimated cost).
 *  - INSUFFICIENT — an amount is set aside but it is below the estimated cost.
 */
export type FundingStatus = "UNFUNDED" | "PROCESSING" | "FUNDED" | "INSUFFICIENT";

export const FUNDING_STATUSES: readonly FundingStatus[] = [
  "UNFUNDED",
  "PROCESSING",
  "FUNDED",
  "INSUFFICIENT",
] as const;

export const DEFAULT_FUNDING_STATUS: FundingStatus = "UNFUNDED";

/**
 * Normalize an arbitrary/legacy value to a known FundingStatus. Uppercases so
 * legacy lowercase rows ("funded") map cleanly to the current convention, and
 * falls back to UNFUNDED for anything unrecognized.
 */
export function asFundingStatus(v: string | null | undefined): FundingStatus {
  if (!v) return DEFAULT_FUNDING_STATUS;
  const upper = v.toUpperCase();
  return (FUNDING_STATUSES as readonly string[]).includes(upper)
    ? (upper as FundingStatus)
    : DEFAULT_FUNDING_STATUS;
}

/**
 * Whether the set-aside amount covers the estimated cost. Requires a positive
 * amount so a zero balance is never "sufficient", even against a zero cost.
 */
export function isSufficient(fundedAmount: number | null | undefined, estimatedCost: number): boolean {
  const amount = fundedAmount ?? 0;
  return amount > 0 && amount >= Math.max(0, estimatedCost);
}

/**
 * Decide the status to PERSIST for a requested funding action, without ever
 * lying about coverage. UNFUNDED/PROCESSING are stored as requested; the two
 * terminal states are resolved from the actual amount vs cost, so a request to
 * mark FUNDED while short is stored as INSUFFICIENT instead.
 */
export function resolveFundingStatus(
  requested: FundingStatus,
  fundedAmount: number | null | undefined,
  estimatedCost: number,
): FundingStatus {
  switch (requested) {
    case "UNFUNDED":
      return "UNFUNDED";
    case "PROCESSING":
      return "PROCESSING";
    case "FUNDED":
    case "INSUFFICIENT":
      return isSufficient(fundedAmount, estimatedCost) ? "FUNDED" : "INSUFFICIENT";
    default:
      return DEFAULT_FUNDING_STATUS;
  }
}

/** The computed funding picture the API returns and the screen renders. */
export interface FundingView {
  /** Effective status, reconciled with coverage (see computeFunding). */
  status: FundingStatus;
  /** Amount set aside (whole/decimal units of `currency`); 0 when unfunded. */
  fundedAmount: number;
  /** Estimated cost of the selected itinerary (0 when none selected). */
  estimatedCost: number;
  /** fundedAmount − estimatedCost. Negative means underfunded. */
  remaining: number;
  /** The spare cushion above cost: max(0, remaining). */
  buffer: number;
  /** How much more is needed to cover the cost: max(0, −remaining). */
  shortfall: number;
  /** True when the set-aside amount covers the estimated cost. */
  sufficient: boolean;
  currency: string;
}

/**
 * Pure funding arithmetic. Amounts are clamped non-negative. The terminal
 * statuses (FUNDED/INSUFFICIENT) are reconciled against the *current* estimated
 * cost so a stored FUNDED that no longer covers a re-priced itinerary is
 * reported honestly as INSUFFICIENT. UNFUNDED/PROCESSING pass through unchanged.
 */
export function computeFunding(input: {
  estimatedCost: number;
  fundedAmount: number | null | undefined;
  status: FundingStatus;
  currency: string;
}): FundingView {
  const estimatedCost = Math.max(0, input.estimatedCost);
  const fundedAmount = Math.max(0, input.fundedAmount ?? 0);
  const remaining = fundedAmount - estimatedCost;
  const sufficient = isSufficient(input.fundedAmount, estimatedCost);

  let status = input.status;
  if (status === "FUNDED" || status === "INSUFFICIENT") {
    status = sufficient ? "FUNDED" : "INSUFFICIENT";
  }

  return {
    status,
    fundedAmount,
    estimatedCost,
    remaining,
    buffer: Math.max(0, remaining),
    shortfall: Math.max(0, -remaining),
    sufficient,
    currency: input.currency,
  };
}
