/**
 * Space Zero — Supabase row shape for `trips` and the mappers between a DB row
 * and the domain Trip. This is the ONLY place that knows the column layout.
 *
 * The domain layer never imports this file; persistence depends on the domain,
 * not the other way round. Money columns are Postgres `numeric` (exact decimal,
 * never float) and may arrive as number or string — the mapper coerces safely.
 */

import type { BookingStatus, FundingStatus, Trip, TripIntent, TripStatus } from "../../domain/trip";
import { BOOKING_STATUSES, TRIP_STATUSES } from "../../domain/trip";
import { asFundingStatus, DEFAULT_FUNDING_STATUS } from "../../domain/funding";

/** A row of the `trips` table exactly as stored/returned by Supabase. */
export interface TripRow {
  id: string;
  user_id: string;
  status: string;
  brief: string | null;
  origin: string | null;
  destination: string | null;
  arrive_by: string | null;
  depart: string | null;
  trip_budget: number | string | null;
  recovery_allowance: number | string | null;
  funded_amount: number | string | null;
  funding_status: string | null;
  cabin: string | null;
  baggage: string | null;
  seat: string | null;
  selected_option_id: string | null;
  currency: string | null;
  // Real booking outcome (set only from a confirmed/failed provider order).
  duffel_order_id: string | null;
  booking_reference: string | null;
  final_cost: number | string | null;
  booking_status: string | null;
  created_at: string;
  updated_at: string;
}

/** Columns written on insert (id/created_at/updated_at are DB-managed). */
export type TripInsertRow = Omit<TripRow, "created_at" | "updated_at">;

function toMoney(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toMoneyOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function asStatus(v: string): TripStatus {
  return (TRIP_STATUSES as readonly string[]).includes(v) ? (v as TripStatus) : "DRAFT";
}

function asBookingStatus(v: string | null): BookingStatus | undefined {
  if (!v) return undefined;
  return (BOOKING_STATUSES as readonly string[]).includes(v) ? (v as BookingStatus) : undefined;
}

/** Parse a checked-bag count out of a free-text baggage label ("1 checked bag"). */
function checkedBagsFrom(baggage: string | null): number {
  if (!baggage) return 0;
  const m = baggage.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * DB row → domain Trip. Fields the minimal schema does not store yet (segments,
 * arrivalDeadline, bookingReference) are given safe defaults — they belong to
 * later phases (Options/booking) and are not persisted at this stage.
 */
export function rowToTrip(row: TripRow): Trip {
  return {
    id: row.id,
    userId: row.user_id,
    status: asStatus(row.status),
    brief: row.brief ?? undefined,
    origin: row.origin ?? "",
    destination: row.destination ?? "",
    segments: [],
    arrivalDeadline: "",
    arriveBy: row.arrive_by ?? undefined,
    depart: row.depart ?? undefined,
    currency: row.currency ?? "GBP",
    tripBudget: toMoney(row.trip_budget),
    recoveryAllowance: toMoney(row.recovery_allowance),
    fundedAmount: toMoneyOrNull(row.funded_amount),
    fundingStatus: asFundingStatus(row.funding_status),
    cabin: row.cabin ?? undefined,
    baggage: row.baggage ?? undefined,
    seat: row.seat ?? undefined,
    selectedOptionId: row.selected_option_id,
    bookingReference: row.booking_reference ?? undefined,
    duffelOrderId: row.duffel_order_id,
    finalCost: toMoneyOrNull(row.final_cost),
    bookingStatus: asBookingStatus(row.booking_status),
    checkedBags: checkedBagsFrom(row.baggage),
    autoRebook: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Domain Trip → insert row (only the persisted columns). */
export function tripToInsertRow(trip: Trip): TripInsertRow {
  return {
    id: trip.id,
    user_id: trip.userId ?? "",
    status: trip.status,
    brief: trip.brief ?? null,
    origin: trip.origin || null,
    destination: trip.destination || null,
    arrive_by: trip.arriveBy ?? null,
    depart: trip.depart ?? null,
    trip_budget: trip.tripBudget,
    recovery_allowance: trip.recoveryAllowance,
    funded_amount: trip.fundedAmount ?? null,
    funding_status: trip.fundingStatus ?? DEFAULT_FUNDING_STATUS,
    cabin: trip.cabin ?? null,
    baggage: trip.baggage ?? null,
    seat: trip.seat ?? null,
    selected_option_id: trip.selectedOptionId ?? null,
    currency: trip.currency,
    duffel_order_id: trip.duffelOrderId ?? null,
    booking_reference: trip.bookingReference ?? null,
    final_cost: trip.finalCost ?? null,
    booking_status: trip.bookingStatus ?? null,
  };
}

/**
 * The persistable update fields for this phase (intent + selection + limits +
 * funding). The generic trip PATCH endpoint validates against tripPatchSchema,
 * which does NOT expose the funding fields — they are written only by the
 * funding service, which resolves the status against the estimated cost first.
 */
export interface TripPatch {
  origin?: string;
  destination?: string;
  arriveBy?: string;
  depart?: string;
  budget?: number;
  recoveryAllowance?: number;
  cabin?: string;
  baggage?: string;
  seat?: string;
  selectedOptionId?: string | null;
  /** Funding fields — separate from authority/recovery allowance. */
  fundedAmount?: number | null;
  fundingStatus?: FundingStatus;
  /**
   * Lifecycle + booking-outcome fields. Written ONLY by server-side services
   * that advance state through the validated state machine (the booking service)
   * — never exposed on the public trip PATCH schema, so a client cannot set them.
   */
  status?: TripStatus;
  bookingReference?: string | null;
  duffelOrderId?: string | null;
  finalCost?: number | null;
  bookingStatus?: BookingStatus | null;
}

/** A validated TripPatch → the DB column subset it touches. */
export function patchToRow(patch: TripPatch): Partial<TripRow> {
  const row: Partial<TripRow> = {};
  if (patch.origin !== undefined) row.origin = patch.origin;
  if (patch.destination !== undefined) row.destination = patch.destination;
  if (patch.arriveBy !== undefined) row.arrive_by = patch.arriveBy;
  if (patch.depart !== undefined) row.depart = patch.depart;
  if (patch.budget !== undefined) row.trip_budget = patch.budget;
  if (patch.recoveryAllowance !== undefined) row.recovery_allowance = patch.recoveryAllowance;
  if (patch.cabin !== undefined) row.cabin = patch.cabin;
  if (patch.baggage !== undefined) row.baggage = patch.baggage;
  if (patch.seat !== undefined) row.seat = patch.seat;
  if (patch.selectedOptionId !== undefined) row.selected_option_id = patch.selectedOptionId;
  if (patch.fundedAmount !== undefined) row.funded_amount = patch.fundedAmount;
  if (patch.fundingStatus !== undefined) row.funding_status = patch.fundingStatus;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.bookingReference !== undefined) row.booking_reference = patch.bookingReference;
  if (patch.duffelOrderId !== undefined) row.duffel_order_id = patch.duffelOrderId;
  if (patch.finalCost !== undefined) row.final_cost = patch.finalCost;
  if (patch.bookingStatus !== undefined) row.booking_status = patch.bookingStatus;
  return row;
}

/** Extract the display/edit intent from a domain Trip (for API responses). */
export function tripToIntent(trip: Trip): TripIntent {
  return {
    origin: trip.origin || undefined,
    destination: trip.destination,
    arriveBy: trip.arriveBy,
    depart: trip.depart,
    budget: trip.tripBudget,
    recoveryAllowance: trip.recoveryAllowance,
    cabin: trip.cabin,
    baggage: trip.baggage,
    seat: trip.seat,
  };
}
