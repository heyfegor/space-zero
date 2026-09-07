import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAuthority } from "./authority";

test("96 / 150 → permitted, 54 remaining", () => {
  const r = evaluateAuthority(96, 150);
  assert.equal(r.permitted, true);
  assert.equal(r.requestedAmount, 96);
  assert.equal(r.recoveryAllowance, 150);
  assert.equal(r.remainingAllowance, 54);
});

test("150 / 150 → permitted at the boundary, 0 remaining", () => {
  const r = evaluateAuthority(150, 150);
  assert.equal(r.permitted, true);
  assert.equal(r.remainingAllowance, 0);
});

test("151 / 150 → denied just over the boundary", () => {
  const r = evaluateAuthority(151, 150);
  assert.equal(r.permitted, false);
  // Denied: nothing spent, full allowance remains.
  assert.equal(r.remainingAllowance, 150);
});

test("181 / 150 → denied", () => {
  const r = evaluateAuthority(181, 150);
  assert.equal(r.permitted, false);
});

test("fails closed on invalid inputs", () => {
  assert.equal(evaluateAuthority(-5, 150).permitted, false);
  assert.equal(evaluateAuthority(Number.NaN, 150).permitted, false);
  assert.equal(evaluateAuthority(50, -1).permitted, false);
});
