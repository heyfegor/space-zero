import { test } from "node:test";
import assert from "node:assert/strict";
import type { Trip } from "./trip";
import {
  canTransition,
  assertTransition,
  transition,
  InvalidTransitionError,
} from "./trip-state";

test("valid forward transitions succeed", () => {
  assert.equal(canTransition("DRAFT", "PLANNING"), true);
  assert.equal(canTransition("AWAITING_AUTHORITY", "READY"), true);
  assert.equal(canTransition("READY", "BOOKING"), true);
  assert.equal(canTransition("BOOKING", "CONFIRMED"), true);
  assert.equal(canTransition("CONFIRMED", "MONITORING"), true);
  assert.equal(canTransition("MONITORING", "AT_RISK"), true);
  assert.equal(canTransition("AT_RISK", "RECOVERING"), true);
  assert.equal(canTransition("RECOVERING", "RESOLVED"), true);
});

test("minimal branches the recovery loop needs", () => {
  assert.equal(canTransition("MONITORING", "RESOLVED"), true);
  assert.equal(canTransition("RECOVERING", "MONITORING"), true);
});

test("invalid transitions fail deterministically", () => {
  assert.equal(canTransition("DRAFT", "RESOLVED"), false);
  assert.equal(canTransition("CONFIRMED", "DRAFT"), false);
  assert.throws(() => assertTransition("DRAFT", "RESOLVED"), InvalidTransitionError);
  assert.throws(() => assertTransition("CONFIRMED", "DRAFT"), InvalidTransitionError);
});

test("RESOLVED is terminal", () => {
  assert.equal(canTransition("RESOLVED", "MONITORING"), false);
  assert.equal(canTransition("RESOLVED", "PLANNING"), false);
});

test("transition() returns a new trip and does not mutate", () => {
  const trip: Trip = {
    id: "t1",
    origin: "SIN",
    destination: "SYD",
    segments: [],
    arrivalDeadline: "2026-09-05T09:00:00+10:00",
    currency: "GBP",
    tripBudget: 1200,
    recoveryAllowance: 150,
    checkedBags: 1,
    autoRebook: true,
    status: "AT_RISK",
  };
  const next = transition(trip, "RECOVERING");
  assert.equal(next.status, "RECOVERING");
  assert.equal(trip.status, "AT_RISK"); // original unchanged
  assert.notEqual(next, trip);
});

test("transition() throws on an invalid move", () => {
  const trip: Trip = {
    id: "t2",
    origin: "SIN",
    destination: "SYD",
    segments: [],
    arrivalDeadline: "2026-09-05T09:00:00+10:00",
    currency: "GBP",
    tripBudget: 1200,
    recoveryAllowance: 150,
    checkedBags: 1,
    autoRebook: true,
    status: "CONFIRMED",
  };
  assert.throws(() => transition(trip, "DRAFT"), InvalidTransitionError);
});
