/**
 * Space Zero — funding service (server-side orchestration).
 *
 * Owns reading and updating a trip's PERSISTED funding state. Deterministic
 * application code: it derives the estimated cost from the trip's selected real
 * flight option, computes the funding view, and — critically — resolves the
 * stored status against that cost so the store never records FUNDED when the
 * set-aside amount is short.
 *
 * When Airwallex is configured, a fund request is backed by a REAL sandbox
 * payment through the payment service (the money-movement boundary): funds are
 * only recorded as set aside when the provider CONFIRMS the charge (SUCCEEDED);
 * a PENDING intent leaves the balance unsettled (status PROCESSING) so an
 * unsettled charge can never unlock a booking, and a declined/failed charge
 * records nothing as funded. When Airwallex is NOT configured, the existing
 * demo/fallback behavior is preserved exactly — the set-aside is recorded and
 * the status resolved against cost, with no provider call. Funding is SEPARATE
 * from authority and the recovery allowance, which are untouched by this module.
 */

import type { Trip } from "../../domain/trip";
import {
  computeFunding,
  resolveFundingStatus,
  DEFAULT_FUNDING_STATUS,
  type FundingStatus,
  type FundingView,
} from "../../domain/funding";
import { buildIdempotencyKey } from "../../domain/payment";
import { getTripRepository } from "../persistence/trip-repository";
import { getFlightOptionRepository } from "../persistence/flight-option-repository";
import type { TripPatch } from "../persistence/trip-row";
import {
  capturePayment,
  isPaymentProviderConfigured,
  type CapturePaymentDeps,
} from "../payments/payment-service";

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

/** Injectable payment dependencies (a fake provider + in-memory repo in tests). */
export type FundingDeps = CapturePaymentDeps;

/** A fund request that should move money = a positive amount being set aside. */
function isFundRequest(status: FundingStatus, amount: number | null): boolean {
  return (status === "FUNDED" || status === "PROCESSING") && (amount ?? 0) > 0;
}

/**
 * Persist a funding update. The requested status is resolved against the real
 * estimated cost before it is stored, so FUNDED is only ever recorded when the
 * amount actually covers the trip. UNFUNDED clears the balance.
 *
 * When a payment provider is configured (or injected), a fund request is backed
 * by a REAL sandbox charge: funds are recorded only on a CONFIRMED (SUCCEEDED)
 * payment; a PENDING intent is stored as PROCESSING with the balance left
 * unsettled (so it cannot unlock a booking); a declined/failed charge records
 * nothing as funded. With no provider, the existing behavior is preserved.
 *
 * Returns the recomputed view, or null if the trip does not exist.
 */
export async function updateFunding(
  id: string,
  input: FundingUpdateInput,
  deps: FundingDeps = {},
): Promise<FundingView | null> {
  const repo = getTripRepository();
  const trip = await repo.getById(id);
  if (!trip) return null;

  const estimatedCost = await estimatedCostForTrip(trip);

  // UNFUNDED wipes the balance; every other state keeps/sets an amount, falling
  // back to the already-stored amount when the client omits it.
  const requestedAmount: number | null =
    input.status === "UNFUNDED" ? null : input.fundedAmount ?? trip.fundedAmount ?? 0;

  const usePayments = Boolean(deps.provider) || isPaymentProviderConfigured();

  // Payment-backed funding: only a CONFIRMED charge sets aside funds.
  if (usePayments && isFundRequest(input.status, requestedAmount)) {
    const amount = requestedAmount ?? 0;
    const result = await capturePayment(
      {
        tripId: id,
        kind: "FUNDING",
        amount,
        currency: trip.currency,
        idempotencyKey: buildIdempotencyKey(["funding", id, amount]),
        description: "Space Zero trip funding",
        fundedAmount: trip.fundedAmount ?? null,
      },
      deps,
    );

    // Only a confirmed charge records funds; anything else leaves the balance
    // untouched (never mark FUNDED without a confirmed provider result).
    if (result.status === "SUCCEEDED") {
      const status = resolveFundingStatus(input.status, amount, estimatedCost);
      const updated = await repo.update(id, { fundingStatus: status, fundedAmount: amount });
      return updated ? viewFor(updated, estimatedCost) : null;
    }

    // PENDING → allocation in flight, unsettled; declined/failed → not funded.
    const status: FundingStatus = result.status === "PENDING" ? "PROCESSING" : DEFAULT_FUNDING_STATUS;
    const updated = await repo.update(id, {
      fundingStatus: status,
      fundedAmount: trip.fundedAmount ?? null,
    });
    return updated ? viewFor(updated, estimatedCost) : null;
  }

  // Fallback/demo path (no provider) — record the set-aside, resolve vs cost.
  const status = resolveFundingStatus(input.status, requestedAmount, estimatedCost);
  const patch: TripPatch = { fundingStatus: status, fundedAmount: requestedAmount };
  const updated = await repo.update(id, patch);
  if (!updated) return null;

  return viewFor(updated, estimatedCost);
}
