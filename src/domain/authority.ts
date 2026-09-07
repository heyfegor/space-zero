/**
 * Space Zero — deterministic authority engine (server-side, NO LLM).
 *
 * This is the single source of truth for "is this spend permitted?". The model
 * may REQUEST an action, but it can never decide authorization — this pure
 * function does, and every money path routes through it. No network, no
 * randomness, no model calls: same inputs always yield the same result.
 *
 * Core rule: requestedAmount <= recoveryAllowance  (inclusive at the boundary).
 */

export interface AuthorityResult {
  /** True only when the spend is within the allowance. */
  permitted: boolean;
  requestedAmount: number;
  recoveryAllowance: number;
  /** Allowance left after this spend if permitted; unchanged if denied. */
  remainingAllowance: number;
  currency: string;
  /** Human-readable, brand-voice explanation of the decision. */
  reason: string;
}

/**
 * Evaluate a proposed spend against a recovery allowance.
 *
 * Guards invalid inputs (negative / non-finite amounts, negative allowance) by
 * denying — the choke point should fail closed, never open.
 */
export function evaluateAuthority(
  requestedAmount: number,
  recoveryAllowance: number,
  currency = "GBP",
): AuthorityResult {
  const base: Omit<AuthorityResult, "permitted" | "remainingAllowance" | "reason"> =
    {
      requestedAmount,
      recoveryAllowance,
      currency,
    };

  // Fail closed on nonsensical inputs.
  if (!Number.isFinite(requestedAmount) || requestedAmount < 0) {
    return {
      ...base,
      permitted: false,
      remainingAllowance: recoveryAllowance,
      reason: `Denied. Requested amount ${requestedAmount} is not a valid non-negative number.`,
    };
  }
  if (!Number.isFinite(recoveryAllowance) || recoveryAllowance < 0) {
    return {
      ...base,
      permitted: false,
      remainingAllowance: 0,
      reason: `Denied. Recovery allowance ${recoveryAllowance} is not a valid non-negative number.`,
    };
  }

  const permitted = requestedAmount <= recoveryAllowance;

  if (permitted) {
    const remainingAllowance = recoveryAllowance - requestedAmount;
    return {
      ...base,
      permitted: true,
      remainingAllowance,
      reason: `Permitted. ${currency}${requestedAmount} is within the ${currency}${recoveryAllowance} recovery allowance (${currency}${remainingAllowance} remaining).`,
    };
  }

  return {
    ...base,
    permitted: false,
    remainingAllowance: recoveryAllowance,
    reason: `Denied. ${currency}${requestedAmount} exceeds the ${currency}${recoveryAllowance} recovery allowance by ${currency}${requestedAmount - recoveryAllowance}.`,
  };
}
