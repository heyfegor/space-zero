/**
 * Space Zero — Supabase-backed TripRepository (server-side only).
 *
 * All access goes through the service-role admin client and the explicit
 * row↔domain mappers in trip-row.ts. It ensures the dev user row exists before
 * writing a trip (until real auth exists), and never exposes credentials.
 */

import type { Trip } from "../../domain/trip";
import type { TripRepository } from "./trip-repository";
import { DEV_USER_EMAIL } from "./trip-repository";
import {
  rowToTrip,
  tripToInsertRow,
  patchToRow,
  type TripPatch,
  type TripRow,
} from "./trip-row";
import { getSupabaseAdmin } from "./supabase-client";

export class SupabaseTripRepository implements TripRepository {
  async create(trip: Trip): Promise<Trip> {
    const db = getSupabaseAdmin();
    await this.ensureUser(trip.userId);

    const insert = tripToInsertRow(trip);
    const { data, error } = await db.from("trips").insert(insert).select("*").single();
    if (error) throw new Error(`Failed to create trip: ${error.message}`);
    return rowToTrip(data as TripRow);
  }

  async getById(id: string): Promise<Trip | null> {
    const db = getSupabaseAdmin();
    const { data, error } = await db.from("trips").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Failed to load trip: ${error.message}`);
    return data ? rowToTrip(data as TripRow) : null;
  }

  async update(id: string, patch: TripPatch): Promise<Trip | null> {
    const db = getSupabaseAdmin();
    const row = patchToRow(patch);
    if (Object.keys(row).length === 0) return this.getById(id);

    const { data, error } = await db
      .from("trips")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Failed to update trip: ${error.message}`);
    return data ? rowToTrip(data as TripRow) : null;
  }

  /** Idempotently ensure the (dev) user row exists so the FK holds. */
  private async ensureUser(userId?: string): Promise<void> {
    if (!userId) return;
    const db = getSupabaseAdmin();
    await db
      .from("users")
      .upsert({ id: userId, email: DEV_USER_EMAIL }, { onConflict: "id", ignoreDuplicates: true });
  }
}
