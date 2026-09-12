/**
 * Space Zero — recovery persistence boundary (server-side only).
 *
 * Mirrors the disruption repository: a Supabase-backed store when configured, an
 * in-memory store for local dev and tests. Recoveries are an append-only audit of
 * every recovery outcome (a booked recovery or an escalation) for a trip.
 */

import type { Recovery } from "../../domain/recovery";
import { isSupabaseConfigured } from "./trip-repository";
import { getSupabaseAdmin } from "./supabase-client";
import { rowToRecovery, recoveryToInsertRow, type RecoveryRow } from "./recovery-row";

export interface RecoveryRepository {
  /** Append a recovery outcome. Returns the stored record. */
  add(recovery: Recovery): Promise<Recovery>;
  /** List a trip's recoveries, newest first. */
  listForTrip(tripId: string): Promise<Recovery[]>;
  /** The most recent recovery outcome for a trip, or null. */
  latestForTrip(tripId: string): Promise<Recovery | null>;
}

// --- In-memory --------------------------------------------------------------

export class InMemoryRecoveryRepository implements RecoveryRepository {
  private readonly byTrip = new Map<string, Recovery[]>();

  async add(recovery: Recovery): Promise<Recovery> {
    const record: Recovery = { ...recovery, createdAt: recovery.createdAt ?? new Date().toISOString() };
    const list = this.byTrip.get(recovery.tripId) ?? [];
    list.push(record);
    this.byTrip.set(recovery.tripId, list);
    return { ...record };
  }

  async listForTrip(tripId: string): Promise<Recovery[]> {
    return (this.byTrip.get(tripId) ?? [])
      .slice()
      .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))
      .map((r) => ({ ...r }));
  }

  async latestForTrip(tripId: string): Promise<Recovery | null> {
    const list = await this.listForTrip(tripId);
    return list[0] ?? null;
  }

  clear(): void {
    this.byTrip.clear();
  }
}

// --- Supabase ---------------------------------------------------------------

export class SupabaseRecoveryRepository implements RecoveryRepository {
  async add(recovery: Recovery): Promise<Recovery> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("recoveries")
      .insert(recoveryToInsertRow(recovery))
      .select("*")
      .single();
    if (error) throw new Error(`Failed to persist recovery: ${error.message}`);
    return rowToRecovery(data as RecoveryRow);
  }

  async listForTrip(tripId: string): Promise<Recovery[]> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("recoveries")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to load recoveries: ${error.message}`);
    return (data as RecoveryRow[]).map(rowToRecovery);
  }

  async latestForTrip(tripId: string): Promise<Recovery | null> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("recoveries")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to load recovery: ${error.message}`);
    return data ? rowToRecovery(data as RecoveryRow) : null;
  }
}

// --- Factory ----------------------------------------------------------------

let inMemorySingleton: RecoveryRepository | null = null;
let supabaseSingleton: RecoveryRepository | null = null;

export function getRecoveryRepository(): RecoveryRepository {
  if (isSupabaseConfigured()) {
    if (!supabaseSingleton) supabaseSingleton = new SupabaseRecoveryRepository();
    return supabaseSingleton;
  }
  if (!inMemorySingleton) inMemorySingleton = new InMemoryRecoveryRepository();
  return inMemorySingleton;
}
