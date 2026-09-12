/**
 * Space Zero — recovery evaluation (deterministic, server-safe; NO LLM/DB/provider).
 *
 * This is the ONE place that decides which recovery alternative is bookable and
 * whether recovery may proceed automatically. The agent may search and surface
 * options, but it NEVER decides authority, funding, ranking, or eligibility —
 * this pure function does, over authoritative values the backend loaded.
 *
 * The deterministic checks, in fixed order:
 *   - Original arrival requirement — the alternative must arrive no later than
 *     the trip's requirement (its hard deadline, or the originally-booked arrival
 *     when no machine deadline is stored).
 *   - Connection feasibility — every connection in the alternative must leave at
 *     least the minimum connection time.
 *   - Recovery allowance — the ADDITIONAL cost over the disrupted booking must be
 *     within the stored recovery allowance (authority engine).
 *   - Available funding — the alternative's total must be covered by funds set aside.
 *   - Trip budget — the alternative's total must be within the trip budget.
 *   - Stored automatic-recovery permission — auto-book only if the trip allows it.
 *
 * A permitted best option → AUTO_BOOK. Anything eligible but over authority/funding,
 * or with auto-recovery off, or with no eligible option → ESCALATE (user approval).
 */

import { evaluateAuthority } from "./authority";
import { isSufficient } from "./funding";
import type { FlightOption, FlightSegment } from "./flight-option";

export type RecoveryDecisionKind = "AUTO_BOOK" | "ESCALATE" | "NO_OPTION";

/** Why recovery needs the traveler (an escalation), or why it could not proceed. */
export type EscalationReason =
  | "OVER_ALLOWANCE" // best eligible option's extra cost exceeds the recovery allowance
  | "INSUFFICIENT_FUNDING" // funds set aside do not cover the alternative
  | "OVER_BUDGET" // the alternative exceeds the trip budget
  | "AUTO_RECOVERY_DISABLED" // the traveler has automatic recovery turned off
  | "NO_ELIGIBLE_OPTION"; // nothing still meets the arrival/connection requirement

export const ESCALATION_REASONS: readonly EscalationReason[] = [
  "OVER_ALLOWANCE",
  "INSUFFICIENT_FUNDING",
  "OVER_BUDGET",
  "AUTO_RECOVERY_DISABLED",
  "NO_ELIGIBLE_OPTION",
] as const;

/** Authoritative context for the decision — every value comes from the store. */
export interface RecoveryContext {
  /** The alternative must arrive no later than this ISO time; null = unknown. */
  arrivalRequirement: string | null;
  /** Cost already committed on the disrupted booking (for additional-cost math). */
  originalCost: number;
  recoveryAllowance: number;
  fundedAmount: number | null;
  tripBudget: number;
  currency: string;
  /** The trip's stored automatic-recovery permission (Trip.autoRebook). */
  autoRecovery: boolean;
  /** Minimum minutes required between a connection's arrival and next departure. */
  minConnectionMinutes?: number;
}

export interface EvaluatedOption {
  optionId: string;
  providerOfferId: string;
  from: string;
  to: string;
  via: string[];
  totalAmount: number;
  /** max(0, totalAmount − originalCost) — the extra spend authority is checked on. */
  additionalCost: number;
  currency: string;
  arriveAt: string;
  newArrivalLabel: string;
  connections: number;
  meetsArrival: boolean;
  connectionsFeasible: boolean;
  /** Meets the hard requirements (arrival + connections), before money checks. */
  eligible: boolean;
  withinAuthority: boolean;
  funded: boolean;
  withinBudget: boolean;
  /** Eligible AND within authority, funded, and within budget. */
  bookable: boolean;
  rank: number;
}

export interface RecoveryEvaluation {
  /** Every candidate, eligible-first then by rank. */
  options: EvaluatedOption[];
  /** The best ELIGIBLE option (meets arrival + connections), regardless of money. */
  best: EvaluatedOption | null;
  decision: {
    kind: RecoveryDecisionKind;
    /** The option the decision refers to (the best eligible), or null. */
    option: EvaluatedOption | null;
    escalationReason?: EscalationReason;
    /** Amount over the binding limit (allowance/funding/budget), when escalating. */
    overBy?: number;
    currency: string;
    /** Brand-voice explanation. Factual, no filler. */
    reason: string;
  };
}

/**
 * A persisted recovery outcome — the record the Disruption/Resolution screens
 * read. RECOVERED means Space Zero rebooked within authority; ESCALATED means it
 * stopped and needs the traveler (over authority/funding, auto-recovery off, or
 * no eligible option). Nothing is ever recorded RECOVERED without a confirmed
 * provider order.
 */
export type RecoveryStatus = "RECOVERED" | "ESCALATED";

export const RECOVERY_STATUSES: readonly RecoveryStatus[] = ["RECOVERED", "ESCALATED"] as const;

export interface Recovery {
  id: string;
  tripId: string;
  disruptionId: string | null;
  status: RecoveryStatus;
  from: string;
  to: string;
  currency: string;
  /** The chosen/best option's extra cost over the disrupted booking. */
  additionalCost: number;
  /** The chosen/best option's total fare. */
  totalAmount: number;
  /** New arrival of the chosen/best option (ISO), and a short label. */
  newArrival: string | null;
  newArrivalLabel: string | null;
  /** The disrupted booking's original arrival label, for a before/after view. */
  previousArrivalLabel: string | null;
  // Set only on a RECOVERED (confirmed) order.
  bookingReference: string | null;
  duffelOrderId: string | null;
  finalCost: number | null;
  // Set only on an ESCALATED outcome.
  escalationReason: EscalationReason | null;
  /** Amount over the binding limit when escalating. */
  overBy: number | null;
  /** Brand-voice explanation shown to the traveler. */
  reason: string;
  createdAt?: string;
}

const DEFAULT_MIN_CONNECTION_MINUTES = 45;

function minutesBetween(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 60000);
}

/** Every connection in the itinerary leaves at least the minimum connection time. */
export function connectionsFeasible(segments: FlightSegment[], minConnectionMinutes: number): boolean {
  for (let i = 0; i < segments.length - 1; i++) {
    const gap = minutesBetween(segments[i].arriveAt, segments[i + 1].departAt);
    if (gap === null || gap < minConnectionMinutes) return false;
  }
  return true;
}

function arrivalLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(new Date(t));
  } catch {
    return iso;
  }
}

function money(currency: string, amount: number): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
  return `${symbol}${Math.round(amount)}`;
}

/**
 * Deterministically evaluate recovery alternatives against the trip requirements
 * and stored authority/funding. Pure: same inputs → same decision. The candidate
 * order is honored for ranking (the search already ranked them); this only
 * partitions eligible-first and flags each option.
 */
export function evaluateRecovery(
  candidates: FlightOption[],
  ctx: RecoveryContext,
): RecoveryEvaluation {
  const minConnection = ctx.minConnectionMinutes ?? DEFAULT_MIN_CONNECTION_MINUTES;
  const requirementMs = ctx.arrivalRequirement ? Date.parse(ctx.arrivalRequirement) : Number.NaN;
  const hasRequirement = Number.isFinite(requirementMs);

  const evaluated: EvaluatedOption[] = candidates.map((o) => {
    const arriveMs = Date.parse(o.arriveAt);
    const meetsArrival = hasRequirement && Number.isFinite(arriveMs) ? arriveMs <= requirementMs : true;
    const feasible = connectionsFeasible(o.segments, minConnection);
    const additionalCost = Math.max(0, o.totalAmount - ctx.originalCost);
    const withinAuthority = evaluateAuthority(additionalCost, ctx.recoveryAllowance, ctx.currency).permitted;
    const funded = isSufficient(ctx.fundedAmount, o.totalAmount);
    const withinBudget = o.totalAmount <= ctx.tripBudget;
    const eligible = meetsArrival && feasible;
    return {
      optionId: o.id,
      providerOfferId: o.providerOfferId,
      from: o.segments[0]?.from ?? "",
      to: o.segments.at(-1)?.to ?? "",
      via: o.segments.slice(0, -1).map((s) => s.to),
      totalAmount: o.totalAmount,
      additionalCost,
      currency: o.currency,
      arriveAt: o.arriveAt,
      newArrivalLabel: arrivalLabel(o.arriveAt),
      connections: o.connections,
      meetsArrival,
      connectionsFeasible: feasible,
      eligible,
      withinAuthority,
      funded,
      withinBudget,
      bookable: eligible && withinAuthority && funded && withinBudget,
      rank: o.rank,
    };
  });

  // Eligible options first, each group ordered by the search's deterministic rank.
  const ordered = [...evaluated].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return a.rank - b.rank;
  });
  const best = ordered.find((o) => o.eligible) ?? null;

  const c = ctx.currency;
  let decision: RecoveryEvaluation["decision"];

  if (!best) {
    decision = {
      kind: "NO_OPTION",
      option: null,
      escalationReason: "NO_ELIGIBLE_OPTION",
      currency: c,
      reason:
        "No alternative still meets your arrival requirement with a workable connection. I won't rebook something that misses your trip — your decision is needed.",
    };
  } else if (!ctx.autoRecovery) {
    decision = {
      kind: "ESCALATE",
      option: best,
      escalationReason: "AUTO_RECOVERY_DISABLED",
      currency: c,
      reason: `Automatic recovery is off for this trip. I found a fix arriving ${best.newArrivalLabel} for ${money(c, best.additionalCost)} more — approve it to rebook.`,
    };
  } else if (!best.withinBudget) {
    decision = {
      kind: "ESCALATE",
      option: best,
      escalationReason: "OVER_BUDGET",
      overBy: best.totalAmount - ctx.tripBudget,
      currency: c,
      reason: `The best alternative (${money(c, best.totalAmount)}) exceeds the ${money(c, ctx.tripBudget)} trip budget. I won't spend past it without you.`,
    };
  } else if (!best.funded) {
    decision = {
      kind: "ESCALATE",
      option: best,
      escalationReason: "INSUFFICIENT_FUNDING",
      overBy: best.totalAmount - (ctx.fundedAmount ?? 0),
      currency: c,
      reason: `The best alternative costs ${money(c, best.totalAmount)}, more than the funds set aside for this trip. Add funds or approve to proceed.`,
    };
  } else if (!best.withinAuthority) {
    decision = {
      kind: "ESCALATE",
      option: best,
      escalationReason: "OVER_ALLOWANCE",
      overBy: best.additionalCost - ctx.recoveryAllowance,
      currency: c,
      reason: `The best alternative costs ${money(c, best.additionalCost)} more, over your ${money(c, ctx.recoveryAllowance)} recovery allowance. I will not spend past it without you.`,
    };
  } else {
    decision = {
      kind: "AUTO_BOOK",
      option: best,
      currency: c,
      reason: `Rebooking within authority: arrives ${best.newArrivalLabel} for ${money(c, best.additionalCost)} more, inside your ${money(c, ctx.recoveryAllowance)} recovery allowance.`,
    };
  }

  return { options: ordered, best, decision };
}
