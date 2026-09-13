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

/**
 * Trip ids are UUID primary keys. A non-UUID id (e.g. an in-memory staged/demo
 * id like "trip_demo_lhr_sin_syd") can never match a row, and querying a uuid
 * column with one makes Postgres raise "invalid input syntax for type uuid".
 * Treat such ids as a clean miss so callers fall back to the demo store (and a
 * malformed client id yields a 404, never a 500). This is not validation of real
 * ids — it only filters values the column type cannot possibly hold.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

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
    // A non-UUID id cannot be a persisted trip — miss cleanly (see isUuid).
    if (!isUuid(id)) return null;
    const db = getSupabaseAdmin();
    const { data, error } = await db.from("trips").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Failed to load trip: ${error.message}`);
    return data ? rowToTrip(data as TripRow) : null;
  }

  async update(id: string, patch: TripPatch): Promise<Trip | null> {
    if (!isUuid(id)) return null;
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
