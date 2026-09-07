/**
 * Space Zero — flight search orchestration (deterministic; server-side).
 *
 * Loads the trip, derives search params, calls Duffel, normalizes + ranks the
 * offers deterministically, and REPLACES the trip's persisted options. Every
 * outcome is an explicit, honest status — it never fabricates flights when the
 * provider is unconfigured or fails.
 *
 * Dependencies are injectable so the whole pipeline is testable without a key or
 * the network (tests pass a fake DuffelClient and in-memory repos).
 */

import type { FlightOption } from "../../domain/flight-option";
import { getDuffelClient, isDuffelConfigured, type DuffelClient } from "../../providers/duffel";
import { getTripRepository, type TripRepository } from "../persistence/trip-repository";
import { getFlightOptionRepository, type FlightOptionRepository } from "../persistence/flight-option-repository";
import { deriveSearchParams } from "./search-params";
import { normalizeOffers } from "./normalize";
import { rankOptions } from "./rank";

export type SearchStatus =
  | "ok"
  | "no_results"
  | "provider_unconfigured"
  | "provider_error"
  | "origin_unknown"
  | "destination_unknown"
  | "trip_not_found";

export interface SearchOutcome {
  status: SearchStatus;
  options: FlightOption[];
}

export interface SearchDeps {
  duffel?: DuffelClient;
  tripRepo?: TripRepository;
  optionRepo?: FlightOptionRepository;
  makeId?: () => string;
}

/**
 * The most recent outcome per trip. Lets the agent-orchestrated search route
 * report the precise deterministic status (the tool runs inside the agent, so
 * its return value isn't otherwise on the route's return path). Process-local.
 */
const lastOutcome = new Map<string, SearchOutcome>();
export function getLastSearchOutcome(tripId: string): SearchOutcome | undefined {
  return lastOutcome.get(tripId);
}

export async function searchAndPersistFlights(tripId: string, deps: SearchDeps = {}): Promise<SearchOutcome> {
  const outcome = await runSearch(tripId, deps);
  lastOutcome.set(tripId, outcome);
  return outcome;
}

async function runSearch(tripId: string, deps: SearchDeps): Promise<SearchOutcome> {
  const tripRepo = deps.tripRepo ?? getTripRepository();
  const optionRepo = deps.optionRepo ?? getFlightOptionRepository();
  const makeId = deps.makeId ?? (() => crypto.randomUUID());

  const trip = await tripRepo.getById(tripId);
  if (!trip) return { status: "trip_not_found", options: [] };

  // Honest: without a configured provider we do not invent flights.
  if (!deps.duffel && !isDuffelConfigured()) return { status: "provider_unconfigured", options: [] };
  const duffel = deps.duffel ?? getDuffelClient();

  const derived = deriveSearchParams(trip);
  if (!derived.ok) return { status: derived.reason, options: [] };

  let offers;
  try {
    offers = await duffel.searchOffers(derived.params);
  } catch {
    return { status: "provider_error", options: [] };
  }

  const normalized = normalizeOffers(offers, tripId, makeId);
  const { ranked } = rankOptions(normalized, { deadline: derived.deadline });
  if (ranked.length === 0) return { status: "no_results", options: [] };

  const stored = await optionRepo.replaceForTrip(tripId, ranked);
  return { status: "ok", options: stored };
}
