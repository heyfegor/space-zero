/**
 * Space Zero — booking execution core (deterministic, server-side, NO LLM).
 *
 * This is the single money/action CHOKE POINT. Every (staged) booking or
 * rebooking runs through executeStagedBooking, which calls the authority engine
 * ITSELF and refuses when denied. It never trusts that a prior check_authority
 * call happened — enforcement is independent and unavoidable. That is the key
 * architectural invariant proved by the tests.
 *
 * Execution is STAGED for the recovery/demo path: a simulated confirmation,
 * never presented as a real transaction. The REAL path (see
 * src/server/booking/booking-service.ts) creates an actual Duffel order and is
 * gated by the deterministic preconditions defined below.
 */

import { evaluateAuthority, type AuthorityResult } from "./authority";
import { isSufficient } from "./funding";
import type { FlightOption } from "./flight-option";
import type { TripStatus } from "./trip";

/** Whether an execution actually moved money (REAL) or only simulated (STAGED). */
export type ExecutionMode = "STAGED" | "REAL";

export interface BookingRequest {
  tripId: string;
  /** The amount the agent proposes to spend (e.g. a recovery's extra cost). */
  amount: number;
  /**
   * The authoritative recovery allowance. Callers MUST pass the trip's stored
   * allowance (not an agent-supplied value) so the amount is the only thing the
   * model influences — never the limit it is checked against.
   */
  recoveryAllowance: number;
  currency?: string;
  /** Short description of what is being booked, for the result/audit line. */
  description?: string;
}

export interface BookingResult {
  ok: boolean;
  /** Always "STAGED" at this stage. Never describe a STAGED result as real. */
  mode: ExecutionMode;
  /** The authority decision this execution enforced. */
  authority: AuthorityResult;
  bookingReference?: string;
  amountCharged?: number;
  currency: string;
  reason: string;
}

/**
 * Deterministic confirmation reference, e.g. "SZ-4471". Same inputs → same ref,
 * so demo runs are reproducible. This is a development fixture, not a real PNR.
 */
export function stagedBookingReference(tripId: string, amount: number): string {
  const seed = `${tripId}:${amount}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const digits = (hash % 9000) + 1000; // always 4 digits, 1000–9999
  return `SZ-${digits}`;
}

/**
 * Execute a booking in STAGED mode, enforcing authority independently.
 *
 * - Runs evaluateAuthority(amount, recoveryAllowance) itself.
 * - Refuses (ok: false) and moves no money if denied.
 * - Simulates a confirmation with a deterministic reference if permitted.
 */
export function executeStagedBooking(req: BookingRequest): BookingResult {
  const currency = req.currency ?? "GBP";
  const authority = evaluateAuthority(req.amount, req.recoveryAllowance, currency);

  if (!authority.permitted) {
    return {
      ok: false,
      mode: "STAGED",
      authority,
      currency,
      reason: `Execution refused by the authority engine. ${authority.reason}`,
    };
  }

  const bookingReference = stagedBookingReference(req.tripId, req.amount);
  return {
    ok: true,
    mode: "STAGED",
    authority,
    bookingReference,
    amountCharged: req.amount,
    currency,
    reason:
      `STAGED booking executed within authority` +
      (req.description ? ` (${req.description})` : "") +
      `. Reference ${bookingReference}. This is a simulated confirmation, not a real transaction.`,
  };
}

// ---------------------------------------------------------------------------
// Real-booking preconditions (deterministic, pure — the REAL choke point gate)
// ---------------------------------------------------------------------------

/**
 * Why a real booking was refused BEFORE any provider call. Each maps to one of
 * the required server-side checks. Ordered by how they are evaluated.
 */
export type BookingDenialReason =
  | "TRIP_NOT_AUTHORIZED" // trip is not in a state that permits booking
  | "NO_OPTION_SELECTED" // no flight option has been chosen
  | "OFFER_EXPIRED" // the selected provider offer is no longer valid
  | "INSUFFICIENT_FUNDING" // funds set aside do not cover the cost
  | "OVER_BUDGET"; // cost exceeds the trip budget

/** Trip lifecycle statuses from which a first real booking may proceed. */
export const BOOKABLE_STATUSES: readonly TripStatus[] = ["READY", "BOOKING"] as const;

export interface BookingPrecheckInput {
  /** The AUTHORITATIVE trip status (loaded from the store, not the browser/LLM). */
  tripStatus: TripStatus;
  /** The option the traveler selected, loaded from the store (null if none). */
  selectedOption: FlightOption | null;
  /** Funds set aside for the trip, in the trip currency (from the store). */
  fundedAmount: number | null | undefined;
  /** The trip's total authorized budget, in the trip currency (from the store). */
  tripBudget: number;
  /** The cost to check — the selected option's stored total (never LLM-supplied). */
  cost: number;
  /** Currency for messages. */
  currency: string;
  /** The moment the check runs, for offer-expiry comparison. */
  now: Date;
}

export interface BookingPrecheck {
  /** True only when EVERY precondition holds. */
  ok: boolean;
  /** The cost the checks were run against (echoed for the caller/audit). */
  cost: number;
  currency: string;
  reason: BookingDenialReason | null;
  /** Human-readable, brand-voice explanation. */
  message: string;
}

/**
 * The single deterministic gate for a REAL booking. It trusts ONLY the
 * authoritative values the caller has loaded from the store — never anything the
 * browser or the model supplied. Fails closed: the first failing check wins, and
 * any nonsensical input denies rather than proceeding.
 *
 * This does not talk to a provider; the live-offer confirmation and the order
 * itself happen in the booking service, which calls this first and refuses on a
 * non-ok result.
 */
export function verifyBookingPreconditions(input: BookingPrecheckInput): BookingPrecheck {
  const { currency, cost } = input;
  const deny = (reason: BookingDenialReason, message: string): BookingPrecheck => ({
    ok: false,
    cost,
    currency,
    reason,
    message,
  });

  // 1. The trip must be authorized for booking (its state, not a client claim).
  if (!BOOKABLE_STATUSES.includes(input.tripStatus)) {
    return deny(
      "TRIP_NOT_AUTHORIZED",
      `This trip is ${input.tripStatus}. Booking is only allowed once the trip is authorized (READY).`,
    );
  }

  // 2. A flight option must be selected.
  if (!input.selectedOption) {
    return deny("NO_OPTION_SELECTED", "No flight option is selected for this trip.");
  }

  // 3. The selected offer must still be valid (not expired).
  const expiresAt = input.selectedOption.expiresAt;
  if (expiresAt) {
    const expiry = new Date(expiresAt).getTime();
    if (!Number.isNaN(expiry) && expiry <= input.now.getTime()) {
      return deny(
        "OFFER_EXPIRED",
        "The selected fare has expired. Search again for a current offer before booking.",
      );
    }
  }

  // Guard nonsensical cost (fail closed).
  if (!Number.isFinite(cost) || cost < 0) {
    return deny("OVER_BUDGET", `Refusing to book: the cost ${cost} is not a valid amount.`);
  }

  // 4. Funds set aside must cover the cost (funding math is the single source).
  if (!isSufficient(input.fundedAmount, cost)) {
    return deny(
      "INSUFFICIENT_FUNDING",
      `Funding is short. ${currency}${input.fundedAmount ?? 0} is set aside but this booking costs ${currency}${cost}.`,
    );
  }

  // 5. The total cost must be within the trip budget.
  if (cost > input.tripBudget) {
    return deny(
      "OVER_BUDGET",
      `Over budget. ${currency}${cost} exceeds the ${currency}${input.tripBudget} trip budget.`,
    );
  }

  return {
    ok: true,
    cost,
    currency,
    reason: null,
    message: `Within budget and funded. ${currency}${cost} is authorized to book.`,
  };
}
