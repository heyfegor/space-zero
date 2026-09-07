/**
 * Space Zero — funding service + funding-update validation tests.
 *
 * Exercises the deterministic funding boundary over the in-memory repositories
 * (no live Supabase): estimated cost from the selected option, funding lifecycle
 * persistence, the "never store FUNDED when short" guard, and UNFUNDED reset.
 * Funding must not touch authority or the recovery allowance.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createTripFromBrief, getTrip } from "./service";
import { getFundingView, updateFunding, estimatedCostForTrip } from "./funding-service";
import { fundingUpdateSchema } from "./schemas";
import { getFlightOptionRepository } from "../persistence/flight-option-repository";
import type { FlightOption } from "../../domain/flight-option";

function option(tripId: string, id: string, amount: number, opts: Partial<FlightOption> = {}): FlightOption {
  return {
    id,
    tripId,
    providerOfferId: `off_${id}`,
    segments: [{ from: "LHR", to: "SYD", departAt: "2026-09-04T20:00:00Z", arriveAt: "2026-09-06T08:40:00Z" }],
    totalAmount: amount,
    currency: "GBP",
    durationMinutes: 1325,
    connections: 1,
    departAt: "2026-09-04T20:00:00Z",
    arriveAt: "2026-09-06T08:40:00Z",
    rank: 0,
    recommended: false,
    selected: false,
    expiresAt: null,
    ...opts,
  };
}

async function seedTripWithOptions(amount: number, opts?: Partial<FlightOption>) {
  const trip = await createTripFromBrief("Get me to Sydney under £1,500.");
  await getFlightOptionRepository().replaceForTrip(trip.id, [
    option(trip.id, "opt_a", amount, { selected: true, recommended: true, ...opts }),
    option(trip.id, "opt_b", amount + 200, { rank: 1 }),
  ]);
  return trip;
}

// --- Estimated cost ---------------------------------------------------------

test("estimatedCostForTrip uses the selected option's total", async () => {
  const trip = await seedTripWithOptions(1468);
  assert.equal(await estimatedCostForTrip(trip), 1468);
});

test("estimatedCostForTrip is 0 when no options have been searched", async () => {
  const trip = await createTripFromBrief("Trip to Oslo.");
  assert.equal(await estimatedCostForTrip(trip), 0);
});

// --- Funding view -----------------------------------------------------------

test("getFundingView starts UNFUNDED with the estimated cost as the shortfall", async () => {
  const trip = await seedTripWithOptions(1468);
  const view = await getFundingView(trip.id);
  assert.ok(view);
  assert.equal(view?.status, "UNFUNDED");
  assert.equal(view?.estimatedCost, 1468);
  assert.equal(view?.fundedAmount, 0);
  assert.equal(view?.shortfall, 1468);
  assert.equal(view?.sufficient, false);
});

test("getFundingView returns null for an unknown trip", async () => {
  assert.equal(await getFundingView("missing-" + crypto.randomUUID()), null);
});

// --- Funding lifecycle ------------------------------------------------------

test("updateFunding persists PROCESSING then FUNDED with a buffer", async () => {
  const trip = await seedTripWithOptions(1468);

  const processing = await updateFunding(trip.id, { status: "PROCESSING", fundedAmount: 1800 });
  assert.equal(processing?.status, "PROCESSING");
  assert.equal(processing?.fundedAmount, 1800);

  const funded = await updateFunding(trip.id, { status: "FUNDED", fundedAmount: 1800 });
  assert.equal(funded?.status, "FUNDED");
  assert.equal(funded?.remaining, 332);
  assert.equal(funded?.buffer, 332);
  assert.equal(funded?.sufficient, true);

  // Persisted: a fresh read reflects the stored funding.
  const reread = await getFundingView(trip.id);
  assert.equal(reread?.status, "FUNDED");
  assert.equal(reread?.fundedAmount, 1800);
});

test("updateFunding never records FUNDED when the amount is short", async () => {
  const trip = await seedTripWithOptions(1468);
  const result = await updateFunding(trip.id, { status: "FUNDED", fundedAmount: 1200 });
  assert.equal(result?.status, "INSUFFICIENT"); // coerced — no false FUNDED claim
  assert.equal(result?.shortfall, 268);

  const persisted = await getTrip(trip.id);
  assert.equal(persisted?.fundingStatus, "INSUFFICIENT");
  assert.equal(persisted?.fundedAmount, 1200);
});

test("updateFunding UNFUNDED clears the balance", async () => {
  const trip = await seedTripWithOptions(1468);
  await updateFunding(trip.id, { status: "FUNDED", fundedAmount: 1800 });
  const cleared = await updateFunding(trip.id, { status: "UNFUNDED" });
  assert.equal(cleared?.status, "UNFUNDED");
  assert.equal(cleared?.fundedAmount, 0);
  const persisted = await getTrip(trip.id);
  assert.equal(persisted?.fundedAmount, null);
});

test("funding is separate from authority: funding a trip leaves budget/allowance untouched", async () => {
  const trip = await createTripFromBrief("Get me to Sydney under £1,200, spend up to £150 to fix disruptions.");
  await getFlightOptionRepository().replaceForTrip(trip.id, [option(trip.id, "opt_a", 1000, { selected: true })]);
  const before = await getTrip(trip.id);
  await updateFunding(trip.id, { status: "FUNDED", fundedAmount: 1500 });
  const after = await getTrip(trip.id);
  assert.equal(after?.tripBudget, before?.tripBudget);
  assert.equal(after?.recoveryAllowance, before?.recoveryAllowance);
  assert.equal(after?.recoveryAllowance, 150);
});

test("updateFunding returns null for an unknown trip", async () => {
  assert.equal(await updateFunding("missing-" + crypto.randomUUID(), { status: "FUNDED", fundedAmount: 100 }), null);
});

// --- Request validation -----------------------------------------------------

test("fundingUpdateSchema accepts valid updates and rejects junk", () => {
  assert.equal(fundingUpdateSchema.safeParse({ status: "FUNDED", fundedAmount: 1800 }).success, true);
  assert.equal(fundingUpdateSchema.safeParse({ status: "UNFUNDED" }).success, true);
  assert.equal(fundingUpdateSchema.safeParse({ status: "PROCESSING", fundedAmount: null }).success, true);
  // Bad status, negative amount, and unknown fields are all rejected.
  assert.equal(fundingUpdateSchema.safeParse({ status: "funded" }).success, false);
  assert.equal(fundingUpdateSchema.safeParse({ status: "FUNDED", fundedAmount: -1 }).success, false);
  assert.equal(fundingUpdateSchema.safeParse({ status: "FUNDED", trip_budget: 9 }).success, false);
  assert.equal(fundingUpdateSchema.safeParse({ fundedAmount: 100 }).success, false); // status required
});
