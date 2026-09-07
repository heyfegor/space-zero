/**
 * Space Zero — POST /api/trips (create a persistent trip from a brief).
 *
 * Browser → this route → trip service (parse brief → validate → persist) →
 * repository (Supabase or in-memory). Server-side only; no credentials are ever
 * returned. The brief is validated before anything is created.
 */

import { createTripSchema } from "@/src/server/trips/schemas";
import { createTripFromBrief, toTripResponse } from "@/src/server/trips/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON.", code: "BAD_REQUEST" }, { status: 400 });
  }

  const parsed = createTripSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const trip = await createTripFromBrief(parsed.data.brief);
    return Response.json({ trip: toTripResponse(trip) }, { status: 201 });
  } catch {
    // Never leak stack traces / provider messages.
    return Response.json(
      { error: "Could not create the trip right now.", code: "PERSISTENCE_ERROR" },
      { status: 500 },
    );
  }
}
