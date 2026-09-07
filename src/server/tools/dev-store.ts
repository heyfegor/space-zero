/**
 * Space Zero — in-memory development trip store (server-side, dev fixture).
 *
 * A stand-in for real persistence so the tools have state to read/write during
 * development. NOT a database and NOT production. Data lives only in process
 * memory and resets on restart. Replaced later by a real persistence layer.
 */

import type { Trip } from "../../domain/trip";

const trips = new Map<string, Trip>();

export function getTripById(id: string): Trip | undefined {
  return trips.get(id);
}

export function putTrip(trip: Trip): Trip {
  trips.set(trip.id, trip);
  return trip;
}

export function listTrips(): Trip[] {
  return [...trips.values()];
}

/**
 * The demo fixture: a booked LHR → SIN → SYD trip whose SIN → SYD connection
 * has just been disrupted, so the trip is AT_RISK, with a £150 recovery
 * allowance. Deterministic; matches the recovery-options fixture.
 */
export const DEMO_TRIP_ID = "trip_demo_lhr_sin_syd";

function buildDemoTrip(): Trip {
  return {
    id: DEMO_TRIP_ID,
    origin: "LHR",
    destination: "SYD",
    segments: [
      {
        from: "LHR",
        to: "SIN",
        departAt: "2026-09-04T21:30:00+01:00",
        arriveAt: "2026-09-05T17:45:00+08:00",
      },
      {
        // The disrupted connection.
        from: "SIN",
        to: "SYD",
        departAt: "2026-09-05T20:10:00+08:00",
        arriveAt: "2026-09-06T07:05:00+10:00",
      },
    ],
    arrivalDeadline: "2026-09-06T09:00:00+10:00",
    currency: "GBP",
    tripBudget: 1200,
    recoveryAllowance: 150,
    checkedBags: 1,
    autoRebook: true,
    status: "AT_RISK",
    bookingReference: "SZ-1000",
  };
}

/**
 * A second demo trip identical in shape but whose recovery options all EXCEED
 * the £150 allowance — used to demonstrate the authority-boundary stop.
 */
export const DEMO_TRIP_OVER_LIMIT_ID = "trip_demo_over_limit";

function buildOverLimitTrip(): Trip {
  return { ...buildDemoTrip(), id: DEMO_TRIP_OVER_LIMIT_ID };
}

/** Ensure both demo trips exist; returns the primary one. Idempotent. */
export function seedDemoTrip(): Trip {
  const primary = trips.get(DEMO_TRIP_ID) ?? putTrip(buildDemoTrip());
  if (!trips.get(DEMO_TRIP_OVER_LIMIT_ID)) putTrip(buildOverLimitTrip());
  return primary;
}

/**
 * Rebuild a demo trip back to its fresh AT_RISK state so the recovery demo is
 * repeatable. No-op for non-demo trip ids.
 */
export function resetDemoTrip(id: string): Trip | undefined {
  if (id === DEMO_TRIP_ID) return putTrip(buildDemoTrip());
  if (id === DEMO_TRIP_OVER_LIMIT_ID) return putTrip(buildOverLimitTrip());
  return undefined;
}

// Seed on first import so the tools always have the demo trips available.
seedDemoTrip();
