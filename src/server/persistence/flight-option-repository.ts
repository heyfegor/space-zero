/**
 * Space Zero — flight-option persistence boundary (server-side only).
 *
 * Mirrors the trip repository pattern: a Supabase-backed store when configured,
 * an in-memory store for local dev and tests. A fresh search REPLACES a trip's
 * options (delete + insert) so stale offers never linger.
 */

import type { FlightOption } from "../../domain/flight-option";
import { isSupabaseConfigured } from "./trip-repository";
import { getSupabaseAdmin } from "./supabase-client";
import {
  rowToFlightOption,
  flightOptionToInsertRow,
  type FlightOptionRow,
} from "./flight-option-row";

export interface FlightOptionRepository {
  /** Replace all options for a trip with `options`. Returns the stored set. */
  replaceForTrip(tripId: string, options: FlightOption[]): Promise<FlightOption[]>;
  /** List a trip's options, ordered by rank ascending. */
  listForTrip(tripId: string): Promise<FlightOption[]>;
  /** Mark one option selected (and all others for the trip unselected). */
  setSelected(tripId: string, optionId: string): Promise<FlightOption | null>;
}

// --- In-memory --------------------------------------------------------------

export class InMemoryFlightOptionRepository implements FlightOptionRepository {
  private readonly byTrip = new Map<string, FlightOption[]>();

  async replaceForTrip(tripId: string, options: FlightOption[]): Promise<FlightOption[]> {
    const stored = options.map((o) => ({ ...o, createdAt: o.createdAt ?? new Date().toISOString() }));
    this.byTrip.set(tripId, stored);
    return stored.map((o) => ({ ...o }));
  }

  async listForTrip(tripId: string): Promise<FlightOption[]> {
    return (this.byTrip.get(tripId) ?? []).slice().sort((a, b) => a.rank - b.rank).map((o) => ({ ...o }));
  }

  async setSelected(tripId: string, optionId: string): Promise<FlightOption | null> {
    const list = this.byTrip.get(tripId);
    if (!list) return null;
    let hit: FlightOption | null = null;
    for (const o of list) {
      o.selected = o.id === optionId;
      if (o.selected) hit = o;
    }
    return hit ? { ...hit } : null;
  }

  clear(): void {
    this.byTrip.clear();
  }
}

// --- Supabase ---------------------------------------------------------------

export class SupabaseFlightOptionRepository implements FlightOptionRepository {
  async replaceForTrip(tripId: string, options: FlightOption[]): Promise<FlightOption[]> {
    const db = getSupabaseAdmin();
    const del = await db.from("flight_options").delete().eq("trip_id", tripId);
    if (del.error) throw new Error(`Failed to clear options: ${del.error.message}`);
    if (options.length === 0) return [];
    const rows = options.map(flightOptionToInsertRow);
    const { data, error } = await db.from("flight_options").insert(rows).select("*");
    if (error) throw new Error(`Failed to persist options: ${error.message}`);
    return (data as FlightOptionRow[]).map(rowToFlightOption).sort((a, b) => a.rank - b.rank);
  }

  async listForTrip(tripId: string): Promise<FlightOption[]> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("flight_options")
      .select("*")
      .eq("trip_id", tripId)
      .order("rank", { ascending: true });
    if (error) throw new Error(`Failed to load options: ${error.message}`);
    return (data as FlightOptionRow[]).map(rowToFlightOption);
  }

  async setSelected(tripId: string, optionId: string): Promise<FlightOption | null> {
    const db = getSupabaseAdmin();
    const clear = await db.from("flight_options").update({ selected: false }).eq("trip_id", tripId);
    if (clear.error) throw new Error(`Failed to update selection: ${clear.error.message}`);
    const { data, error } = await db
      .from("flight_options")
      .update({ selected: true })
      .eq("trip_id", tripId)
      .eq("id", optionId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Failed to select option: ${error.message}`);
    return data ? rowToFlightOption(data as FlightOptionRow) : null;
  }
}

// --- Factory ----------------------------------------------------------------

let inMemorySingleton: FlightOptionRepository | null = null;
let supabaseSingleton: FlightOptionRepository | null = null;

export function getFlightOptionRepository(): FlightOptionRepository {
  if (isSupabaseConfigured()) {
    if (!supabaseSingleton) supabaseSingleton = new SupabaseFlightOptionRepository();
    return supabaseSingleton;
  }
  if (!inMemorySingleton) inMemorySingleton = new InMemoryFlightOptionRepository();
  return inMemorySingleton;
}
