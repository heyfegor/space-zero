/**
 * Tool: recover_trip — READ-ONLY. Finds and ranks recovery options for an
 * at-risk trip and flags each option's authority status. It performs NO side
 * effect: it does not book, does not change trip state, does not touch the
 * store. Rebooking goes through execute_booking (the single money path).
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { evaluateAuthority } from "../../domain/authority";
import { getTripById } from "./dev-store";
import { recoveryOptionsFor } from "./recovery-fixtures";

export const recoverTripTool = tool({
  name: "recover_trip",
  description:
    "Read-only. For an at-risk trip, return a small ranked set of recovery " +
    "options with additional cost, new arrival, and whether each is within the " +
    "recovery allowance. Does NOT book anything or change trip state — use " +
    "execute_booking to act.",
  inputSchema: z.object({
    tripId: z.string().describe("The at-risk trip to find recovery options for"),
  }),
  callback: ({ tripId }) => {
    const trip = getTripById(tripId);
    if (!trip) {
      return { found: false, tripId, reason: `No trip found for id ${tripId}.` };
    }

    const options = recoveryOptionsFor(trip).map((opt) => {
      const authority = evaluateAuthority(
        opt.additionalCost,
        trip.recoveryAllowance,
        trip.currency,
      );
      return {
        id: opt.id,
        from: opt.from,
        to: opt.to,
        additionalCost: opt.additionalCost,
        currency: opt.currency,
        newArrival: opt.newArrival,
        newArrivalLabel: opt.newArrivalLabel,
        withinAuthority: authority.permitted,
        authorityReason: authority.reason,
      };
    });

    return { found: true, tripId, options };
  },
});
