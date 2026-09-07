/**
 * Space Zero — GET/PATCH /api/trips/[id].
 *
 * GET returns the persisted trip (404 if missing — never silently created).
 * PATCH applies a strictly-validated set of intent/selection fields; unknown
 * fields in the body are rejected by the Zod schema, so the client can never
 * set arbitrary database columns. Server-side only; no credentials returned.
 */

import { tripPatchSchema } from "@/src/server/trips/schemas";
import { getTrip, updateTrip, toTripResponse } from "@/src/server/trips/service";

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
  try {
    const trip = await getTrip(id);
    if (!trip) {
      return Response.json({ error: "That trip could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ trip: toTripResponse(trip) });
  } catch {
    return Response.json({ error: "Could not load the trip right now.", code: "PERSISTENCE_ERROR" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!validId(id)) {
    return Response.json({ error: "Invalid trip id.", code: "BAD_REQUEST" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON.", code: "BAD_REQUEST" }, { status: 400 });
  }

  const parsed = tripPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid update.", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const trip = await updateTrip(id, parsed.data);
    if (!trip) {
      return Response.json({ error: "That trip could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ trip: toTripResponse(trip) });
  } catch {
    return Response.json({ error: "Could not update the trip right now.", code: "PERSISTENCE_ERROR" }, { status: 500 });
  }
}
