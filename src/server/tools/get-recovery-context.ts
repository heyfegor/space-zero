/**
 * Tool: get_recovery_context — READ-ONLY. For an at-risk trip, return the trip,
 * its latest threatening disruption, and the booked itinerary being recovered
 * (with the authoritative arrival requirement). No side effects, no booking.
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { getRecoveryContext } from "../recovery/recovery-service";

export const getRecoveryContextTool = tool({
  name: "get_recovery_context",
  description:
    "Read-only. For an at-risk persisted trip, return the affected trip, its " +
    "latest threatening disruption, and the booked itinerary with the arrival " +
    "requirement. Use this first when recovering a disruption. Does not book.",
  inputSchema: z.object({
    tripId: z.string().describe("The at-risk trip to load recovery context for"),
  }),
  callback: async ({ tripId }) => {
    const ctx = await getRecoveryContext(tripId);
    if (!ctx) return { found: false, tripId, reason: `No trip found for id ${tripId}.` };
    return {
      found: true,
      tripId,
      tripStatus: ctx.trip.status,
      currency: ctx.trip.currency,
      recoveryAllowance: ctx.trip.recoveryAllowance,
      autoRecovery: ctx.trip.autoRebook,
      arrivalRequirement: ctx.arrivalRequirement,
      originalCost: ctx.originalCost,
      disruption: ctx.disruption
        ? { type: ctx.disruption.type, summary: ctx.disruption.summary, segment: `${ctx.disruption.from}→${ctx.disruption.to}` }
        : null,
      booked: ctx.booked
        ? { from: ctx.booked.segments[0]?.from ?? "", to: ctx.booked.segments.at(-1)?.to ?? "", arriveAt: ctx.booked.arriveAt }
        : null,
    };
  },
});
