/**
 * Space Zero — deterministic flight-option ranking (server-side, no LLM).
 *
 * The model never invents or orders flights. Given normalized options and the
 * trip's criteria, this pure function:
 *   1. ENFORCES the hard arrival deadline — options arriving after it are
 *      dropped from the valid set entirely.
 *   2. Ranks the remaining options by a fixed weighted score over deadline
 *      margin, cost, duration, connections, and preference match.
 *   3. Assigns rank (0 = best) and flags the single best as recommended.
 *
 * Same inputs always produce the same ordering (ties broken by cost then the
 * provider offer id), so results are reproducible.
 */

import type { FlightOption } from "../../domain/flight-option";

export interface RankCriteria {
  /** ISO 8601 hard arrival deadline. Options arriving after are invalid. */
  deadline?: string | null;
  /** Optional preference predicate; matched options score better. */
  preferMatch?: (option: FlightOption) => boolean;
}

export interface RankResult {
  /** Valid options, best-first, with rank/recommended set. */
  ranked: FlightOption[];
  /** Options excluded for missing the hard arrival deadline. */
  dropped: FlightOption[];
}

const WEIGHTS = { cost: 0.4, duration: 0.2, connections: 0.15, margin: 0.15, pref: 0.1 };

export function rankOptions(options: FlightOption[], criteria: RankCriteria = {}): RankResult {
  const deadlineMs = criteria.deadline ? Date.parse(criteria.deadline) : Number.NaN;
  const hasDeadline = Number.isFinite(deadlineMs);

  const valid: FlightOption[] = [];
  const dropped: FlightOption[] = [];
  for (const o of options) {
    if (hasDeadline) {
      const arr = Date.parse(o.arriveAt);
      if (Number.isFinite(arr) && arr > deadlineMs) { dropped.push(o); continue; }
    }
    valid.push(o);
  }
  if (valid.length === 0) return { ranked: [], dropped };

  const maxCost = Math.max(1, ...valid.map((o) => o.totalAmount));
  const maxDur = Math.max(1, ...valid.map((o) => o.durationMinutes));
  const maxConn = Math.max(1, ...valid.map((o) => o.connections));
  const margins = valid.map((o) => (hasDeadline ? deadlineMs - Date.parse(o.arriveAt) : 0));
  const maxMargin = Math.max(1, ...margins);

  const scored = valid.map((o, i) => {
    const costN = o.totalAmount / maxCost;
    const durN = o.durationMinutes / maxDur;
    const connN = o.connections / maxConn;
    // Less buffer before the deadline → higher penalty. Neutral without a deadline.
    const marginN = hasDeadline ? 1 - margins[i] / maxMargin : 0;
    const prefN = criteria.preferMatch ? (criteria.preferMatch(o) ? 0 : 1) : 0;
    const penalty =
      WEIGHTS.cost * costN +
      WEIGHTS.duration * durN +
      WEIGHTS.connections * connN +
      WEIGHTS.margin * marginN +
      WEIGHTS.pref * prefN;
    return { o, penalty };
  });

  scored.sort((a, b) =>
    a.penalty !== b.penalty
      ? a.penalty - b.penalty
      : a.o.totalAmount !== b.o.totalAmount
        ? a.o.totalAmount - b.o.totalAmount
        : a.o.providerOfferId.localeCompare(b.o.providerOfferId),
  );

  const ranked = scored.map(({ o }, i) => ({ ...o, rank: i, recommended: i === 0 }));
  return { ranked, dropped };
}
