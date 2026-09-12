/**
 * Space Zero — POST /api/trips/[id]/recover.
 *
 * Runs the autonomous recovery workflow for an at-risk trip and streams user-safe
 * OPERATIONAL EVENTS (never the model's reasoning). The Strands recovery agent
 * orchestrates the tools when a model provider is configured; the deterministic
 * choke point enforces every decision and, when the provider is unavailable,
 * completes the recovery so an at-risk trip is never left stuck.
 *
 * The events are synthesized from the DETERMINISTIC outcome (search → evaluate →
 * rebook/escalate), so what the traveler sees always matches what actually
 * happened in the store — no fabricated success, no chain-of-thought.
 */

import {
  triggerRecoveryWorkflow,
  recoveryOutcomeEvents,
} from "@/src/server/recovery/recovery-agent";
import { toUserSafeError } from "@/src/server/agent-api";

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

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, event: string, data: unknown) => {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        send(controller, "stage", { stage: "RECEIVED", label: "Recovering your trip" });

        // The Strands agent orchestrates when a model is configured; otherwise the
        // deterministic choke point completes it. Either way, enforcement is code.
        const outcome = await triggerRecoveryWorkflow(id);

        for (const op of recoveryOutcomeEvents(outcome)) {
          send(controller, "stage", op);
        }

        send(controller, "done", {
          status: outcome.status,
          tripStatus: outcome.tripStatus,
          recovery: outcome.recovery ?? null,
        });
      } catch (err) {
        send(controller, "error", toUserSafeError(err));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
