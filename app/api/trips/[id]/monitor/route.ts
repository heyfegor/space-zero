/**
 * Space Zero — GET/POST /api/trips/[id]/monitor.
 *
 * GET returns the persisted monitoring view for an active trip: whether it is
 * being monitored, whether the flight-status provider is available (honest
 * unavailable state when not), and the persisted disruptions. It runs NO provider
 * call — it is the read the Trips/Disruption screens use for real data.
 *
 * POST runs a live monitoring pass: it observes the booked segments through the
 * flight-status provider, DETERMINISTICALLY assesses whether the trip is
 * threatened, persists meaningful disruptions, and — on a NEW meaningful
 * disruption — advances the trip to AT_RISK and TRIGGERS the recovery workflow
 * (the deterministic recovery choke point; the Strands-orchestrated, streamed
 * variant is POST /api/trips/[id]/recover). It never fabricates a status without
 * a configured provider. The response includes any recovery outcome produced.
 */

import { getMonitoringView, monitorTrip } from "@/src/server/monitoring/monitoring-service";
import { triggerRecoveryWorkflow } from "@/src/server/recovery/recovery-agent";

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
    const view = await getMonitoringView(id);
    if (!view) {
      return Response.json({ error: "That trip could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ monitoring: view });
  } catch {
    return Response.json(
      { error: "Could not load monitoring right now.", code: "PERSISTENCE_ERROR" },
      { status: 500 },
    );
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!validId(id)) {
    return Response.json({ error: "Invalid trip id.", code: "BAD_REQUEST" }, { status: 400 });
  }
  try {
    // On a NEW meaningful disruption, monitoring hands off to the recovery
    // workflow. Deterministic here so the endpoint completes without a model;
    // the Strands-orchestrated, event-streamed variant is POST /recover.
    const outcome = await monitorTrip(id, {
      onDisruption: () => triggerRecoveryWorkflow(id, { deterministicOnly: true }).then(() => undefined),
    });
    if (outcome.status === "trip_not_found") {
      return Response.json({ error: "That trip could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }
    // Return the fresh persisted view so the response reflects any recovery/escalation.
    const view = await getMonitoringView(id);
    return Response.json({ monitoring: outcome, recovery: view?.recovery ?? null });
  } catch {
    return Response.json(
      { error: "Could not run monitoring right now.", code: "MONITORING_ERROR" },
      { status: 500 },
    );
  }
}
