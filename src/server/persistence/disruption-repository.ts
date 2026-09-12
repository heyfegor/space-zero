/**
 * Space Zero — disruption persistence boundary (server-side only).
 *
 * Mirrors the flight-option repository pattern: a Supabase-backed store when
 * configured, an in-memory store for local dev and tests. Disruptions are an
 * append-only audit of what monitoring detected — `add` inserts new records and
 * `listForTrip` returns them newest-first.
 */

import type { Disruption } from "../../domain/disruption";
import { isSupabaseConfigured } from "./trip-repository";
import { getSupabaseAdmin } from "./supabase-client";
import {
  rowToDisruption,
  disruptionToInsertRow,
  type DisruptionRow,
} from "./disruption-row";

export interface DisruptionRepository {
  /** Append detected disruptions. Returns the stored records. */
  add(disruptions: Disruption[]): Promise<Disruption[]>;
  /** List a trip's disruptions, newest detection first. */
  listForTrip(tripId: string): Promise<Disruption[]>;
}

// --- In-memory --------------------------------------------------------------

export class InMemoryDisruptionRepository implements DisruptionRepository {
  private readonly byTrip = new Map<string, Disruption[]>();

  async add(disruptions: Disruption[]): Promise<Disruption[]> {
    const now = new Date().toISOString();
    const stored: Disruption[] = [];
    for (const d of disruptions) {
      const record: Disruption = { ...d, createdAt: d.createdAt ?? now };
      const list = this.byTrip.get(d.tripId) ?? [];
      list.push(record);
      this.byTrip.set(d.tripId, list);
      stored.push({ ...record });
    }
    return stored;
  }

  async listForTrip(tripId: string): Promise<Disruption[]> {
    return (this.byTrip.get(tripId) ?? [])
      .slice()
      .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
      .map((d) => ({ ...d }));
  }

  clear(): void {
    this.byTrip.clear();
  }
}

// --- Supabase ---------------------------------------------------------------

export class SupabaseDisruptionRepository implements DisruptionRepository {
  async add(disruptions: Disruption[]): Promise<Disruption[]> {
    if (disruptions.length === 0) return [];
    const db = getSupabaseAdmin();
    const rows = disruptions.map(disruptionToInsertRow);
    const { data, error } = await db.from("disruptions").insert(rows).select("*");
    if (error) throw new Error(`Failed to persist disruptions: ${error.message}`);
    return (data as DisruptionRow[]).map(rowToDisruption);
  }

  async listForTrip(tripId: string): Promise<Disruption[]> {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("disruptions")
      .select("*")
      .eq("trip_id", tripId)
      .order("detected_at", { ascending: false });
    if (error) throw new Error(`Failed to load disruptions: ${error.message}`);
    return (data as DisruptionRow[]).map(rowToDisruption);
  }
}

// --- Factory ----------------------------------------------------------------

let inMemorySingleton: DisruptionRepository | null = null;
let supabaseSingleton: DisruptionRepository | null = null;

export function getDisruptionRepository(): DisruptionRepository {
  if (isSupabaseConfigured()) {
    if (!supabaseSingleton) supabaseSingleton = new SupabaseDisruptionRepository();
    return supabaseSingleton;
  }
  if (!inMemorySingleton) inMemorySingleton = new InMemoryDisruptionRepository();
  return inMemorySingleton;
}
