import { test } from "node:test";
import assert from "node:assert/strict";
import type { Trip } from "../domain/trip";
import {
  parseAgentRequest,
  buildAgentPrompt,
  eventsForToolCall,
  toUserSafeError,
  applyUserAuthority,
  type OperationalEvent,
} from "./agent-api";
import { spaceZeroTools } from "./tools";
import { executeBookingTool } from "./tools/execute-booking";
import { putTrip, getTripById, DEMO_TRIP_ID } from "./tools/dev-store";

const EXAMPLE_BRIEF =
  "I need to travel from London to Sydney from 12 October to 24 October. Handle the trip for me. You can spend up to £150 recovering the trip if something goes wrong.";

function seedTrip(id: string, recoveryAllowance = 150): Trip {
  return putTrip({
    id,
    origin: "LHR",
    destination: "SYD",
    segments: [
      { from: "LHR", to: "SIN", departAt: "2026-09-04T21:30:00+01:00", arriveAt: "2026-09-05T17:45:00+08:00" },
      { from: "SIN", to: "SYD", departAt: "2026-09-05T20:10:00+08:00", arriveAt: "2026-09-06T07:05:00+10:00" },
    ],
    arrivalDeadline: "2026-09-06T09:00:00+10:00",
    currency: "GBP",
    tripBudget: 1200,
    recoveryAllowance,
    checkedBags: 1,
    autoRebook: true,
    status: "AT_RISK",
    bookingReference: "SZ-1000",
  });
}

function stages(evs: OperationalEvent[]): string[] {
  return evs.map((e) => e.stage);
}

// A. A valid trip brief is accepted, resolves to a trip, and reaches the agent
//    (the prompt carries the brief + concrete trip id, not a hardcoded answer).
test("A: a valid trip brief parses and builds a tool-driven prompt", () => {
  const parsed = parseAgentRequest({ brief: EXAMPLE_BRIEF, scenario: "recovery" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.tripId, DEMO_TRIP_ID);
  assert.equal(parsed.value.brief, EXAMPLE_BRIEF);

  const trip = getTripById(parsed.value.tripId)!;
  const prompt = buildAgentPrompt(parsed.value.brief, trip);
  assert.ok(prompt.includes(EXAMPLE_BRIEF), "prompt carries the brief");
  assert.ok(prompt.includes(trip.id), "prompt carries the concrete trip id");
  assert.ok(prompt.includes("get_trip"), "prompt directs the agent to use tools");
});

test("A: malformed requests are rejected", () => {
  assert.equal(parseAgentRequest(null).ok, false);
  assert.equal(parseAgentRequest({}).ok, false);
  assert.equal(parseAgentRequest({ brief: "   " }).ok, false);
  assert.equal(parseAgentRequest({ brief: "hi", scenario: "nope" }).ok, false);
});

// B. The agent has access to the Space Zero tools.
test("B: the Space Zero tools are registered", () => {
  const names = spaceZeroTools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "check_authority",
    "execute_booking",
    "get_trip",
    "recover_trip",
    "search_flights",
  ]);
});

// C. A permitted recovery reaches execute_booking and completes (staged).
test("C: permitted recovery reaches execute_booking and stages a booking", async () => {
  seedTrip("api_c", 150);
  const r = (await executeBookingTool.invoke({ tripId: "api_c", amount: 96 })) as any;
  assert.equal(r.ok, true);
  assert.equal(r.mode, "STAGED");
  assert.match(r.bookingReference, /^SZ-\d{4}$/);
  assert.equal(getTripById("api_c")!.status, "RESOLVED");

  const evs = eventsForToolCall("execute_booking", { tripId: "api_c", amount: 96 }, "api_c");
  assert.ok(stages(evs).includes("PERMITTED"));
  assert.ok(stages(evs).includes("REBOOKED"));
  assert.ok(stages(evs).includes("RESOLVED"));
});

// D. An over-limit recovery cannot execute — enforced by execute_booking itself.
test("D: over-limit recovery cannot execute and leaves state untouched", async () => {
  seedTrip("api_d", 150);
  const r = (await executeBookingTool.invoke({ tripId: "api_d", amount: 181 })) as any;
  assert.equal(r.ok, false);
  assert.equal(getTripById("api_d")!.status, "AT_RISK"); // unchanged

  const evs = eventsForToolCall("execute_booking", { tripId: "api_d", amount: 181 }, "api_d");
  assert.ok(stages(evs).includes("DENIED"));
  assert.ok(stages(evs).includes("STOPPED"));
  assert.equal(stages(evs).includes("REBOOKED"), false);
});

// E. The API does not expose secrets or internals in error messages.
test("E: user-safe errors never leak keys, secrets, or raw messages", () => {
  const provider = toUserSafeError(
    new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example)."),
  );
  assert.equal(provider.code, "PROVIDER_UNAVAILABLE");
  assert.ok(!/ANTHROPIC_API_KEY/i.test(provider.message));

  const leaky = toUserSafeError(new Error("boom at C:\\src\\secret sk-ant-abc123 stack..."));
  assert.equal(leaky.code, "AGENT_ERROR");
  assert.ok(!provider.message.includes("sk-ant"));
  assert.ok(!leaky.message.includes("sk-ant"));
  assert.ok(!leaky.message.includes("C:\\"));
});

// The user's slider-set recovery allowance is validated and applied as a
// legitimate delegation (execute_booking still enforces against it).
test("recovery allowance: valid value accepted, out-of-range rejected", () => {
  const ok = parseAgentRequest({ brief: "x", recoveryAllowance: 200 });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.recoveryAllowance, 200);

  assert.equal(parseAgentRequest({ brief: "x", recoveryAllowance: 600 }).ok, false);
  assert.equal(parseAgentRequest({ brief: "x", recoveryAllowance: -1 }).ok, false);
  assert.equal(parseAgentRequest({ brief: "x", recoveryAllowance: "150" }).ok, false);
});

test("applyUserAuthority sets the trip's recovery allowance", () => {
  seedTrip("api_auth", 150);
  const applied = applyUserAuthority("api_auth", 300);
  assert.equal(applied, 300);
  assert.equal(getTripById("api_auth")!.recoveryAllowance, 300);
  // With allowance raised to 300, an over-limit £181 now evaluates as permitted.
  const evs = eventsForToolCall("execute_booking", { tripId: "api_auth", amount: 181 }, "api_auth");
  assert.ok(stages(evs).includes("REBOOKING"));
});

// recover_trip event derivation flags authority per option (read-only).
test("recover_trip events flag each option's authority", () => {
  seedTrip("api_rec", 150);
  const evs = eventsForToolCall("recover_trip", { tripId: "api_rec" }, "api_rec");
  assert.equal(evs.length, 1);
  const ev = evs[0];
  assert.equal(ev.stage, "RECOVERY_FOUND");
  if (ev.stage !== "RECOVERY_FOUND") return;
  const a = ev.options.find((o) => o.additionalCost === 96);
  const b = ev.options.find((o) => o.additionalCost === 181);
  assert.equal(a?.withinAuthority, true);
  assert.equal(b?.withinAuthority, false);
});
