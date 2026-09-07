/**
 * Space Zero — main agent endpoint (server-side only).
 *
 * Browser → this route → Strands agent → deterministic Space Zero tools →
 * domain store → streamed operational events → browser.
 *
 * The agent runs server-side; model credentials never reach the browser. The
 * stream carries only user-safe operational events (derived from tool-call
 * metadata + the deterministic domain) and the final response — never the
 * model's hidden reasoning.
 *
 * GET  /api/agent                     -> health: active provider + key presence
 * POST /api/agent { brief, scenario } -> SSE stream of operational events
 */

import { activeProvider } from "@/src/agent/model";
import { buildAgent } from "@/src/agent/agent";
import {
  parseAgentRequest,
  buildAgentPrompt,
  eventsForToolCall,
  tripSummary,
  toUserSafeError,
  applyUserAuthority,
} from "@/src/server/agent-api";
import { getTripById, resetDemoTrip } from "@/src/server/tools/dev-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    service: "space-zero",
    provider: activeProvider(),
    anthropicKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}

export async function POST(req: Request) {
  // Parse + validate the request BEFORE opening a stream.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON.", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const parsed = parseAgentRequest(raw);
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.message, code: "BAD_REQUEST" },
      { status: parsed.status },
    );
  }
  const { brief, tripId, recoveryAllowance } = parsed.value;
  // Fresh AT_RISK state each run so the demo is repeatable, then apply the
  // user's delegated authority (from the Authority screen) up front.
  resetDemoTrip(tripId);
  applyUserAuthority(tripId, recoveryAllowance);

  const encoder = new TextEncoder();
  const send = (
    controller: ReadableStreamDefaultController,
    event: string,
    data: unknown,
  ) => {
    controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        send(controller, "stage", { stage: "RECEIVED", label: "Brief received" });

        const trip = getTripById(tripId);
        if (!trip) {
          send(controller, "error", {
            code: "INVALID_TRIP_STATE",
            message: "That trip could not be found.",
          });
          return;
        }

        // buildAgent() may throw if no model provider is configured — caught below.
        const agent = await buildAgent();
        const prompt = buildAgentPrompt(brief, trip);

        const gen = agent.stream(prompt);
        let next = await gen.next();
        while (!next.done) {
          const evt = next.value as {
            type?: string;
            toolUse?: { name?: string; input?: unknown };
          };
          // Only tool-call boundaries produce user-safe operational events.
          if (evt.type === "afterToolCallEvent" && evt.toolUse?.name) {
            for (const op of eventsForToolCall(evt.toolUse.name, evt.toolUse.input, tripId)) {
              send(controller, "stage", op);
            }
          }
          next = await gen.next();
        }

        const result = next.value as { lastMessage?: { content?: unknown } };
        const content = result?.lastMessage?.content;
        const text = Array.isArray(content)
          ? content
              .map((b) =>
                b && typeof (b as { text?: unknown }).text === "string"
                  ? (b as { text: string }).text
                  : "",
              )
              .join("")
              .trim()
          : "";

        send(controller, "done", { text, summary: tripSummary(tripId) });
      } catch (err) {
        // Never leak stack traces / secrets.
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
