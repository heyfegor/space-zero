/**
 * Space Zero — funding domain tests. Pure state + arithmetic; no DB/provider.
 * Verifies the funded/remaining/buffer math, coverage-based status resolution
 * (FUNDED is never claimed when short), and legacy status normalization.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FUNDING_STATUSES,
  DEFAULT_FUNDING_STATUS,
  asFundingStatus,
  isSufficient,
  resolveFundingStatus,
  computeFunding,
} from "./funding";

// --- Enum + normalization ---------------------------------------------------

test("funding statuses are the four uppercase states", () => {
  assert.deepEqual([...FUNDING_STATUSES], ["UNFUNDED", "PROCESSING", "FUNDED", "INSUFFICIENT"]);
  assert.equal(DEFAULT_FUNDING_STATUS, "UNFUNDED");
});

test("asFundingStatus normalizes legacy lowercase and rejects junk", () => {
  assert.equal(asFundingStatus("funded"), "FUNDED");
  assert.equal(asFundingStatus("processing"), "PROCESSING");
  assert.equal(asFundingStatus("UNFUNDED"), "UNFUNDED");
  assert.equal(asFundingStatus(null), "UNFUNDED");
  assert.equal(asFundingStatus(""), "UNFUNDED");
  assert.equal(asFundingStatus("whatever"), "UNFUNDED");
});

// --- Coverage ---------------------------------------------------------------

test("isSufficient requires a positive amount that covers the cost", () => {
  assert.equal(isSufficient(1500, 1468), true);
  assert.equal(isSufficient(1468, 1468), true);
  assert.equal(isSufficient(1400, 1468), false);
  assert.equal(isSufficient(0, 0), false); // zero is never "sufficient"
  assert.equal(isSufficient(null, 100), false);
});

// --- Status resolution ------------------------------------------------------

test("resolveFundingStatus never records FUNDED when short", () => {
  assert.equal(resolveFundingStatus("FUNDED", 1500, 1468), "FUNDED");
  assert.equal(resolveFundingStatus("FUNDED", 1400, 1468), "INSUFFICIENT");
  assert.equal(resolveFundingStatus("INSUFFICIENT", 2000, 1468), "FUNDED");
  assert.equal(resolveFundingStatus("PROCESSING", 1400, 1468), "PROCESSING");
  assert.equal(resolveFundingStatus("UNFUNDED", 9999, 1468), "UNFUNDED");
});

// --- Funding math -----------------------------------------------------------

test("computeFunding: sufficient balance yields FUNDED with a positive buffer", () => {
  const v = computeFunding({ estimatedCost: 1468, fundedAmount: 1800, status: "FUNDED", currency: "GBP" });
  assert.equal(v.status, "FUNDED");
  assert.equal(v.fundedAmount, 1800);
  assert.equal(v.estimatedCost, 1468);
  assert.equal(v.remaining, 332);
  assert.equal(v.buffer, 332);
  assert.equal(v.shortfall, 0);
  assert.equal(v.sufficient, true);
});

test("computeFunding: short balance is reported as INSUFFICIENT with a shortfall", () => {
  const v = computeFunding({ estimatedCost: 1468, fundedAmount: 1200, status: "FUNDED", currency: "GBP" });
  assert.equal(v.status, "INSUFFICIENT"); // reconciled down — never claims FUNDED
  assert.equal(v.remaining, -268);
  assert.equal(v.buffer, 0);
  assert.equal(v.shortfall, 268);
  assert.equal(v.sufficient, false);
});

test("computeFunding: unfunded has a zero balance and passes status through", () => {
  const v = computeFunding({ estimatedCost: 1468, fundedAmount: null, status: "UNFUNDED", currency: "GBP" });
  assert.equal(v.status, "UNFUNDED");
  assert.equal(v.fundedAmount, 0);
  assert.equal(v.buffer, 0);
  assert.equal(v.shortfall, 1468);
  assert.equal(v.sufficient, false);
});

test("computeFunding: PROCESSING passes through and negatives are clamped", () => {
  const v = computeFunding({ estimatedCost: 100, fundedAmount: -50, status: "PROCESSING", currency: "GBP" });
  assert.equal(v.status, "PROCESSING");
  assert.equal(v.fundedAmount, 0);
  assert.equal(v.remaining, -100);
});
