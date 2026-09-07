/**
 * Space Zero — POST /api/trips/[id]/search.
 *
 * Triggers the Strands agent to orchestrate a real flight search: the agent
 * calls the search_flights tool, which queries Duffel and stores deterministically
 * ranked options. The route then returns the persisted options with an honest
 * status. It never fabricates flights:
 *   - Duffel unconfigured  → provider_unconfigured (no agent run needed)
 *   - model unconfigured   → operator_unavailable
 *   - otherwise            → the deterministic search outcome (ok / no_results /
 *                            provider_error / origin_unknown / destination_unknown)
 */

import { getTrip } from "@/src/server/trips/service";
import { isDuffelConfigured } from "@/src/providers/duffel";
import { buildAgent } from "@/src/agent/agent";
import { getLastSearchOutcome } from "@/src/server/flights/search-service";
import { getFlightOptionRepository } from "@/src/server/persistence/flight-option-repository";
import { toFlightOptionResponse } from "@/src/server/flights/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 200;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!validId(id)) {
    return Response.json({ error: "Invalid trip id.", code: "BAD_REQUEST" }, { status: 400 });
  }

  const trip = await getTrip(id).catch(() => null);
  if (!trip) {
    return Response.json({ status: "trip_not_found", options: [], error: "That trip could not be found." }, { status: 404 });
  }

  // Honest short-circuit: no provider → no search, no fabricated flights.
  if (!isDuffelConfigured()) {
    return Response.json({ status: "provider_unconfigured", options: [] });
  }

  // Strands orchestrates the search. If no model is configured, say so.
  let agent;
  try {
    agent = await buildAgent();
  } catch {
    return Response.json({ status: "operator_unavailable", options: [] });
  }

  try {
    const gen = agent.stream(
      `Search real flights for trip ${id}. Call search_flights with tripId "${id}", ` +
        `then report the returned status and how many options were found. Do not invent any flights.`,
    );
    let next = await gen.next();
    while (!next.done) next = await gen.next();
  } catch {
    // Fall through — we read the recorded deterministic outcome below.
  }

  let options;
  try {
    options = await getFlightOptionRepository().listForTrip(id);
  } catch {
    return Response.json({ status: "provider_error", options: [] });
  }

  const status = options.length > 0 ? "ok" : getLastSearchOutcome(id)?.status ?? "no_results";
  return Response.json({ status, options: options.map(toFlightOptionResponse) });
}
