/**
 * Tool: evaluate_recovery_options — READ-ONLY. Deterministically evaluate the
 * searched alternatives against the trip requirements and the STORED authority,
 * funding, budget, and auto-recovery permission. Returns the backend's verdict —
 * the model does not decide eligibility, ranking, or authority itself. Does not book.
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { evaluateRecoveryOptions } from "../recovery/recovery-service";

export const evaluateRecoveryOptionsTool = tool({
  name: "evaluate_recovery_options",
  description:
    "Read-only. Deterministically evaluate the searched recovery alternatives " +
    "against the arrival requirement, connection feasibility, recovery allowance, " +
    "funding, budget, and the trip's stored auto-recovery permission. Returns the " +
    "decision (AUTO_BOOK / ESCALATE / NO_OPTION) and per-option flags. You must NOT " +
    "override this verdict — if it says ESCALATE, do not try to book. Use " +
    "execute_booking to act on an AUTO_BOOK decision.",
  inputSchema: z.object({
    tripId: z.string().describe("The at-risk trip to evaluate recovery options for"),
  }),
  callback: async ({ tripId }) => {
    const result = await evaluateRecoveryOptions(tripId);
    if (!result) return { found: false, tripId, reason: `No trip found for id ${tripId}.` };
    const { evaluation } = result;
    return {
      found: true,
      tripId,
      decision: evaluation.decision.kind,
      escalationReason: evaluation.decision.escalationReason ?? null,
      reason: evaluation.decision.reason,
      best: evaluation.best
        ? {
            from: evaluation.best.from,
            to: evaluation.best.to,
            additionalCost: evaluation.best.additionalCost,
            totalAmount: evaluation.best.totalAmount,
            newArrival: evaluation.best.newArrivalLabel,
            withinAuthority: evaluation.best.withinAuthority,
            funded: evaluation.best.funded,
            withinBudget: evaluation.best.withinBudget,
            bookable: evaluation.best.bookable,
          }
        : null,
      candidateCount: evaluation.options.length,
      eligibleCount: evaluation.options.filter((o) => o.eligible).length,
    };
  },
});
