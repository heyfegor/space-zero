/**
 * Space Zero — POST /api/trips/[id]/options/select { optionId }.
 *
 * Persists the traveler's chosen option: marks the option row selected (and the
 * others not) AND sets the trip's selectedOptionId. Validates that the option
 * belongs to the trip. No booking happens here.
 */

import { z } from "zod";
import { getTrip, updateTrip } from "@/src/server/trips/service";
import { getFlightOptionRepository } from "@/src/server/persistence/flight-option-repository";
import { toFlightOptionResponse } from "@/src/server/flights/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const selectSchema = z.object({ optionId: z.string().min(1).max(200) }).strict();

function validId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 200;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
  const parsed = selectSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "An optionId is required.", code: "BAD_REQUEST" }, { status: 400 });
  }

  const trip = await getTrip(id).catch(() => null);
  if (!trip) {
    return Response.json({ error: "That trip could not be found.", code: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const option = await getFlightOptionRepository().setSelected(id, parsed.data.optionId);
    if (!option) {
      return Response.json({ error: "That option is not part of this trip.", code: "NOT_FOUND" }, { status: 404 });
    }
    await updateTrip(id, { selectedOptionId: parsed.data.optionId });
    return Response.json({ selectedOptionId: parsed.data.optionId, option: toFlightOptionResponse(option) });
  } catch {
    return Response.json({ error: "Could not select the option right now.", code: "PERSISTENCE_ERROR" }, { status: 500 });
  }
}
