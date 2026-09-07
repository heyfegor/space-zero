/**
 * Space Zero — Trip domain model (deterministic, server-side, no LLM).
 *
 * The trip lifecycle is a typed union — arbitrary string statuses are not
 * allowed anywhere in the application. Amounts are plain numbers in the trip's
 * single currency (default GBP for this stage); cross-currency is out of scope.
 */

/** The documented trip lifecycle. Source of truth for status across the app. */
export type TripStatus =
  | "DRAFT"
  | "PLANNING"
  | "AWAITING_AUTHORITY"
  | "READY"
  | "BOOKING"
  | "CONFIRMED"
  | "MONITORING"
  | "AT_RISK"
  | "RECOVERING"
  | "RESOLVED";

export const TRIP_STATUSES: readonly TripStatus[] = [
  "DRAFT",
  "PLANNING",
  "AWAITING_AUTHORITY",
  "READY",
  "BOOKING",
  "CONFIRMED",
  "MONITORING",
  "AT_RISK",
  "RECOVERING",
  "RESOLVED",
] as const;

// Funding is a SEPARATE concern from authority and the recovery allowance. Its
// state machine and math live in ./funding; re-exported here so existing trip
// imports keep working. See src/domain/funding.ts.
import type { FundingStatus } from "./funding";
export type { FundingStatus } from "./funding";
export { FUNDING_STATUSES, DEFAULT_FUNDING_STATUS } from "./funding";

/**
 * The status of a booking ATTEMPT, distinct from the trip lifecycle status.
 * It is only ever set from a real provider outcome (never the browser/LLM):
 *  - CONFIRMED — the provider (Duffel) confirmed a real order.
 *  - FAILED    — a booking was attempted at the provider but did not confirm.
 * Absent means no booking has been attempted.
 */
export type BookingStatus = "CONFIRMED" | "FAILED";

export const BOOKING_STATUSES: readonly BookingStatus[] = ["CONFIRMED", "FAILED"] as const;

/**
 * Structured trip intent — the free-text brief turned into editable fields.
 * This is the canonical shape shown/edited on TripPlan and persisted with the
 * trip. Money fields are whole-unit numbers in the trip's currency.
 */
export interface TripIntent {
  origin?: string;
  destination: string;
  arriveBy?: string;
  depart?: string;
  budget?: number;
  recoveryAllowance?: number;
  cabin?: string;
  baggage?: string;
  seat?: string;
}

/** A single leg of the journey. Kept minimal on purpose. */
export interface Segment {
  /** IATA code or place name of departure, e.g. "SIN". */
  from: string;
  /** IATA code or place name of arrival, e.g. "SYD". */
  to: string;
  /** ISO 8601 departure timestamp. */
  departAt: string;
  /** ISO 8601 arrival timestamp. */
  arriveAt: string;
}

/**
 * A trip. Minimal by design — only what the current autonomous loop needs.
 * Money fields are whole-unit numbers in `currency`.
 */
export interface Trip {
  id: string;
  origin: string;
  destination: string;
  segments: Segment[];
  /** ISO 8601 latest acceptable arrival. */
  arrivalDeadline: string;
  currency: string;
  /** Total authorized spend for the journey. */
  tripBudget: number;
  /** Additional spend the agent may authorize autonomously on disruption. */
  recoveryAllowance: number;
  checkedBags: number;
  /** Whether the agent may rebook automatically within authority. */
  autoRebook: boolean;
  status: TripStatus;
  /**
   * Present once a booking exists. A demo/recovery run stores a STAGED reference
   * (e.g. "SZ-4471"); a real Duffel booking stores the provider's booking
   * reference (PNR). Never presented as real unless a provider confirmed it.
   */
  bookingReference?: string;

  // --- Real booking fields (set only from a confirmed provider order) --------
  /** Duffel order id (e.g. "ord_..."), set only on a confirmed real booking. */
  duffelOrderId?: string | null;
  /** The authoritative amount the provider actually charged, in `currency`. */
  finalCost?: number | null;
  /** Outcome of the last booking attempt; see BookingStatus. */
  bookingStatus?: BookingStatus;

  // --- Persistence fields (optional; used by the Supabase-backed CRUD) -------
  // These carry the brief, structured intent and funding through the product
  // flow. They are optional so the deterministic domain/agent code and existing
  // fixtures that build a Trip without them stay valid.

  /** Owner of the trip (a real user later; a dev identity for now). */
  userId?: string;
  /** The original free-text brief the traveler entered. */
  brief?: string;
  /** Human label for the arrival requirement, e.g. "Before 10:00, Fri 12 Sep". */
  arriveBy?: string;
  /** Human label for departure, e.g. "Wed 10 Sep, flexible". */
  depart?: string;
  cabin?: string;
  baggage?: string;
  seat?: string;
  /** Funds allocated to this trip (whole units in `currency`); null until funded. */
  fundedAmount?: number | null;
  fundingStatus?: FundingStatus;
  /** The itinerary option the user selected on Options. */
  selectedOptionId?: string | null;
  /** ISO 8601 timestamps set by the persistence layer. */
  createdAt?: string;
  updatedAt?: string;
}
