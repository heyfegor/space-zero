/**
 * Tool: execute_booking — the single money/action CHOKE POINT.
 *
 * The ONLY tool that performs a booking side effect. It has two paths, chosen by
 * where the trip lives — but BOTH enforce authorization server-side and never
 * trust a cost/limit the model passed:
 *
 *   REAL path (a persisted trip in the repository):
 *     Delegates to bookTrip, which loads the authoritative trip + selected offer
 *     from the store, runs the deterministic precondition gate (authorized,
 *     option selected, offer valid, funded, within budget), confirms the offer
 *     is live, then creates a real Duffel order. Only a provider-confirmed order
 *     reports success; it persists the order id, reference, final cost, and
 *     booking status, and advances trip state.
 *
 *   STAGED path (the in-memory recovery/demo fixtures):
 *     1. Reads the trip and its AUTHORITATIVE recovery allowance from the store.
 *     2. Calls the deterministic authority engine ITSELF (executeStagedBooking) —
 *        it never relies on the model having called check_authority first.
 *     3. Refuses if authority is denied — no reference, no state change.
 *     4. On a permitted spend: records a STAGED confirmation with a deterministic
 *        reference AND advances trip state through the validated state machine.
 *
 * recover_trip never books; execution flows only through this tool.
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { executeStagedBooking } from "../../domain/booking";
import { transition } from "../../domain/trip-state";
import type { Trip } from "../../domain/trip";
import { getTripRepository } from "../persistence/trip-repository";
import { bookTrip } from "../booking/booking-service";
import { runRecovery } from "../recovery/recovery-service";
import { getTripById, putTrip } from "./dev-store";

/**
 * Deterministic post-booking state advancement, using only valid transitions:
 *   - AT_RISK / RECOVERING → RESOLVED   (a recovery booking resolves the risk)
 *   - READY / BOOKING      → CONFIRMED  (an initial booking is confirmed)
 * Any other status is left unchanged.
 */
function advanceAfterBooking(trip: Trip): Trip {
  switch (trip.status) {
    case "AT_RISK":
      return transition(transition(trip, "RECOVERING"), "RESOLVED");
    case "RECOVERING":
      return transition(trip, "RESOLVED");
    case "READY":
      return transition(transition(trip, "BOOKING"), "CONFIRMED");
    case "BOOKING":
      return transition(trip, "CONFIRMED");
    default:
      return trip;
  }
}

export const executeBookingTool = tool({
  name: "execute_booking",
  description:
    "The only tool that performs a booking. For a persisted trip it makes a REAL " +
    "booking with the travel provider, after verifying server-side that the trip " +
    "is authorized, an option is selected, the offer is still valid, funding is " +
    "sufficient, and the cost is within budget — it derives the cost itself and " +
    "never trusts any amount you pass. For the in-memory recovery/demo trips it " +
    "runs a STAGED (simulated) booking, re-checking authority against the trip's " +
    "stored recovery allowance. If denied, stop — do not retry to get under a limit.",
  inputSchema: z.object({
    tripId: z.string().describe("The trip to book/rebook"),
    amount: z
      .number()
      .optional()
      .describe(
        "Only used by the staged recovery path (a recovery option's additional " +
          "cost). Ignored for real bookings, whose cost is read from the store.",
      ),
    description: z
      .string()
      .optional()
      .describe("Short description of what is being booked"),
  }),
  callback: async ({ tripId, amount, description }) => {
    // REAL path: a persisted trip goes through the real Duffel booking service,
    // which does its own authoritative verification and persistence.
    const persisted = await getTripRepository().getById(tripId);
    if (persisted) {
      // A disrupted (at-risk) trip is a RECOVERY booking: the recovery choke
      // point re-derives the alternatives and re-runs the deterministic
      // authority/funding/eligibility checks itself before booking or escalating.
      if (persisted.status === "AT_RISK" || persisted.status === "RECOVERING") {
        return runRecovery(tripId);
      }
      return bookTrip(tripId);
    }

    // STAGED path: the in-memory recovery/demo fixtures.
    const trip = getTripById(tripId);
    if (!trip) {
      return { ok: false, tripId, reason: `No trip found for id ${tripId}.` };
    }
    if (typeof amount !== "number") {
      return {
        ok: false,
        tripId,
        reason: "An amount is required to execute a staged recovery booking.",
      };
    }

    // Enforcement uses the STORED allowance — not anything the agent passed.
    const result = executeStagedBooking({
      tripId,
      amount,
      recoveryAllowance: trip.recoveryAllowance,
      currency: trip.currency,
      description,
    });

    // Only on a permitted, successful staged booking do we mutate state:
    // record the reference and advance the trip through the state machine.
    if (result.ok && result.bookingReference) {
      const booked: Trip = { ...trip, bookingReference: result.bookingReference };
      putTrip(advanceAfterBooking(booked));
    }

    return result;
  },
});
