/**
 * Space Zero — flight option domain model (deterministic, no provider/DB deps).
 *
 * A normalized, provider-agnostic itinerary option. Duffel (or any future
 * provider) is mapped INTO this shape; ranking and persistence operate on it.
 * Money is a whole/decimal number in `currency` (exact — never used in authority
 * math, which is unchanged).
 */

export interface FlightSegment {
  /** IATA code of the segment's origin, e.g. "LHR". */
  from: string;
  /** IATA code of the segment's destination, e.g. "SIN". */
  to: string;
  /** ISO 8601 departure timestamp. */
  departAt: string;
  /** ISO 8601 arrival timestamp. */
  arriveAt: string;
  /** Marketing carrier IATA code, if known. */
  carrier?: string;
  /** Marketing flight number, if known. */
  flightNumber?: string;
}

export interface FlightOption {
  /** Our stable id for this option row. */
  id: string;
  tripId: string;
  /** The provider's offer id (Duffel offer id). The bookable reference later. */
  providerOfferId: string;
  segments: FlightSegment[];
  /** Total price for the whole itinerary. */
  totalAmount: number;
  currency: string;
  /** Total travel time in minutes (first departure → last arrival). */
  durationMinutes: number;
  /** Number of connections (segments − 1). */
  connections: number;
  /** First segment departure (ISO 8601). */
  departAt: string;
  /** Last segment arrival (ISO 8601). */
  arriveAt: string;
  /** Deterministic rank; 0 is best. Set by the ranking step. */
  rank: number;
  /** True for the single best-ranked option (rank 0). */
  recommended: boolean;
  /** Whether the traveler selected this option. */
  selected: boolean;
  /** Provider offer expiry (ISO 8601), or null if unknown. */
  expiresAt: string | null;
  createdAt?: string;
}
