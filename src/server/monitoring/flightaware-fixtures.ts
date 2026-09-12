/**
 * Space Zero — FlightAware AeroAPI FIXTURES for the deterministic demo/test path.
 *
 * This is NOT the live provider and it never pretends the live API was called.
 * It holds realistic, raw AeroAPI v4 `/flights/{ident}`-shaped responses for a
 * canonical itinerary and feeds them through the SAME normalization the real
 * HttpFlightAwareClient uses (`normalizeAeroApiResponse`). That lets a demo drive
 * the existing normalize → deterministic-detect → persist → AT_RISK → recovery
 * pipeline with a known disruption, WITHOUT a network call and without inventing
 * a status downstream — the fixture is the provider's raw input, exactly as the
 * live API would shape it, and everything after it is the real code path.
 *
 * The canonical itinerary matches the monitoring tests: LHR →(SQ317)→ SIN
 * →(SQ231)→ SYD, arriving before the trip's hard deadline.
 */

import {
  normalizeAeroApiResponse,
  type AeroApiFlight,
  type FlightStatusProvider,
  type FlightStatusQuery,
  type ProviderFlightStatus,
} from "../../providers/flight-status";

/** The canonical demo itinerary (kept in sync with the monitoring fixtures). */
export const DEMO_ITINERARY = {
  deadline: "2026-09-05T21:00:00Z",
  seg1: { from: "LHR", to: "SIN", carrier: "SQ", flightNumber: "SQ317", departAt: "2026-09-04T21:00:00Z", arriveAt: "2026-09-05T14:00:00Z" },
  seg2: { from: "SIN", to: "SYD", carrier: "SQ", flightNumber: "SQ231", departAt: "2026-09-05T16:00:00Z", arriveAt: "2026-09-05T19:35:00Z" },
} as const;

/** A raw AeroAPI response for one ident (what `/flights/{ident}` returns). */
export interface AeroApiResponse {
  flights: AeroApiFlight[];
}

/** The demo scenarios — each is a realistic FlightAware-style disruption shape. */
export type DemoScenario =
  | "on_time"
  | "cancelled"
  | "diverted"
  | "missed_connection"
  | "arrival_breach"
  | "delayed_minor"
  | "departed"
  | "arrived";

function place(iata: string): { code: string; code_iata: string } {
  return { code: iata, code_iata: iata };
}

/** Base (on-time) raw flight for a leg, before a scenario mutates it. */
function baseFlight(seg: { from: string; to: string; flightNumber: string; departAt: string; arriveAt: string }): AeroApiFlight {
  return {
    ident: seg.flightNumber,
    ident_iata: seg.flightNumber,
    cancelled: false,
    diverted: false,
    origin: place(seg.from),
    destination: place(seg.to),
    scheduled_out: seg.departAt,
    estimated_out: seg.departAt,
    actual_out: null,
    scheduled_in: seg.arriveAt,
    estimated_in: seg.arriveAt,
    actual_in: null,
    status: "Scheduled",
  };
}

/**
 * Build the per-route raw AeroAPI responses for a scenario. The map is keyed by
 * "FROM-TO" so the fixture provider can answer each booked-segment query. Each
 * response also includes a decoy flight on a different date so the normalizer's
 * route+date picking is genuinely exercised (as with the real multi-hit API).
 */
export function rawResponsesFor(scenario: DemoScenario): Record<string, AeroApiResponse> {
  const { seg1, seg2 } = DEMO_ITINERARY;
  const leg1 = baseFlight(seg1);
  const leg2 = baseFlight(seg2);

  // A realistic decoy: the same ident on the PREVIOUS day (recurring flight).
  const decoy1: AeroApiFlight = {
    ...baseFlight(seg1),
    scheduled_out: "2026-09-03T21:00:00Z",
    estimated_out: "2026-09-03T21:00:00Z",
    scheduled_in: "2026-09-04T14:00:00Z",
    estimated_in: "2026-09-04T14:00:00Z",
  };

  switch (scenario) {
    case "cancelled":
      return {
        "LHR-SIN": { flights: [decoy1, { ...leg1, cancelled: true, status: "Cancelled" }] },
        "SIN-SYD": { flights: [leg2] },
      };
    case "diverted":
      return {
        "LHR-SIN": { flights: [decoy1, { ...leg1, diverted: true, status: "Diverted" }] },
        "SIN-SYD": { flights: [leg2] },
      };
    case "missed_connection":
      // Leg 1 lands 15:40 (1h40 late) → only 20 min to the 16:00 connection.
      return {
        "LHR-SIN": { flights: [decoy1, { ...leg1, estimated_in: "2026-09-05T15:40:00Z", status: "Delayed" }] },
        "SIN-SYD": { flights: [leg2] },
      };
    case "arrival_breach":
      // Final leg estimated 22:30, past the 21:00 deadline; connection still ok.
      return {
        "LHR-SIN": { flights: [decoy1, leg1] },
        "SIN-SYD": { flights: [{ ...leg2, estimated_in: "2026-09-05T22:30:00Z", status: "Delayed" }] },
      };
    case "delayed_minor":
      // Final leg 40 min late but still before the deadline → informational only.
      return {
        "LHR-SIN": { flights: [decoy1, leg1] },
        "SIN-SYD": { flights: [{ ...leg2, estimated_in: "2026-09-05T20:15:00Z", status: "Delayed" }] },
      };
    case "departed":
      // Leg 1 airborne (actual_out set; estimate tracks the actual) → ACTIVE.
      return {
        "LHR-SIN": { flights: [decoy1, { ...leg1, estimated_out: "2026-09-04T21:05:00Z", actual_out: "2026-09-04T21:05:00Z", status: "En Route" }] },
        "SIN-SYD": { flights: [leg2] },
      };
    case "arrived":
      // Leg 1 landed (actual_in set; estimates track the actuals) → LANDED.
      return {
        "LHR-SIN": {
          flights: [
            decoy1,
            {
              ...leg1,
              estimated_out: "2026-09-04T21:05:00Z",
              actual_out: "2026-09-04T21:05:00Z",
              estimated_in: "2026-09-05T13:55:00Z",
              actual_in: "2026-09-05T13:55:00Z",
              status: "Arrived",
            },
          ],
        },
        "SIN-SYD": { flights: [leg2] },
      };
    case "on_time":
    default:
      return {
        "LHR-SIN": { flights: [decoy1, leg1] },
        "SIN-SYD": { flights: [leg2] },
      };
  }
}

/**
 * A FlightStatusProvider backed by fixture responses. It runs the fixtures
 * through the REAL `normalizeAeroApiResponse`, so the observations it returns are
 * produced by the same normalization the live client uses — only the raw input
 * is canned. Unknown routes return null (as the real client does for a miss).
 */
export class FixtureFlightAwareProvider implements FlightStatusProvider {
  constructor(private readonly responsesByRoute: Record<string, AeroApiResponse>) {}

  async getFlightStatus(query: FlightStatusQuery): Promise<ProviderFlightStatus | null> {
    const raw = this.responsesByRoute[`${query.from}-${query.to}`];
    if (!raw) return null;
    return normalizeAeroApiResponse(raw, {
      from: query.from,
      to: query.to,
      departureDate: query.departureDate,
    });
  }
}

/** Convenience: a fixture provider for a named demo scenario. */
export function fixtureFlightAwareProvider(scenario: DemoScenario): FixtureFlightAwareProvider {
  return new FixtureFlightAwareProvider(rawResponsesFor(scenario));
}
