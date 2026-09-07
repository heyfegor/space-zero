/**
 * Tool: search_flights — real flight search for a PERSISTED trip.
 *
 * Loads the trip from the persistence layer, reads its intent, queries the
 * travel provider (Duffel), and stores DETERMINISTICALLY ranked options. The
 * model orchestrates (decides to call this) but must never invent or reorder
 * flight data — normalization, the hard-deadline filter, and ranking are all
 * deterministic code inside searchAndPersistFlights. Returns only a status and
 * a count; the ranked options live in the store for the UI to read.
 */

import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import { searchAndPersistFlights } from "../flights/search-service";

export const searchFlightsTool = tool({
  name: "search_flights",
  description:
    "Search real flights for a persisted trip id and store the ranked options. " +
    "It reads the trip's intent, queries the provider, enforces the hard arrival " +
    "deadline, and ranks results itself — you must NOT invent, filter, or reorder " +
    "flights. Returns a status (ok / no_results / provider_unconfigured / " +
    "provider_error / origin_unknown / destination_unknown / trip_not_found) and " +
    "the number of options found.",
  inputSchema: z.object({
    tripId: z.string().describe("The persisted trip id to search flights for"),
  }),
  callback: async ({ tripId }) => {
    const outcome = await searchAndPersistFlights(tripId);
    return {
      tripId,
      status: outcome.status,
      count: outcome.options.length,
      recommendedOfferId: outcome.options.find((o) => o.recommended)?.providerOfferId ?? null,
    };
  },
});
