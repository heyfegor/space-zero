/**
 * Space Zero — GET /api/trips/[id]/options.
 *
 * Returns the persisted, ranked flight options for a trip (empty array if none
 * have been searched yet). Read-only; runs no search.
 */

import { getTrip } from "@/src/server/trips/service";
import { getFlightOptionRepository } from "@/src/server/persistence/flight-option-repository";
import { toFlightOptionResponse } from "@/src/server/flights/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 200;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!validId(id)) {
    return Response.json({ error: "Invalid trip id.", code: "BAD_REQUEST" }, { status: 400 });
  }
  const trip = await getTrip(id).catch(() => null);
  if (!trip) {
    return Response.json({ error: "That trip could not be found.", code: "NOT_FOUND" }, { status: 404 });
  }
  try {
    const options = await getFlightOptionRepository().listForTrip(id);
    return Response.json({ options: options.map(toFlightOptionResponse) });
  } catch {
    return Response.json({ error: "Could not load options right now.", code: "PERSISTENCE_ERROR" }, { status: 500 });
  }
}
