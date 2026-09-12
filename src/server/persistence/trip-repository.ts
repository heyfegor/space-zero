/**
 * Space Zero — trip persistence boundary (server-side only).
 *
 * A small repository interface with two implementations:
 *   - SupabaseTripRepository: the real Postgres-backed store (used when the
 *     Supabase env vars are present).
 *   - InMemoryTripRepository: a process-memory store used for local dev without
 *     Supabase and for the persistence tests. It does NOT touch the network.
 *
 * This is a DIFFERENT concern from src/server/tools/dev-store.ts, which holds
 * the deterministic staged-recovery fixtures the agent demo uses. That file is
 * untouched; this boundary is only for the new user-facing trip CRUD.
 */

import type { Trip } from "../../domain/trip";
import type { TripPatch } from "./trip-row";
import { InMemoryTripRepository } from "./in-memory-trip-repository";
import { SupabaseTripRepository } from "./supabase-trip-repository";

export interface TripRepository {
  /** Persist a new trip. Returns the stored trip. */
  create(trip: Trip): Promise<Trip>;
  /** Fetch a trip by id, or null if it does not exist. */
  getById(id: string): Promise<Trip | null>;
  /** Apply a validated patch. Returns the updated trip, or null if not found. */
  update(id: string, patch: TripPatch): Promise<Trip | null>;
}

/**
 * Temporary development identity. This is NOT authentication — every dev trip is
 * owned by this fixed user id until WebAuthn lands. It is a stable UUID so RLS
 * policies (auth.uid() = user_id) can be layered on later without reshaping data.
 */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
export const DEV_USER_EMAIL = "dev@spacezero.local";

/** True when server-side Supabase credentials are configured. */
export function isSupabaseConfigured(): boolean {
  // Accept the new-style secret key (SUPABASE_SECRET_KEY) or the legacy
  // service-role key name; either selects the Supabase-backed repositories.
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(process.env.SUPABASE_URL && secretKey);
}

let inMemorySingleton: TripRepository | null = null;
let supabaseSingleton: TripRepository | null = null;

/**
 * Return the active repository. Supabase when configured, otherwise the
 * in-memory store. The Supabase module is imported lazily so a dev environment
 * without credentials never constructs a client.
 */
export function getTripRepository(): TripRepository {
  if (isSupabaseConfigured()) {
    // The Supabase client is created inside the constructor, so it is only
    // instantiated here — when credentials are actually present.
    if (!supabaseSingleton) supabaseSingleton = new SupabaseTripRepository();
    return supabaseSingleton;
  }
  if (!inMemorySingleton) inMemorySingleton = new InMemoryTripRepository();
  return inMemorySingleton;
}
