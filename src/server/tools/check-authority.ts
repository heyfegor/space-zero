/**
 * Tool: check_authority — advisory (read-only) from the agent's perspective.
 *
 * Lets the agent reason about whether a spend would be permitted. It reads the
 * trip's stored recovery allowance (never an agent-supplied limit) and defers
 * entirely to the deterministic authority engine. Advisory only —
 * execute_booking re-checks authoritatively before any action.
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { evaluateAuthority } from "../../domain/authority";
import { resolveTrip } from "./resolve-trip";

export const checkAuthorityTool = tool({
  name: "check_authority",
  description:
    "Read-only/advisory. Given a trip id and an amount the agent wants to " +
    "spend, return whether it is within the trip's recovery allowance. Uses " +
    "the deterministic authority engine. Advisory only — it does not authorize " +
    "or perform anything.",
  inputSchema: z.object({
    tripId: z.string().describe("The trip whose allowance applies"),
    amount: z.number().describe("The amount the agent wants to spend"),
  }),
  callback: async ({ tripId, amount }) => {
    const trip = await resolveTrip(tripId);
    if (!trip) {
      return { found: false, tripId, reason: `No trip found for id ${tripId}.` };
    }
    const authority = evaluateAuthority(
      amount,
      trip.recoveryAllowance,
      trip.currency,
    );
    return { found: true, authority };
  },
});
