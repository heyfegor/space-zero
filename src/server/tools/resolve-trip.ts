/**
 * Space Zero — trip resolution for the agent tools.
 *
 * Mirrors execute_booking's dual-path so EVERY tool sees the same trip a
 * persisted (?trip=<id>) Execution run operates on: real persistence first, then
 * the in-memory staged/demo store. This is what lets a real trip flow through
 * the existing Strands loop while the deterministic £96/£181 demo fixtures keep
 * working unchanged.
 */

import type { Trip } from "../../domain/trip";
import { getTripRepository } from "../persistence/trip-repository";
import { getTripById } from "./dev-store";

/** Resolve a trip from real persistence first, then the in-memory demo store. */
export async function resolveTrip(tripId: string): Promise<Trip | undefined> {
  const persisted = await getTripRepository().getById(tripId);
  if (persisted) return persisted;
  return getTripById(tripId);
}
