/**
 * Tool: search_recovery_options — search alternative flights for an at-risk trip
 * through Duffel. Deterministic normalize + rank, enforcing the arrival
 * requirement. It does NOT book and does NOT overwrite the booked itinerary; the
 * ranked candidates are held for the evaluate/execute steps. Honest status when
 * the provider is unavailable — never fabricated flights.
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { searchRecoveryAlternatives } from "../recovery/recovery-service";

export const searchRecoveryOptionsTool = tool({
  name: "search_recovery_options",
  description:
    "Search real alternative flights for an at-risk trip. It queries the provider " +
    "and ranks results deterministically, enforcing the arrival requirement — you " +
    "must NOT invent, filter, or reorder flights. Returns a status (ok / no_results " +
    "/ provider_unconfigured / provider_error / origin_unknown / destination_unknown) " +
    "and the number of candidates found. Does not book.",
  inputSchema: z.object({
    tripId: z.string().describe("The at-risk trip to search alternatives for"),
  }),
  callback: async ({ tripId }) => {
    const result = await searchRecoveryAlternatives(tripId);
    return {
      tripId,
      status: result.status,
      count: result.candidates.length,
    };
  },
});
