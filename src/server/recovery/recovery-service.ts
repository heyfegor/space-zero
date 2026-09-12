/**
 * Space Zero — autonomous recovery orchestration (deterministic; server-side).
 *
 * When a booked trip is AT_RISK from a persisted disruption, this drives the
 * recovery loop end to end WITHOUT the model deciding anything that matters:
 *   1. Load the affected trip, its latest threatening disruption, and the booked
 *      itinerary (the authoritative arrival requirement + committed cost).
 *   2. Search alternative flights through Duffel (deterministic normalize + rank,
 *      hard-deadline enforced). Honest states when the provider is unavailable.
 *   3. Evaluate alternatives with the DETERMINISTIC recovery engine
 *      (src/domain/recovery.ts): arrival requirement, connection feasibility,
 *      recovery allowance, funding, budget, and the stored auto-recovery permission.
 *   4. If the best option is permitted, book it through the real provider and
 *      persist the recovery (advancing AT_RISK → RECOVERING → RESOLVED). If it
 *      exceeds authority/funding, or auto-recovery is off, or nothing is eligible,
 *      DO NOT book — persist an ESCALATION requiring the traveler's approval.
 *
 * The Strands agent may orchestrate these steps via tools, but the decision and
 * the booking are enforced here, in code — never by the LLM. Dependencies are
 * injectable so the whole flow is testable with a fake Duffel client + in-memory
 * repos (no key, no network).
 */

import {
  evaluateRecovery,
  type Recovery,
  type RecoveryContext,
  type RecoveryEvaluation,
} from "../../domain/recovery";
import { transition } from "../../domain/trip-state";
import type { Trip, TripStatus } from "../../domain/trip";
import type { FlightOption } from "../../domain/flight-option";
import type { Disruption } from "../../domain/disruption";
import {
  getDuffelBookingClient,
  getDuffelClient,
  isDuffelConfigured,
  type DuffelBookingClient,
  type DuffelClient,
  type DuffelOffer,
  type DuffelOrderPassenger,
} from "../../providers/duffel";
import { getTripRepository, type TripRepository } from "../persistence/trip-repository";
import {
  getFlightOptionRepository,
  type FlightOptionRepository,
} from "../persistence/flight-option-repository";
import {
  getDisruptionRepository,
  type DisruptionRepository,
} from "../persistence/disruption-repository";
import {
  getRecoveryRepository,
  type RecoveryRepository,
} from "../persistence/recovery-repository";
import type { PaymentRepository } from "../persistence/payment-repository";
import type { PaymentProvider } from "../../providers/airwallex";
import { buildIdempotencyKey } from "../../domain/payment";
import { capturePayment, isPaymentProviderConfigured } from "../payments/payment-service";
import { deriveSearchParams } from "../flights/search-params";
import { normalizeOffers } from "../flights/normalize";
import { rankOptions } from "../flights/rank";

export type RecoveryStatusCode =
  | "recovered" // rebooked within authority; a real order was confirmed
  | "escalated" // stopped and recorded — the traveler must approve
  | "provider_unconfigured" // no Duffel key — honest, nothing invented
  | "provider_error" // the provider failed — nothing booked, nothing invented
  | "not_at_risk" // the trip is not in a recoverable (AT_RISK/RECOVERING) state
  | "no_booking" // no booked itinerary to recover
  | "trip_not_found";

export interface RecoveryOutcome {
  status: RecoveryStatusCode;
  tripId: string;
  tripStatus: TripStatus | null;
  evaluation?: RecoveryEvaluation;
  recovery?: Recovery;
  reason: string;
}

export interface RecoveryDeps {
  tripRepo?: TripRepository;
  optionRepo?: FlightOptionRepository;
  disruptionRepo?: DisruptionRepository;
  recoveryRepo?: RecoveryRepository;
  /** Search provider (offer requests). Injected in tests. */
  duffel?: DuffelClient;
  /** Booking provider (offer confirm + order). Injected in tests. */
  booking?: DuffelBookingClient;
  /** Payment provider (authorized recovery charge). Injected in tests. */
  paymentProvider?: PaymentProvider;
  /** Payment audit store. Injected in tests. */
  paymentRepo?: PaymentRepository;
  now?: Date;
  makeId?: () => string;
  /** Pre-fetched candidates (skips the search); used by the multi-tool path. */
  candidates?: FlightOption[];
  buildPassengers?: (offer: DuffelOffer) => DuffelOrderPassenger[];
  minConnectionMinutes?: number;
}

// Recovery candidates found by the last search, per trip. Lets the agent's
// separate search/evaluate tools share what search found without persisting
// them over the booked itinerary. Process-local; the deterministic runRecovery
// path passes candidates directly and does not depend on this.
const lastRecoverySearch = new Map<string, { candidates: FlightOption[]; at: number }>();
export function getLastRecoveryCandidates(tripId: string): FlightOption[] | undefined {
  return lastRecoverySearch.get(tripId)?.candidates;
}

/** A trip may be recovered only from a disruption-flagged state. */
function isRecoverable(trip: Trip): boolean {
  return trip.status === "AT_RISK" || trip.status === "RECOVERING";
}

/** The booked itinerary is the selected option (never client/LLM supplied). */
function bookedItinerary(trip: Trip, options: FlightOption[]): FlightOption | null {
  return (
    options.find((o) => o.selected) ??
    (trip.selectedOptionId ? options.find((o) => o.id === trip.selectedOptionId) : undefined) ??
    options.find((o) => o.recommended) ??
    options[0] ??
    null
  );
}

function validDeadline(v: string): string | null {
  return v && Number.isFinite(Date.parse(v)) ? v : null;
}

function arrivalLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(new Date(t));
  } catch {
    return null;
  }
}

export interface RecoveryContextResult {
  trip: Trip;
  disruption: Disruption | null;
  booked: FlightOption | null;
  arrivalRequirement: string | null;
  originalCost: number;
  previousArrivalLabel: string | null;
}

/** Tool #1 — load the affected trip, its disruption, and the booked itinerary. */
export async function getRecoveryContext(
  tripId: string,
  deps: RecoveryDeps = {},
): Promise<RecoveryContextResult | null> {
  const tripRepo = deps.tripRepo ?? getTripRepository();
  const optionRepo = deps.optionRepo ?? getFlightOptionRepository();
  const disruptionRepo = deps.disruptionRepo ?? getDisruptionRepository();

  const trip = await tripRepo.getById(tripId);
  if (!trip) return null;

  const options = await optionRepo.listForTrip(tripId);
  const booked = bookedItinerary(trip, options);
  const disruptions = await disruptionRepo.listForTrip(tripId);
  const disruption = disruptions.find((d) => d.threatensTrip) ?? disruptions[0] ?? null;

  const arrivalRequirement = validDeadline(trip.arrivalDeadline) ?? booked?.arriveAt ?? null;
  const originalCost = trip.finalCost ?? booked?.totalAmount ?? 0;

  return {
    trip,
    disruption,
    booked,
    arrivalRequirement,
    originalCost,
    previousArrivalLabel: arrivalLabel(booked?.arriveAt),
  };
}

export interface RecoverySearchResult {
  status: "ok" | "no_results" | "provider_unconfigured" | "provider_error" | "origin_unknown" | "destination_unknown";
  candidates: FlightOption[];
}

/**
 * Tool #2 — search alternative flights through Duffel. Deterministic normalize +
 * rank, enforcing the arrival requirement as the hard deadline. Does NOT overwrite
 * the trip's booked itinerary; candidates are cached for the evaluate/execute
 * steps. Honest states when the provider is unavailable — never fabricated.
 */
export async function searchRecoveryAlternatives(
  tripId: string,
  deps: RecoveryDeps = {},
): Promise<RecoverySearchResult> {
  const ctx = await getRecoveryContext(tripId, deps);
  if (!ctx) return { status: "provider_error", candidates: [] };

  if (!deps.duffel && !isDuffelConfigured()) {
    return { status: "provider_unconfigured", candidates: [] };
  }
  const duffel = deps.duffel ?? getDuffelClient();

  const derived = deriveSearchParams(ctx.trip);
  if (!derived.ok) return { status: derived.reason, candidates: [] };

  const makeId = deps.makeId ?? (() => crypto.randomUUID());
  let offers;
  try {
    offers = await duffel.searchOffers(derived.params);
  } catch {
    return { status: "provider_error", candidates: [] };
  }

  const normalized = normalizeOffers(offers, tripId, makeId);
  const { ranked } = rankOptions(normalized, { deadline: ctx.arrivalRequirement });
  lastRecoverySearch.set(tripId, { candidates: ranked, at: Date.now() });
  return { status: ranked.length === 0 ? "no_results" : "ok", candidates: ranked };
}

/** Tool #3 + #4 — deterministically evaluate alternatives + check authority/funding. */
export async function evaluateRecoveryOptions(
  tripId: string,
  deps: RecoveryDeps = {},
): Promise<{ context: RecoveryContextResult; evaluation: RecoveryEvaluation } | null> {
  const ctx = await getRecoveryContext(tripId, deps);
  if (!ctx) return null;
  const candidates = deps.candidates ?? getLastRecoveryCandidates(tripId) ?? [];
  const evaluation = evaluateRecovery(candidates, recoveryContextFrom(ctx, deps));
  return { context: ctx, evaluation };
}

function recoveryContextFrom(ctx: RecoveryContextResult, deps: RecoveryDeps): RecoveryContext {
  return {
    arrivalRequirement: ctx.arrivalRequirement,
    originalCost: ctx.originalCost,
    recoveryAllowance: ctx.trip.recoveryAllowance,
    fundedAmount: ctx.trip.fundedAmount ?? null,
    tripBudget: ctx.trip.tripBudget,
    currency: ctx.trip.currency,
    autoRecovery: ctx.trip.autoRebook,
    minConnectionMinutes: deps.minConnectionMinutes,
  };
}

/** Clearly-dev placeholder passengers (no traveler PII in scope; see booking-service). */
function defaultPassengers(offer: DuffelOffer): DuffelOrderPassenger[] {
  return (offer.passengers ?? []).map((p) => ({
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

/** Advance AT_RISK/RECOVERING → RESOLVED via the validated state machine. */
function resolveState(trip: Trip): TripStatus {
  if (trip.status === "AT_RISK") return transition(transition(trip, "RECOVERING"), "RESOLVED").status;
  return transition(trip, "RESOLVED").status; // RECOVERING → RESOLVED
}

/**
 * Tool #5 core — the recovery booking CHOKE POINT. Re-derives context and
 * re-runs the deterministic evaluation itself (never trusting a prior tool
 * result), then books the best permitted option through the real provider or
 * records an escalation. This is what execute_booking runs for an AT_RISK trip.
 */
export async function runRecovery(tripId: string, deps: RecoveryDeps = {}): Promise<RecoveryOutcome> {
  const tripRepo = deps.tripRepo ?? getTripRepository();
  const recoveryRepo = deps.recoveryRepo ?? getRecoveryRepository();
  const now = deps.now ?? new Date();
  const makeId = deps.makeId ?? (() => crypto.randomUUID());

  const ctx = await getRecoveryContext(tripId, deps);
  if (!ctx) {
    return { status: "trip_not_found", tripId, tripStatus: null, reason: `No trip found for id ${tripId}.` };
  }
  const { trip } = ctx;
  if (!isRecoverable(trip)) {
    return {
      status: "not_at_risk",
      tripId,
      tripStatus: trip.status,
      reason: `Trip ${tripId} is ${trip.status}; recovery only runs for an at-risk trip.`,
    };
  }
  if (!ctx.booked) {
    return { status: "no_booking", tripId, tripStatus: trip.status, reason: "No booked itinerary to recover." };
  }

  // Obtain candidates: caller-supplied, cached from a prior search, or search now.
  let candidates = deps.candidates ?? getLastRecoveryCandidates(tripId);
  if (!candidates) {
    const search = await searchRecoveryAlternatives(tripId, deps);
    if (search.status === "provider_unconfigured") {
      return {
        status: "provider_unconfigured",
        tripId,
        tripStatus: trip.status,
        reason: "The travel provider is not configured, so no alternatives can be searched. Nothing was booked.",
      };
    }
    if (search.status === "provider_error" || search.status === "origin_unknown" || search.status === "destination_unknown") {
      return {
        status: "provider_error",
        tripId,
        tripStatus: trip.status,
        reason: "Could not reach the travel provider to find alternatives. Nothing was booked.",
      };
    }
    candidates = search.candidates;
  }

  const evaluation = evaluateRecovery(candidates, recoveryContextFrom(ctx, deps));
  const { decision } = evaluation;

  const baseRecovery = (): Omit<Recovery, "id" | "status" | "reason"> => ({
    tripId,
    disruptionId: ctx.disruption?.id ?? null,
    from: decision.option?.from ?? ctx.booked!.segments[0]?.from ?? trip.origin,
    to: decision.option?.to ?? trip.destination,
    currency: trip.currency,
    additionalCost: decision.option?.additionalCost ?? 0,
    totalAmount: decision.option?.totalAmount ?? 0,
    newArrival: decision.option?.arriveAt ?? null,
    newArrivalLabel: decision.option?.newArrivalLabel ?? null,
    previousArrivalLabel: ctx.previousArrivalLabel,
    bookingReference: null,
    duffelOrderId: null,
    finalCost: null,
    escalationReason: null,
    overBy: null,
  });

  // ESCALATE / NO_OPTION — do not book; record the escalation for the traveler.
  if (decision.kind !== "AUTO_BOOK" || !decision.option) {
    const recovery = await recoveryRepo.add({
      ...baseRecovery(),
      id: makeId(),
      status: "ESCALATED",
      escalationReason: decision.escalationReason ?? "NO_ELIGIBLE_OPTION",
      overBy: decision.overBy ?? null,
      reason: decision.reason,
    });
    return { status: "escalated", tripId, tripStatus: trip.status, evaluation, recovery, reason: decision.reason };
  }

  // AUTO_BOOK — book the permitted option through the real provider.
  if (!deps.booking && !isDuffelConfigured()) {
    return {
      status: "provider_unconfigured",
      tripId,
      tripStatus: trip.status,
      evaluation,
      reason: "The travel provider is not configured, so the recovery cannot be booked. Nothing was booked.",
    };
  }
  const booking = deps.booking ?? getDuffelBookingClient();
  const chosen = decision.option;

  // Re-confirm the offer is live and re-check money gates against its price.
  let liveOffer: DuffelOffer | null;
  try {
    liveOffer = await booking.getOffer(chosen.providerOfferId);
  } catch {
    return {
      status: "provider_error",
      tripId,
      tripStatus: trip.status,
      evaluation,
      reason: "Could not reach the travel provider to confirm the fare. Nothing was booked.",
    };
  }

  const liveExpired =
    !liveOffer || (liveOffer.expires_at ? new Date(liveOffer.expires_at).getTime() <= now.getTime() : false);
  const liveCost = liveOffer ? Number(liveOffer.total_amount) : chosen.totalAmount;
  const liveAdditional = Math.max(0, liveCost - ctx.originalCost);
  const stillWithinAuthority = liveAdditional <= trip.recoveryAllowance;
  const stillFunded = (trip.fundedAmount ?? 0) > 0 && (trip.fundedAmount ?? 0) >= liveCost;
  const stillWithinBudget = liveCost <= trip.tripBudget;

  // A silent re-price that breaks any gate → escalate rather than overspend.
  if (liveExpired || !stillWithinAuthority || !stillFunded || !stillWithinBudget) {
    const escalationReason = liveExpired
      ? "NO_ELIGIBLE_OPTION"
      : !stillWithinBudget
        ? "OVER_BUDGET"
        : !stillFunded
          ? "INSUFFICIENT_FUNDING"
          : "OVER_ALLOWANCE";
    const reason = liveExpired
      ? "The best alternative is no longer available at the quoted fare. Your decision is needed."
      : "The alternative re-priced beyond your authority before booking. I stopped and did not book.";
    const recovery = await recoveryRepo.add({
      ...baseRecovery(),
      id: makeId(),
      status: "ESCALATED",
      escalationReason,
      overBy: null,
      reason,
    });
    return { status: "escalated", tripId, tripStatus: trip.status, evaluation, recovery, reason };
  }

  // Authorized recovery PAYMENT — charge the extra spend BEFORE booking, but only
  // when a provider is available and there is an extra amount to charge. The
  // deterministic authority/funding gate has already passed above; the payment
  // service re-checks it and never charges twice for the same recovery. Only a
  // CONFIRMED (SUCCEEDED) charge lets the recovery proceed to book and resolve —
  // a declined/failed/pending payment stops here and books nothing. With no
  // provider configured the existing behavior (book directly) is preserved.
  const usePayments = Boolean(deps.paymentProvider) || isPaymentProviderConfigured();
  if (usePayments && liveAdditional > 0) {
    const payment = await capturePayment(
      {
        tripId,
        kind: "RECOVERY",
        amount: liveAdditional,
        currency: trip.currency,
        idempotencyKey: buildIdempotencyKey([
          "recovery",
          tripId,
          ctx.disruption?.id,
          Math.round(liveAdditional),
        ]),
        description: "Space Zero recovery rebooking",
        fundedAmount: trip.fundedAmount ?? null,
        additionalCost: liveAdditional,
        recoveryAllowance: trip.recoveryAllowance,
      },
      { provider: deps.paymentProvider, paymentRepo: deps.paymentRepo, makeId: deps.makeId },
    );

    if (payment.status !== "SUCCEEDED") {
      // Honest stop — nothing booked, no state change, no fabricated success.
      const reason =
        payment.status === "DECLINED"
          ? "The recovery payment was declined. Nothing was booked; your decision is needed."
          : payment.status === "PENDING"
            ? "The recovery payment is pending confirmation. Nothing was booked yet; your decision is needed."
            : "The recovery payment did not go through. Nothing was booked; your decision is needed.";
      return { status: "provider_error", tripId, tripStatus: trip.status, evaluation, reason };
    }
  }

  let order;
  try {
    order = await booking.createOrder({
      offerId: chosen.providerOfferId,
      amount: liveOffer!.total_amount,
      currency: liveOffer!.total_currency || trip.currency,
      passengers: (deps.buildPassengers ?? defaultPassengers)(liveOffer!),
    });
  } catch {
    // Honest failure — nothing confirmed, no state change, no fabricated success.
    await tripRepo.update(tripId, { bookingStatus: "FAILED" });
    return {
      status: "provider_error",
      tripId,
      tripStatus: trip.status,
      evaluation,
      reason: "The travel provider did not confirm the recovery booking. Nothing was charged; your decision is needed.",
    };
  }

  // Persist the confirmed recovery and advance the trip to RESOLVED.
  const finalCost = Number(order.total_amount);
  const nextStatus = resolveState(trip);
  await tripRepo.update(tripId, {
    status: nextStatus,
    duffelOrderId: order.id,
    bookingReference: order.booking_reference,
    finalCost,
    bookingStatus: "CONFIRMED",
  });

  const recovery = await recoveryRepo.add({
    ...baseRecovery(),
    id: makeId(),
    status: "RECOVERED",
    totalAmount: finalCost,
    additionalCost: Math.max(0, finalCost - ctx.originalCost),
    bookingReference: order.booking_reference,
    duffelOrderId: order.id,
    finalCost,
    reason: `Rebooked. Confirmed order ${order.id} (${order.booking_reference}) arriving ${chosen.newArrivalLabel} for ${trip.currency}${Math.max(0, finalCost - ctx.originalCost)} more, within your ${trip.currency}${trip.recoveryAllowance} recovery allowance.`,
  });

  return {
    status: "recovered",
    tripId,
    tripStatus: nextStatus,
    evaluation,
    recovery,
    reason: recovery.reason,
  };
}
