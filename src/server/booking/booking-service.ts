/**
 * Space Zero — real booking orchestration (server-side; the REAL money path).
 *
 * This is what execute_booking runs for a PERSISTED trip. It is the single place
 * that turns a selected offer into an actual Duffel order, and it trusts ONLY
 * authoritative data it loads from the store — never a cost, an approval, or an
 * offer id supplied by the browser or the model.
 *
 * Order of operations (fail closed at every step):
 *   1. Load the trip and its selected option from the repositories.
 *   2. Run the deterministic precondition gate (verifyBookingPreconditions):
 *      authorized-for-booking, an option selected, offer not expired, sufficient
 *      funding, and cost within budget. A failure stops here — nothing is booked.
 *   3. Re-confirm the offer is LIVE with Duffel and re-check the two money gates
 *      against the provider's current price (guards a silent re-price).
 *   4. Create the order at Duffel. Success is the ONLY thing that can report a
 *      confirmed booking; any provider failure is surfaced honestly and recorded
 *      as a FAILED attempt, with no state advance.
 *   5. Persist the order id, booking reference (PNR), final cost, and booking
 *      status, and advance the trip through the validated state machine.
 *
 * Dependencies are injectable so the whole flow is testable with in-memory repos
 * and a fake Duffel client — no key, no network.
 */

import { verifyBookingPreconditions, type BookingDenialReason } from "../../domain/booking";
import { isSufficient } from "../../domain/funding";
import { transition } from "../../domain/trip-state";
import type { Trip, TripStatus } from "../../domain/trip";
import type { FlightOption } from "../../domain/flight-option";
import {
  getDuffelBookingClient,
  isDuffelConfigured,
  type DuffelBookingClient,
  type DuffelOffer,
  type DuffelOrderPassenger,
} from "../../providers/duffel";
import { getTripRepository, type TripRepository } from "../persistence/trip-repository";
import {
  getFlightOptionRepository,
  type FlightOptionRepository,
} from "../persistence/flight-option-repository";
import type { TripPatch } from "../persistence/trip-row";

export type BookingOutcomeStatus =
  | "CONFIRMED" // Duffel confirmed a real order
  | "DENIED" // a precondition gate refused it (policy stop, nothing booked)
  | "PROVIDER_UNCONFIGURED" // no Duffel client/key — refuse rather than fabricate
  | "PROVIDER_FAILED" // Duffel was called but did not confirm
  | "TRIP_NOT_FOUND"; // no such persisted trip

export interface RealBookingResult {
  ok: boolean;
  mode: "REAL";
  status: BookingOutcomeStatus;
  /** Set when status is DENIED — which precondition failed. */
  denialReason?: BookingDenialReason;
  /** Set only on a CONFIRMED order. */
  duffelOrderId?: string;
  bookingReference?: string;
  finalCost?: number;
  currency: string;
  /** Human-readable, brand-voice explanation. Honest about success/failure. */
  reason: string;
}

export interface BookTripDeps {
  tripRepo?: TripRepository;
  optionRepo?: FlightOptionRepository;
  duffel?: DuffelBookingClient;
  now?: Date;
  /** Build order passengers from the live offer (placeholder identity by default). */
  buildPassengers?: (offer: DuffelOffer) => DuffelOrderPassenger[];
}

/** The option the traveler selected, resolved from the store (never the client). */
function selectedOptionFor(trip: Trip, options: FlightOption[]): FlightOption | null {
  return (
    options.find((o) => o.selected) ??
    (trip.selectedOptionId ? options.find((o) => o.id === trip.selectedOptionId) : undefined) ??
    null
  );
}

/**
 * Placeholder passengers for a test-mode Duffel order. There is no traveler PII
 * in scope yet (auth/WebAuthn is deliberately not built), so a clearly-dev
 * identity is used, keyed to the offer's passenger ids. Swap for real profile
 * data when identity lands.
 */
function defaultPassengers(offer: DuffelOffer): DuffelOrderPassenger[] {
  const passengers = offer.passengers ?? [];
  return passengers.map((p) => ({
    id: p.id,
    title: "mr",
    given_name: "Space",
    family_name: "Zero",
    born_on: "1990-01-01",
    gender: "m",
    email: "dev@spacezero.local",
    phone_number: "+442080160509",
  }));
}

/** Compute the CONFIRMED status by walking the validated state machine. */
function confirmedStatus(trip: Trip): TripStatus {
  if (trip.status === "READY") return transition(transition(trip, "BOOKING"), "CONFIRMED").status;
  return transition(trip, "CONFIRMED").status; // BOOKING → CONFIRMED
}

export async function bookTrip(tripId: string, deps: BookTripDeps = {}): Promise<RealBookingResult> {
  const tripRepo = deps.tripRepo ?? getTripRepository();
  const optionRepo = deps.optionRepo ?? getFlightOptionRepository();
  const now = deps.now ?? new Date();
  const buildPassengers = deps.buildPassengers ?? defaultPassengers;

  const trip = await tripRepo.getById(tripId);
  if (!trip) {
    return {
      ok: false,
      mode: "REAL",
      status: "TRIP_NOT_FOUND",
      currency: "GBP",
      reason: `No trip found for id ${tripId}.`,
    };
  }

  const options = await optionRepo.listForTrip(tripId);
  const selected = selectedOptionFor(trip, options);
  const cost = selected?.totalAmount ?? 0;

  // 2. Deterministic gate over authoritative store values (not the client/LLM).
  const precheck = verifyBookingPreconditions({
    tripStatus: trip.status,
    selectedOption: selected,
    fundedAmount: trip.fundedAmount ?? null,
    tripBudget: trip.tripBudget,
    cost,
    currency: trip.currency,
    now,
  });
  if (!precheck.ok) {
    return {
      ok: false,
      mode: "REAL",
      status: "DENIED",
      denialReason: precheck.reason ?? undefined,
      currency: trip.currency,
      reason: precheck.message,
    };
  }
  // Past this point `selected` is guaranteed non-null by the gate above.
  const option = selected!;

  // Refuse rather than fabricate when the provider is not available.
  if (!deps.duffel && !isDuffelConfigured()) {
    return {
      ok: false,
      mode: "REAL",
      status: "PROVIDER_UNCONFIGURED",
      currency: trip.currency,
      reason: "The travel provider is not configured, so no real booking can be made.",
    };
  }
  const duffel = deps.duffel ?? getDuffelBookingClient();

  // 3. Re-confirm the offer is live and re-check money gates against its price.
  let liveOffer: DuffelOffer | null;
  try {
    liveOffer = await duffel.getOffer(option.providerOfferId);
  } catch {
    return {
      ok: false,
      mode: "REAL",
      status: "PROVIDER_FAILED",
      currency: trip.currency,
      reason: "Could not reach the travel provider to confirm the fare. Nothing was booked.",
    };
  }

  const liveExpired =
    !liveOffer ||
    (liveOffer.expires_at ? new Date(liveOffer.expires_at).getTime() <= now.getTime() : false);
  if (liveExpired) {
    return {
      ok: false,
      mode: "REAL",
      status: "DENIED",
      denialReason: "OFFER_EXPIRED",
      currency: trip.currency,
      reason: "The selected fare is no longer available. Search again for a current offer.",
    };
  }

  const liveCost = Number(liveOffer!.total_amount);
  const liveCurrency = liveOffer!.total_currency || trip.currency;
  if (!isSufficient(trip.fundedAmount ?? null, liveCost)) {
    return {
      ok: false,
      mode: "REAL",
      status: "DENIED",
      denialReason: "INSUFFICIENT_FUNDING",
      currency: trip.currency,
      reason: `Funding is short at the current fare (${liveCurrency}${liveCost}). Nothing was booked.`,
    };
  }
  if (liveCost > trip.tripBudget) {
    return {
      ok: false,
      mode: "REAL",
      status: "DENIED",
      denialReason: "OVER_BUDGET",
      currency: trip.currency,
      reason: `The current fare (${liveCurrency}${liveCost}) exceeds the ${trip.currency}${trip.tripBudget} trip budget. Nothing was booked.`,
    };
  }

  // 4. Create the real order. Only a confirmed order reports success.
  let order;
  try {
    order = await duffel.createOrder({
      offerId: option.providerOfferId,
      amount: liveOffer!.total_amount,
      currency: liveCurrency,
      passengers: buildPassengers(liveOffer!),
    });
  } catch {
    // Record an honest FAILED attempt; do NOT advance the trip state.
    const failPatch: TripPatch = { bookingStatus: "FAILED" };
    await tripRepo.update(tripId, failPatch);
    return {
      ok: false,
      mode: "REAL",
      status: "PROVIDER_FAILED",
      currency: trip.currency,
      reason: "The travel provider did not confirm the booking. Nothing was charged; try again.",
    };
  }

  // 5. Persist the authoritative outcome and advance state through the machine.
  const finalCost = Number(order.total_amount);
  const patch: TripPatch = {
    status: confirmedStatus(trip),
    duffelOrderId: order.id,
    bookingReference: order.booking_reference,
    finalCost,
    bookingStatus: "CONFIRMED",
  };
  await tripRepo.update(tripId, patch);

  return {
    ok: true,
    mode: "REAL",
    status: "CONFIRMED",
    duffelOrderId: order.id,
    bookingReference: order.booking_reference,
    finalCost,
    currency: order.total_currency || trip.currency,
    reason: `Booked. Duffel confirmed order ${order.id} (reference ${order.booking_reference}) for ${order.total_currency || trip.currency}${finalCost}.`,
  };
}
