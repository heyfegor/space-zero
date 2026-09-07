/**
 * Space Zero — persistence + trip-API boundary tests (no live Supabase).
 *
 * These exercise the deterministic layers behind the routes: request validation,
 * brief → intent parsing, the service (create/get/update) over the in-memory
 * repository, the row↔domain mappers, and the money/safety invariants.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createTripSchema, tripPatchSchema, tripIntentSchema } from "./schemas";
import { parseBrief } from "./intent-parser";
import { createTripFromBrief, getTrip, updateTrip, toTripResponse } from "./service";
import { InMemoryTripRepository } from "../persistence/in-memory-trip-repository";
import { isSupabaseConfigured, DEV_USER_ID } from "../persistence/trip-repository";
import { getSupabaseAdmin } from "../persistence/supabase-client";
import { rowToTrip, tripToInsertRow, patchToRow, type TripRow } from "../persistence/trip-row";
import type { Trip } from "../../domain/trip";

// --- Request validation -----------------------------------------------------

test("create: valid brief passes validation", () => {
  const r = createTripSchema.safeParse({ brief: "Get me to Sydney under £1,200." });
  assert.equal(r.success, true);
});

test("create: empty brief is rejected", () => {
  assert.equal(createTripSchema.safeParse({ brief: "   " }).success, false);
  assert.equal(createTripSchema.safeParse({ brief: "" }).success, false);
});

test("create: malformed body is rejected", () => {
  assert.equal(createTripSchema.safeParse({}).success, false);
  assert.equal(createTripSchema.safeParse({ brief: 42 }).success, false);
  assert.equal(createTripSchema.safeParse(null).success, false);
});

test("create: unreasonably long brief is rejected", () => {
  assert.equal(createTripSchema.safeParse({ brief: "x".repeat(4001) }).success, false);
});

// --- Intent parsing ---------------------------------------------------------

test("parseBrief extracts structured, validated intent", () => {
  const intent = parseBrief(
    "Get me to Sydney, arriving before 09:00 Sunday. Keep it under £1,200, economy, one checked bag, aisle if you can. Spend up to £150 to fix disruptions without asking.",
  );
  assert.equal(intent.destination, "Sydney");
  assert.equal(intent.budget, 1200);
  assert.equal(intent.recoveryAllowance, 150);
  assert.equal(intent.cabin, "Economy");
  assert.equal(intent.baggage, "1 checked bag");
  assert.equal(intent.seat, "Aisle preferred");
  assert.ok((intent.arriveBy ?? "").toLowerCase().includes("09:00"));
  // Parser output always satisfies the schema.
  assert.equal(tripIntentSchema.safeParse(intent).success, true);
});

test("parseBrief is deterministic (same input → same output)", () => {
  const b = "Fly to Tokyo under £900, business, window seat.";
  assert.deepEqual(parseBrief(b), parseBrief(b));
});

test("parseBrief returns a valid intent even for a sparse brief", () => {
  const intent = parseBrief("Somewhere warm next month.");
  assert.equal(typeof intent.destination, "string");
  assert.equal(tripIntentSchema.safeParse(intent).success, true);
});

// --- Service: create / get / update over the in-memory repo -----------------

test("service: valid brief creates a persistent trip with a real id", async () => {
  const trip = await createTripFromBrief("Get me to Lisbon under £600, aisle seat.");
  assert.ok(trip.id && trip.id.length > 0);
  assert.equal(trip.status, "DRAFT");
  assert.equal(trip.userId, DEV_USER_ID);
  assert.equal(trip.destination, "Lisbon");
  assert.equal(trip.tripBudget, 600);

  const fetched = await getTrip(trip.id);
  assert.ok(fetched, "created trip is retrievable");
  assert.equal(fetched?.id, trip.id);
  assert.equal(fetched?.seat, "Aisle preferred");
});

test("service: unknown trip id returns null (route maps to 404)", async () => {
  assert.equal(await getTrip("does-not-exist-" + crypto.randomUUID()), null);
});

test("service: valid intent update persists", async () => {
  const trip = await createTripFromBrief("Trip to Paris under £500.");
  const updated = await updateTrip(trip.id, { destination: "Nice", budget: 750, recoveryAllowance: 120 });
  assert.equal(updated?.destination, "Nice");
  assert.equal(updated?.tripBudget, 750);
  assert.equal(updated?.recoveryAllowance, 120);

  const fetched = await getTrip(trip.id);
  assert.equal(fetched?.destination, "Nice");
  assert.equal(fetched?.tripBudget, 750);
});

test("service: selectedOptionId persists through update", async () => {
  const trip = await createTripFromBrief("Trip to Rome.");
  const updated = await updateTrip(trip.id, { selectedOptionId: "opt_sin" });
  assert.equal(updated?.selectedOptionId, "opt_sin");
});

test("service: update of an unknown trip returns null", async () => {
  assert.equal(await updateTrip("missing-" + crypto.randomUUID(), { budget: 10 }), null);
});

// --- Patch validation: no arbitrary columns ---------------------------------

test("patch: invalid field values are rejected", () => {
  assert.equal(tripPatchSchema.safeParse({ budget: -5 }).success, false);
  assert.equal(tripPatchSchema.safeParse({ budget: "lots" }).success, false);
  assert.equal(tripPatchSchema.safeParse({ recoveryAllowance: Number.NaN }).success, false);
});

test("patch: arbitrary/unknown fields are rejected (strict)", () => {
  assert.equal(tripPatchSchema.safeParse({ status: "RESOLVED" }).success, false);
  assert.equal(tripPatchSchema.safeParse({ user_id: "x" }).success, false);
  assert.equal(tripPatchSchema.safeParse({ bookingReference: "SZ-9999" }).success, false);
  assert.equal(tripPatchSchema.safeParse({ id: "hijack" }).success, false);
});

test("patch: an empty patch is rejected", () => {
  assert.equal(tripPatchSchema.safeParse({}).success, false);
});

// --- Mappers + money precision ----------------------------------------------

test("mapper: numeric money from the DB (string) maps without float error", () => {
  const row: TripRow = {
    id: crypto.randomUUID(),
    user_id: DEV_USER_ID,
    status: "DRAFT",
    brief: "b",
    origin: null,
    destination: "Sydney",
    arrive_by: null,
    depart: null,
    trip_budget: "1200.00",
    recovery_allowance: "150.00",
    funded_amount: null,
    funding_status: "unfunded",
    cabin: "Economy",
    baggage: "1 checked bag",
    seat: "Aisle preferred",
    selected_option_id: null,
    currency: "GBP",
    duffel_order_id: null,
    booking_reference: null,
    final_cost: null,
    booking_status: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const trip = rowToTrip(row);
  assert.equal(trip.tripBudget, 1200);
  assert.equal(trip.recoveryAllowance, 150);
  assert.equal(trip.checkedBags, 1);
  // Legacy lowercase funding status normalizes to the uppercase convention.
  assert.equal(trip.fundingStatus, "UNFUNDED");
});

test("mapper: domain → insert row round-trips the persisted fields", () => {
  const trip: Trip = {
    id: crypto.randomUUID(),
    userId: DEV_USER_ID,
    status: "DRAFT",
    brief: "b",
    origin: "",
    destination: "Oslo",
    segments: [],
    arrivalDeadline: "",
    currency: "GBP",
    tripBudget: 800,
    recoveryAllowance: 100,
    checkedBags: 0,
    autoRebook: true,
    fundedAmount: null,
    fundingStatus: "UNFUNDED",
  };
  const insert = tripToInsertRow(trip);
  assert.equal(insert.destination, "Oslo");
  assert.equal(insert.trip_budget, 800);
  assert.equal(insert.recovery_allowance, 100);
  assert.equal(insert.user_id, DEV_USER_ID);
});

test("mapper: patchToRow only emits touched columns", () => {
  const row = patchToRow({ budget: 500, seat: "Window preferred" });
  assert.deepEqual(row, { trip_budget: 500, seat: "Window preferred" });
});

// --- In-memory repository directly ------------------------------------------

test("in-memory repo: create, get, update, and not-found", async () => {
  const repo = new InMemoryTripRepository();
  const trip: Trip = {
    id: crypto.randomUUID(), userId: DEV_USER_ID, status: "DRAFT", brief: "b",
    origin: "", destination: "Berlin", segments: [], arrivalDeadline: "",
    currency: "GBP", tripBudget: 300, recoveryAllowance: 50, checkedBags: 0, autoRebook: true,
  };
  await repo.create(trip);
  assert.equal((await repo.getById(trip.id))?.destination, "Berlin");
  const upd = await repo.update(trip.id, { budget: 320 });
  assert.equal(upd?.tripBudget, 320);
  assert.equal(await repo.getById("nope"), null);
  assert.equal(await repo.update("nope", { budget: 1 }), null);
});

// --- Safety -----------------------------------------------------------------

test("safety: Supabase is not configured in tests (in-memory fallback used)", () => {
  assert.equal(isSupabaseConfigured(), false);
});

test("safety: the admin client requires server env and never falls back silently", () => {
  // Without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY this throws — the key can
  // never be absent-but-assumed, and it is only ever read server-side.
  assert.throws(() => getSupabaseAdmin(), /not configured/i);
});

test("safety: trip creation needs no model/LLM (deterministic write path)", async () => {
  const hadKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const trip = await createTripFromBrief("Quick trip to Madrid.");
    assert.equal(trip.destination, "Madrid");
  } finally {
    if (hadKey !== undefined) process.env.ANTHROPIC_API_KEY = hadKey;
  }
});

test("safety: toTripResponse exposes no credentials or internal-only fields", async () => {
  const trip = await createTripFromBrief("Trip to Cairo under £700.");
  const res = toTripResponse(trip);
  const json = JSON.stringify(res).toLowerCase();
  assert.ok(!json.includes("service_role"));
  assert.ok(!json.includes("supabase"));
  assert.ok(!json.includes("api_key"));
  // Shape the frontend/task expects.
  assert.equal(res.id, trip.id);
  assert.ok(res.intent && typeof res.intent.destination === "string");
});
