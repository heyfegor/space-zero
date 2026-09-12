/**
 * Space Zero — flight-status provider (server-side only).
 *
 * A provider-agnostic seam for REAL flight monitoring, mirroring the Duffel
 * provider's shape so the monitoring provider can be swapped without touching
 * the domain or the service. `FlightStatusProvider` is the interface the service
 * depends on; `HttpFlightAwareClient` is the concrete implementation over
 * FlightAware's AeroAPI. Tests inject a fake — no key, no network.
 *
 * `isFlightStatusConfigured()` gates real calls: when the key is absent the
 * monitoring service returns an honest "unavailable" state rather than
 * fabricating a status (never claim a flight is fine when we cannot see it).
 *
 * Never import this from a client component; it reads FLIGHTAWARE_API_KEY.
 */

import type { ObservedStatus } from "../domain/disruption";

/** What we ask the provider about — one booked flight on a date. */
export interface FlightStatusQuery {
  /** Marketing carrier IATA code, if known (e.g. "SQ"). */
  carrier?: string;
  /**
   * Flight identifier. Either a bare number ("317") combined with `carrier`, or
   * a full IATA ident ("SQ317"). The client builds the provider ident from these.
   */
  flightNumber: string;
  /** Scheduled departure date (YYYY-MM-DD) — disambiguates recurring flights. */
  departureDate: string;
  /** Origin/destination IATA — used to pick the right leg from the response. */
  from: string;
  to: string;
}

/**
 * A single provider observation, already mapped to Space Zero's vocabulary but
 * NOT yet judged against the trip. Times are ISO 8601. `null` means the provider
 * had no value; the caller must not invent one.
 */
export interface ProviderFlightStatus {
  status: ObservedStatus;
  cancelled: boolean;
  diverted: boolean;
  scheduledDepartAt: string | null;
  estimatedDepartAt: string | null;
  scheduledArriveAt: string | null;
  estimatedArriveAt: string | null;
}

export interface FlightStatusProvider {
  /**
   * Look up one booked flight's current status, or null if the provider has no
   * record of it. Throws on a transport/provider failure so the caller can
   * surface an honest error state (never a fabricated "on time").
   */
  getFlightStatus(query: FlightStatusQuery): Promise<ProviderFlightStatus | null>;
}

/** True when a flight-status provider key is configured (server-side). */
export function isFlightStatusConfigured(): boolean {
  return Boolean(process.env.FLIGHTAWARE_API_KEY);
}

const AEROAPI_BASE = "https://aeroapi.flightaware.com/aeroapi";

// --- Minimal shapes of the AeroAPI response we consume ----------------------

export interface AeroApiFlight {
  ident?: string;
  ident_iata?: string;
  cancelled?: boolean;
  diverted?: boolean;
  origin?: { code?: string; code_iata?: string };
  destination?: { code?: string; code_iata?: string };
  scheduled_out?: string | null;
  estimated_out?: string | null;
  actual_out?: string | null;
  scheduled_in?: string | null;
  estimated_in?: string | null;
  actual_in?: string | null;
  status?: string;
}

function iataOf(place?: { code?: string; code_iata?: string }): string | undefined {
  return place?.code_iata ?? place?.code;
}

/** Map AeroAPI's flags/status text to Space Zero's normalized ObservedStatus. */
function toObservedStatus(f: AeroApiFlight): ObservedStatus {
  if (f.cancelled) return "CANCELLED";
  if (f.diverted) return "DIVERTED";
  if (f.actual_in) return "LANDED";
  if (f.actual_out) return "ACTIVE";
  const text = (f.status ?? "").toLowerCase();
  if (text.includes("cancel")) return "CANCELLED";
  if (text.includes("divert")) return "DIVERTED";
  if (text.includes("delay")) return "DELAYED";
  if (text.includes("arriv") || text.includes("landed")) return "LANDED";
  if (text.includes("en route") || text.includes("airborne") || text.includes("active")) return "ACTIVE";
  return "SCHEDULED";
}

/**
 * Normalize a raw AeroAPI `/flights/{ident}` response into a single
 * `ProviderFlightStatus`, picking the flight that matches the booked route +
 * date (falling back conservatively). Pure: no network, no key — the ONE place
 * raw provider data becomes Space Zero's vocabulary, so the live HTTP client and
 * any deterministic fixture path share exactly the same normalization. Returns
 * null when the response has no flights (the caller must not invent one).
 */
export function normalizeAeroApiResponse(
  json: { flights?: AeroApiFlight[] },
  query: { from: string; to: string; departureDate: string },
): ProviderFlightStatus | null {
  const flights = json.flights ?? [];
  if (flights.length === 0) return null;

  // Pick the flight matching the booked route + date; fall back to the first.
  const dayMatch = (f: AeroApiFlight) =>
    (f.scheduled_out ?? "").startsWith(query.departureDate) ||
    (f.estimated_out ?? "").startsWith(query.departureDate);
  const routeMatch = (f: AeroApiFlight) =>
    iataOf(f.origin) === query.from && iataOf(f.destination) === query.to;

  const chosen =
    flights.find((f) => routeMatch(f) && dayMatch(f)) ??
    flights.find(routeMatch) ??
    flights.find(dayMatch) ??
    flights[0];

  return {
    status: toObservedStatus(chosen),
    cancelled: Boolean(chosen.cancelled),
    diverted: Boolean(chosen.diverted),
    scheduledDepartAt: chosen.scheduled_out ?? null,
    estimatedDepartAt: chosen.estimated_out ?? chosen.actual_out ?? null,
    scheduledArriveAt: chosen.scheduled_in ?? null,
    estimatedArriveAt: chosen.estimated_in ?? chosen.actual_in ?? null,
  };
}

/**
 * Real FlightAware AeroAPI client. Throws on any non-2xx so the caller surfaces
 * an honest provider-failure state; returns null (never a guess) when the flight
 * is not found for the requested route/date.
 */
export class HttpFlightAwareClient implements FlightStatusProvider {
  private requireKey(): string {
    const key = process.env.FLIGHTAWARE_API_KEY;
    if (!key) throw new Error("FLIGHTAWARE_API_KEY is not set.");
    return key;
  }

  private ident(query: FlightStatusQuery): string {
    const fn = query.flightNumber.trim();
    // A full ident ("SQ317") already carries the carrier; a bare number needs it.
    if (/^[A-Za-z]/.test(fn)) return fn.toUpperCase();
    return `${(query.carrier ?? "").toUpperCase()}${fn}`;
  }

  async getFlightStatus(query: FlightStatusQuery): Promise<ProviderFlightStatus | null> {
    const key = this.requireKey();
    const ident = this.ident(query);
    if (!ident) return null;

    const res = await fetch(`${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}`, {
      method: "GET",
      headers: { "x-apikey": key, Accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Flight-status lookup failed (${res.status}).`);
    }

    const json = (await res.json()) as { flights?: AeroApiFlight[] };
    return normalizeAeroApiResponse(json, {
      from: query.from,
      to: query.to,
      departureDate: query.departureDate,
    });
  }
}

/** Default provider accessor (real HTTP client). Tests inject their own. */
export function getFlightStatusProvider(): FlightStatusProvider {
  return new HttpFlightAwareClient();
}
