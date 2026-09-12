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
 * Two run modes share this endpoint:
 *   - PERSISTED: an explicit ?trip=<id> that exists in the persistence layer.
 *     The agent runs on the REAL trip, with context built from its intent,
 *     selected itinerary, funding, and authority. Outcomes are honest and
 *     status-gated (no fabricated booking/payment/resolution).
 *   - DEMO: the deterministic £96/£181 staged fixtures, selected by an explicit
 *     `scenario`. These remain available and never silently replace a real trip.
 *
 * GET  /api/agent                              -> health: provider + key presence
 * POST /api/agent { tripId } | { scenario }    -> SSE stream of operational events
 */

import { activeProvider } from "@/src/agent/model";
import { buildAgent } from "@/src/agent/agent";
import {
  parseAgentRequest,
  buildAgentPrompt,
  buildPersistedAgentPrompt,
  buildExecutionContext,
  eventsForToolCall,
  eventsForPersistedToolCall,
  tripSummary,
  persistedTripSummary,
  toUserSafeError,
  applyUserAuthority,
  type OperationalEvent,
  type TripSummary,
} from "@/src/server/agent-api";
import { getTripById, resetDemoTrip } from "@/src/server/tools/dev-store";
import { getTripRepository } from "@/src/server/persistence/trip-repository";

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
  const { brief, tripId, recoveryAllowance, explicit } = parsed.value;

  // Resolve a REAL persisted trip up front (an explicit ?trip=<id>). When found,
  // the run operates on it; otherwise this is a deterministic demo fixture.
  const persistedTrip = explicit ? await getTripRepository().getById(tripId) : null;

  // Only the demo store is reset + re-authorized per run (so the £96/£181 demo is
  // repeatable). A persisted trip's authority is already stored on the trip, so
  // its state is never touched here.
  if (!persistedTrip) {
    resetDemoTrip(tripId);
    applyUserAuthority(tripId, recoveryAllowance);
  }

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

        // Choose the run: a real persisted trip, or the deterministic demo.
        let prompt: string;
        let derive: (name: string, input: unknown) => Promise<OperationalEvent[]>;
        let summarize: () => Promise<TripSummary | null>;

        if (persistedTrip) {
          const ctx = await buildExecutionContext(persistedTrip);
          prompt = buildPersistedAgentPrompt(brief, persistedTrip, ctx);
          // Re-read the persisted trip after each tool so events reflect its
          // ACTUAL post-call state (bypass-proof, never model-supplied).
          derive = async (name, input) =>
            eventsForPersistedToolCall(
              name,
              input,
              (await getTripRepository().getById(tripId)) ?? persistedTrip,
            );
          summarize = () => persistedTripSummary(tripId);
        } else {
          const trip = getTripById(tripId);
          if (!trip) {
            send(controller, "error", {
              code: "INVALID_TRIP_STATE",
              message: "That trip could not be found.",
            });
            return;
          }
          prompt = buildAgentPrompt(brief, trip);
          derive = async (name, input) => eventsForToolCall(name, input, tripId);
          summarize = async () => tripSummary(tripId);
        }

        // buildAgent() may throw if no model provider is configured — caught below.
        const agent = await buildAgent();
        const gen = agent.stream(prompt);
        let next = await gen.next();
        while (!next.done) {
          const evt = next.value as {
            type?: string;
            toolUse?: { name?: string; input?: unknown };
          };
          // Only tool-call boundaries produce user-safe operational events.
          if (evt.type === "afterToolCallEvent" && evt.toolUse?.name) {
            for (const op of await derive(evt.toolUse.name, evt.toolUse.input)) {
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

        send(controller, "done", { text, summary: await summarize() });
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
