/**
 * Space Zero — funding service (server-side orchestration).
 *
 * Owns reading and updating a trip's PERSISTED funding state. Deterministic
 * application code: it derives the estimated cost from the trip's selected real
 * flight option, computes the funding view, and — critically — resolves the
 * stored status against that cost so the store never records FUNDED when the
 * set-aside amount is short.
 *
 * No money moves here. Airwallex is not integrated; this is funding
 * state/persistence only. Funding is SEPARATE from authority and the recovery
 * allowance, which are untouched by this module.
 */

import type { Trip } from "../../domain/trip";
import {
  computeFunding,
  resolveFundingStatus,
  DEFAULT_FUNDING_STATUS,
  type FundingStatus,
  type FundingView,
} from "../../domain/funding";
import { getTripRepository } from "../persistence/trip-repository";
import { getFlightOptionRepository } from "../persistence/flight-option-repository";
import type { TripPatch } from "../persistence/trip-row";

/**
 * Estimated cost for a trip = the total of the option the traveler selected on
 * Options (a real Duffel offer once search runs). Falls back to the recommended
 * option, then the first, then 0 when nothing has been searched/selected yet.
 */
export async function estimatedCostForTrip(trip: Trip): Promise<number> {
  const options = await getFlightOptionRepository().listForTrip(trip.id);
  if (options.length === 0) return 0;
  const chosen =
    options.find((o) => o.selected) ??
    (trip.selectedOptionId ? options.find((o) => o.id === trip.selectedOptionId) : undefined) ??
    options.find((o) => o.recommended) ??
    options[0];
  return chosen?.totalAmount ?? 0;
}

function viewFor(trip: Trip, estimatedCost: number): FundingView {
  return computeFunding({
    estimatedCost,
    fundedAmount: trip.fundedAmount ?? null,
    status: trip.fundingStatus ?? DEFAULT_FUNDING_STATUS,
    currency: trip.currency,
  });
}

/** Read the computed funding view for a trip, or null if the trip is missing. */
export async function getFundingView(id: string): Promise<FundingView | null> {
  const trip = await getTripRepository().getById(id);
  if (!trip) return null;
  return viewFor(trip, await estimatedCostForTrip(trip));
}

/** The validated funding update the route hands to the service. */
export interface FundingUpdateInput {
  status: FundingStatus;
  fundedAmount?: number | null;
}

/**
 * Persist a funding update. The requested status is resolved against the real
 * estimated cost before it is stored, so FUNDED is only ever recorded when the
 * amount actually covers the trip. UNFUNDED clears the balance. Returns the
 * recomputed view, or null if the trip does not exist.
 */
export async function updateFunding(id: string, input: FundingUpdateInput): Promise<FundingView | null> {
  const repo = getTripRepository();
  const trip = await repo.getById(id);
  if (!trip) return null;

  const estimatedCost = await estimatedCostForTrip(trip);

  // UNFUNDED wipes the balance; every other state keeps/sets an amount, falling
  // back to the already-stored amount when the client omits it.
  const fundedAmount: number | null =
    input.status === "UNFUNDED" ? null : input.fundedAmount ?? trip.fundedAmount ?? 0;

  const status = resolveFundingStatus(input.status, fundedAmount, estimatedCost);

  const patch: TripPatch = { fundingStatus: status, fundedAmount };
  const updated = await repo.update(id, patch);
  if (!updated) return null;

  return viewFor(updated, estimatedCost);
}
