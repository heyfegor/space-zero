/**
 * Space Zero — trip service (server-side orchestration).
 *
 * Deterministic application code that owns trip creation/read/update. It parses
 * the brief into a validated intent, builds a domain Trip, and writes it through
 * the repository. The model (if ever used for parsing) never reaches this write
 * path — only validated data does.
 */

import type { Trip, TripIntent, TripStatus } from "../../domain/trip";
import type { FundingStatus } from "../../domain/funding";
import { DEFAULT_FUNDING_STATUS } from "../../domain/funding";
import { getTripRepository, DEV_USER_ID } from "../persistence/trip-repository";
import { tripToIntent, type TripPatch } from "../persistence/trip-row";
import { parseBrief } from "./intent-parser";
import type { TripPatchInput } from "./schemas";

/** Initial lifecycle status for a freshly briefed trip. */
const INITIAL_STATUS: TripStatus = "DRAFT";

function checkedBagsFrom(baggage?: string): number {
  const m = baggage?.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/** The API view of a trip (no secrets, no internal-only fields). */
export interface TripResponse {
  id: string;
  status: TripStatus;
  brief: string;
  currency: string;
  intent: TripIntent;
  selectedOptionId: string | null;
  /**
   * Persisted funding snapshot — SEPARATE from authority. Exposed so downstream
   * screens (Authorization, and later Execution) can read the funding state
   * without a second call. The full computed view (remaining/buffer) is served
   * by GET /api/trips/[id]/funding.
   */
  funding: { amount: number | null; status: FundingStatus };
}

export function toTripResponse(trip: Trip): TripResponse {
  return {
    id: trip.id,
    status: trip.status,
    brief: trip.brief ?? "",
    currency: trip.currency,
    intent: tripToIntent(trip),
    selectedOptionId: trip.selectedOptionId ?? null,
    funding: { amount: trip.fundedAmount ?? null, status: trip.fundingStatus ?? DEFAULT_FUNDING_STATUS },
  };
}

/** Create a persistent trip from a raw brief. */
export async function createTripFromBrief(brief: string): Promise<Trip> {
  const intent = parseBrief(brief);
  const trip: Trip = {
    id: crypto.randomUUID(),
    userId: DEV_USER_ID,
    status: INITIAL_STATUS,
    brief,
    origin: intent.origin ?? "",
    destination: intent.destination,
    segments: [],
    arrivalDeadline: "",
    arriveBy: intent.arriveBy,
    depart: intent.depart,
    currency: "GBP",
    tripBudget: intent.budget ?? 0,
    recoveryAllowance: intent.recoveryAllowance ?? 0,
    fundedAmount: null,
    fundingStatus: DEFAULT_FUNDING_STATUS,
    cabin: intent.cabin,
    baggage: intent.baggage,
    seat: intent.seat,
    selectedOptionId: null,
    checkedBags: checkedBagsFrom(intent.baggage),
    autoRebook: true,
  };
  return getTripRepository().create(trip);
}

export async function getTrip(id: string): Promise<Trip | null> {
  return getTripRepository().getById(id);
}

/** Apply a validated patch (already parsed by tripPatchSchema at the route). */
export async function updateTrip(id: string, input: TripPatchInput): Promise<Trip | null> {
  const patch: TripPatch = input;
  return getTripRepository().update(id, patch);
}
