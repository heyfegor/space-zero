import { test } from "node:test";
import assert from "node:assert/strict";
import type { Trip } from "../../domain/trip";
import { putTrip, getTripById } from "./dev-store";
import { recoverTripTool } from "./recover-trip";
import { executeBookingTool } from "./execute-booking";

function seedTrip(id: string): Trip {
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
    recoveryAllowance: 150,
    checkedBags: 1,
    autoRebook: true,
    status: "AT_RISK",
    bookingReference: "SZ-1000",
  });
}

// E. recover_trip must NOT mutate booking state.
test("E: recover_trip is read-only and does not mutate trip state", async () => {
  seedTrip("e_trip");
  const r = (await recoverTripTool.invoke({ tripId: "e_trip" })) as any;

  assert.equal(r.found, true);
  assert.equal(r.options.length, 2);
  assert.equal(r.options[0].additionalCost, 96);
  assert.equal(r.options[0].withinAuthority, true); // 96 <= 150
  assert.equal(r.options[1].additionalCost, 181);
  assert.equal(r.options[1].withinAuthority, false); // 181 > 150

  const after = getTripById("e_trip")!;
  assert.equal(after.status, "AT_RISK"); // unchanged
  assert.equal(after.bookingReference, "SZ-1000"); // unchanged
});

// F. Successful staged execute_booking → reference + advanced trip state.
test("F: permitted execute_booking is STAGED, returns a reference, advances state", async () => {
  seedTrip("f_trip");
  const r = (await executeBookingTool.invoke({
    tripId: "f_trip",
    amount: 96,
    description: "Recovery SIN → SYD",
  })) as any;

  assert.equal(r.ok, true);
  assert.equal(r.mode, "STAGED");
  assert.match(r.bookingReference, /^SZ-\d{4}$/);

  const after = getTripById("f_trip")!;
  assert.equal(after.status, "RESOLVED"); // AT_RISK → RECOVERING → RESOLVED
  assert.equal(after.bookingReference, r.bookingReference); // reference persisted
});

// C (tool level). execute_booking enforces authority itself: an over-allowance
// amount is rejected and state is untouched — even though check_authority is
// never called in this test.
test("C(tool): execute_booking rejects over-allowance and leaves state untouched", async () => {
  seedTrip("c_trip");
  const r = (await executeBookingTool.invoke({
    tripId: "c_trip",
    amount: 181, // > 150 allowance
  })) as any;

  assert.equal(r.ok, false);

  const after = getTripById("c_trip")!;
  assert.equal(after.status, "AT_RISK"); // unchanged — no state advance on denial
  assert.equal(after.bookingReference, "SZ-1000"); // unchanged — no new reference
});
