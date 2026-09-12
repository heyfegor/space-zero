import { test } from "node:test";
import assert from "node:assert/strict";
import type { Trip } from "../domain/trip";
import type { FlightOption } from "../domain/flight-option";
import {
  parseAgentRequest,
  buildExecutionContext,
  buildPersistedAgentPrompt,
  eventsForToolCall,
  eventsForPersistedToolCall,
  persistedTripSummary,
  type OperationalEvent,
} from "./agent-api";
import { resolveTrip } from "./tools/resolve-trip";
import { getTripRepository } from "./persistence/trip-repository";
import { getFlightOptionRepository } from "./persistence/flight-option-repository";
import { DEMO_TRIP_ID, DEMO_TRIP_OVER_LIMIT_ID, resetDemoTrip } from "./tools/dev-store";
import { executionHref, buildPersistedRun, buildDemoRun } from "../../app/app/_lib/flow-nav";

/**
 * Connect the persisted trip flow to the Strands Execution flow.
 * These tests prove the Authorization → Execution seam end to end, at the level
 * the harness can run (pure functions + the real in-memory persistence), without
 * a live model.
 */

/** Seed a real persisted trip (READY, funded, with a selected itinerary). */
async function seedPersisted(id: string): Promise<Trip> {
  const option: FlightOption = {
    id: `${id}_opt`,
    tripId: id,
    providerOfferId: "off_1",
    segments: [
      { from: "LHR", to: "SIN", departAt: "2026-09-04T21:30:00+01:00", arriveAt: "2026-09-05T17:45:00+08:00" },
      { from: "SIN", to: "SYD", departAt: "2026-09-05T20:10:00+08:00", arriveAt: "2026-09-06T08:40:00+10:00" },
    ],
    totalAmount: 1468,
    currency: "GBP",
    durationMinutes: 1325,
    connections: 1,
    departAt: "2026-09-04T21:30:00+01:00",
    arriveAt: "2026-09-06T08:40:00+10:00",
    rank: 0,
    recommended: true,
    selected: true,
    expiresAt: null,
  };
  await getFlightOptionRepository().replaceForTrip(id, [option]);
  return getTripRepository().create({
    id,
    origin: "LHR",
    destination: "Sydney",
    segments: [],
    arrivalDeadline: "",
    currency: "GBP",
    tripBudget: 1500,
    recoveryAllowance: 150,
    checkedBags: 1,
    autoRebook: true,
    status: "READY",
    brief: "Sydney before 9am Sunday, under £1500, recovery up to £150.",
    arriveBy: "Before 9am Sunday",
    depart: "Fri, flexible",
    cabin: "Economy",
    baggage: "1 checked bag",
    seat: "Aisle preferred",
    fundedAmount: 1600,
    fundingStatus: "FUNDED",
    selectedOptionId: `${id}_opt`,
  });
}

const stages = (evs: OperationalEvent[]) => evs.map((e) => e.stage);

// 1. Authorization passes the correct trip id to Execution.
test("1. Authorization passes the correct trip id to Execution", () => {
  assert.equal(executionHref("t_abc"), "/app/execution?trip=t_abc");
  assert.equal(executionHref(null), "/app/execution");
  // The id is URL-encoded, so a UUID (or anything) survives verbatim.
  assert.equal(executionHref("a b/c"), "/app/execution?trip=a%20b%2Fc");
  const uuid = "844cdf6c-60de-4927-b5ac-1da67eda60b3";
  assert.equal(executionHref(uuid), `/app/execution?trip=${uuid}`);
});

// 2. Execution loads the ACTUAL persisted trip named by the passed id.
test("2. Execution loads the correct persisted trip", async () => {
  const id = "exec_persist_2";
  await seedPersisted(id);

  // The client sends exactly the id it was handed (no scenario, no substitution).
  assert.deepEqual(buildPersistedRun(id, "my brief"), { tripId: id, brief: "my brief" });

  // The endpoint treats an explicit id as a persisted candidate, not a demo.
  const parsed = parseAgentRequest(buildPersistedRun(id, "my brief"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.tripId, id);
  assert.equal(parsed.value.explicit, true);

  // And the run resolves THAT id to the real persisted trip.
  const resolved = await resolveTrip(id);
  assert.equal(resolved?.id, id);
  assert.equal(resolved?.destination, "Sydney");
  assert.equal(resolved?.status, "READY");
});

// 3. The agent receives the real structured trip context (intent, selected
//    option, funding, authority) — and no chain-of-thought is requested/emitted.
test("3. The agent receives the correct structured trip context", async () => {
  const id = "exec_ctx_3";
  const trip = await seedPersisted(id);
  const ctx = await buildExecutionContext(trip);

  assert.equal(ctx.tripId, id);
  assert.equal(ctx.intent.destination, "Sydney");
  assert.equal(ctx.intent.arriveBy, "Before 9am Sunday");
  assert.equal(ctx.intent.cabin, "Economy");
  assert.equal(ctx.selectedOption?.totalAmount, 1468);
  assert.equal(ctx.selectedOption?.route, "LHR → SIN → SYD");
  assert.equal(ctx.funding?.status, "FUNDED");
  assert.equal(ctx.funding?.sufficient, true);
  assert.equal(ctx.funding?.estimatedCost, 1468);
  assert.equal(ctx.authority.recoveryAllowance, 150);
  assert.equal(ctx.authority.tripBudget, 1500);

  const prompt = buildPersistedAgentPrompt("fallback brief", trip, ctx);
  assert.ok(prompt.includes(id), "prompt carries the concrete trip id");
  assert.ok(prompt.includes("Sydney"), "prompt carries the destination");
  assert.ok(prompt.includes("LHR → SIN → SYD"), "prompt carries the selected itinerary");
  assert.ok(prompt.includes("FUNDED"), "prompt carries funding state");
  assert.ok(prompt.includes("150"), "prompt carries the recovery allowance");
  assert.ok(prompt.includes("execute_booking"), "prompt directs the agent to the money path");
  // The persisted brief wins over any client-sent fallback.
  assert.ok(prompt.includes("Sydney before 9am Sunday"));

  // Chain-of-thought stays private: operational events are structured stages
  // derived from the trip's real state — they never carry model reasoning.
  const evs = eventsForPersistedToolCall("get_trip", { tripId: id }, trip);
  assert.deepEqual(stages(evs), ["PLANNING"]);
  for (const e of evs) {
    const keys = Object.keys(e);
    assert.ok(!keys.some((k) => /reason|thought|text|message|content/i.test(k)));
  }
});

// 4. Refreshing preserves the execution context: the same URL id re-resolves to
//    the same trip and rebuilds an identical context from persistence.
test("4. Refresh preserves the execution context", async () => {
  const id = "exec_refresh_4";
  await seedPersisted(id);

  const first = await buildExecutionContext((await resolveTrip(id))!);
  // A refresh = same ?trip=<id>, re-fetch + rebuild. Nothing ephemeral is lost.
  const second = await buildExecutionContext((await resolveTrip(id))!);
  assert.deepEqual(second, first);

  const summary = await persistedTripSummary(id);
  assert.equal(summary?.tripId, id);
  assert.equal(summary?.status, "READY");
});

// 5. Explicit demo scenarios still work independently and never touch a real trip.
test("5. Explicit demo scenarios still work independently", () => {
  resetDemoTrip(DEMO_TRIP_ID);
  resetDemoTrip(DEMO_TRIP_OVER_LIMIT_ID);

  const rec = parseAgentRequest(buildDemoRun("recovery", 150));
  assert.equal(rec.ok, true);
  if (rec.ok) {
    assert.equal(rec.value.tripId, DEMO_TRIP_ID);
    assert.equal(rec.value.explicit, false);
  }

  const over = parseAgentRequest(buildDemoRun("over_limit", 150));
  assert.equal(over.ok, true);
  if (over.ok) {
    assert.equal(over.value.tripId, DEMO_TRIP_OVER_LIMIT_ID);
    assert.equal(over.value.explicit, false);
  }

  // The deterministic authority outcomes are unchanged: £96 permitted, £181 denied.
  const permitted = stages(eventsForToolCall("execute_booking", { tripId: DEMO_TRIP_ID, amount: 96 }, DEMO_TRIP_ID));
  assert.ok(permitted.includes("PERMITTED"));
  assert.ok(permitted.includes("RESOLVED"));

  const denied = stages(eventsForToolCall("execute_booking", { tripId: DEMO_TRIP_OVER_LIMIT_ID, amount: 181 }, DEMO_TRIP_OVER_LIMIT_ID));
  assert.ok(denied.includes("DENIED"));
  assert.ok(denied.includes("STOPPED"));
  assert.equal(denied.includes("REBOOKED"), false);
});
