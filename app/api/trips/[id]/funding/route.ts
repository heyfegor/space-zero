/**
 * Space Zero — GET/PATCH /api/trips/[id]/funding.
 *
 * GET returns the computed funding view (status + funded/remaining/buffer vs the
 * estimated cost of the selected real itinerary). PATCH persists a funding
 * update: the body is strictly validated and the server resolves the terminal
 * status against the estimated cost, so FUNDED is never stored when the amount
 * is short (it becomes INSUFFICIENT). No money moves — persistence/state only.
 */

import { fundingUpdateSchema } from "@/src/server/trips/schemas";
import { getFundingView, updateFunding } from "@/src/server/trips/funding-service";

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
    const funding = await getFundingView(id);
    if (!funding) {
      return Response.json({ error: "That trip could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ funding });
  } catch {
    return Response.json({ error: "Could not load funding right now.", code: "PERSISTENCE_ERROR" }, { status: 500 });
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

  const parsed = fundingUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid funding update.", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const funding = await updateFunding(id, parsed.data);
    if (!funding) {
      return Response.json({ error: "That trip could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ funding });
  } catch {
    return Response.json({ error: "Could not update funding right now.", code: "PERSISTENCE_ERROR" }, { status: 500 });
  }
}
