/**
 * Space Zero — in-memory TripRepository.
 *
 * Used when Supabase is not configured (local dev) and by the persistence tests.
 * Data lives only in process memory and resets on restart. It mirrors the
 * Supabase repository's behaviour (immutable-ish reads, updated_at bumps) so the
 * two are interchangeable behind the TripRepository interface.
 */

import type { Trip } from "../../domain/trip";
import type { TripRepository } from "./trip-repository";
import type { TripPatch } from "./trip-row";

export class InMemoryTripRepository implements TripRepository {
  private readonly trips = new Map<string, Trip>();

  async create(trip: Trip): Promise<Trip> {
    const now = new Date().toISOString();
    const stored: Trip = { ...trip, createdAt: trip.createdAt ?? now, updatedAt: now };
    this.trips.set(stored.id, stored);
    return { ...stored };
  }

  async getById(id: string): Promise<Trip | null> {
    const trip = this.trips.get(id);
    return trip ? { ...trip } : null;
  }

  async update(id: string, patch: TripPatch): Promise<Trip | null> {
    const existing = this.trips.get(id);
    if (!existing) return null;

    const updated: Trip = { ...existing, updatedAt: new Date().toISOString() };
    if (patch.destination !== undefined) updated.destination = patch.destination;
    if (patch.arriveBy !== undefined) updated.arriveBy = patch.arriveBy;
    if (patch.depart !== undefined) updated.depart = patch.depart;
    if (patch.budget !== undefined) updated.tripBudget = patch.budget;
    if (patch.recoveryAllowance !== undefined) updated.recoveryAllowance = patch.recoveryAllowance;
    if (patch.cabin !== undefined) updated.cabin = patch.cabin;
    if (patch.baggage !== undefined) {
      updated.baggage = patch.baggage;
      const m = patch.baggage.match(/\d+/);
      updated.checkedBags = m ? parseInt(m[0], 10) : 0;
    }
    if (patch.seat !== undefined) updated.seat = patch.seat;
    if (patch.selectedOptionId !== undefined) updated.selectedOptionId = patch.selectedOptionId;
    if (patch.fundedAmount !== undefined) updated.fundedAmount = patch.fundedAmount;
    if (patch.fundingStatus !== undefined) updated.fundingStatus = patch.fundingStatus;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.bookingReference !== undefined) updated.bookingReference = patch.bookingReference ?? undefined;
    if (patch.duffelOrderId !== undefined) updated.duffelOrderId = patch.duffelOrderId;
    if (patch.finalCost !== undefined) updated.finalCost = patch.finalCost;
    if (patch.bookingStatus !== undefined) updated.bookingStatus = patch.bookingStatus ?? undefined;

    this.trips.set(id, updated);
    return { ...updated };
  }

  /** Test helper: clear all stored trips. */
  clear(): void {
    this.trips.clear();
  }
}
