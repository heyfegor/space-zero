import { test } from "node:test";
import assert from "node:assert/strict";
import { executeStagedBooking, stagedBookingReference } from "./booking";

test("permitted amount → staged execution succeeds with a reference", () => {
  const r = executeStagedBooking({
    tripId: "trip_demo",
    amount: 96,
    recoveryAllowance: 150,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "STAGED");
  assert.equal(r.amountCharged, 96);
  assert.equal(r.authority.permitted, true);
  assert.match(r.bookingReference ?? "", /^SZ-\d{4}$/);
});

test("boundary amount (150 / 150) → permitted", () => {
  const r = executeStagedBooking({
    tripId: "trip_demo",
    amount: 150,
    recoveryAllowance: 150,
  });
  assert.equal(r.ok, true);
});

test("amount above allowance → execution rejected, no reference, no charge", () => {
  const r = executeStagedBooking({
    tripId: "trip_demo",
    amount: 181,
    recoveryAllowance: 150,
  });
  assert.equal(r.ok, false);
  assert.equal(r.authority.permitted, false);
  assert.equal(r.bookingReference, undefined);
  assert.equal(r.amountCharged, undefined);
});

// KEY ARCHITECTURAL INVARIANT:
// execute_booking enforces authority ITSELF. Even if a caller skips
// check_authority entirely (simulating a bypass attempt), an over-allowance
// amount is still refused — enforcement does not depend on the advisory call.
test("INVARIANT: execute enforces authority even if check_authority is bypassed", () => {
  // No check_authority is called anywhere in this test.
  const denied = executeStagedBooking({
    tripId: "trip_demo",
    amount: 181, // over the 150 allowance
    recoveryAllowance: 150,
  });
  assert.equal(denied.ok, false, "over-allowance must be refused without any prior check");

  const permitted = executeStagedBooking({
    tripId: "trip_demo",
    amount: 96,
    recoveryAllowance: 150,
  });
  assert.equal(permitted.ok, true, "within-allowance still succeeds on its own");
});

test("confirmation reference is deterministic for the same inputs", () => {
  const a = stagedBookingReference("trip_demo", 96);
  const b = stagedBookingReference("trip_demo", 96);
  assert.equal(a, b);
  assert.match(a, /^SZ-\d{4}$/);
  // Different inputs generally differ.
  assert.notEqual(stagedBookingReference("trip_demo", 96), stagedBookingReference("trip_demo", 181));
});
