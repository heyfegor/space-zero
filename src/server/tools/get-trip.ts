/**
 * Tool: get_trip — read-only. Returns the current trip state, resolving a real
 * persisted trip first and falling back to the in-memory staged/demo store.
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { resolveTrip } from "./resolve-trip";

export const getTripTool = tool({
  name: "get_trip",
  description:
    "Read-only. Return the current state of a trip by id: route, status, " +
    "budget, recovery allowance, and booking reference if any.",
  inputSchema: z.object({
    tripId: z.string().describe("The trip id to fetch"),
  }),
  callback: async ({ tripId }) => {
    const trip = await resolveTrip(tripId);
    if (!trip) {
      return { found: false, tripId, reason: `No trip found for id ${tripId}.` };
    }
    return { found: true, trip };
  },
});
