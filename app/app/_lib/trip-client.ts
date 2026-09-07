"use client";

/**
 * Space Zero — client for the server-backed trip API.
 *
 * Thin typed wrappers over POST /api/trips and GET/PATCH /api/trips/[id], plus a
 * `useTrip` hook that loads a persisted trip and persists edits. Errors surface
 * as user-safe messages (the server never returns internals).
 */

import { useCallback, useEffect, useState } from "react";

export interface ApiTripIntent {
  destination: string;
  arriveBy?: string;
  depart?: string;
  budget?: number;
  recoveryAllowance?: number;
  cabin?: string;
  baggage?: string;
  seat?: string;
}

export type FundingStatus = "UNFUNDED" | "PROCESSING" | "FUNDED" | "INSUFFICIENT";

export interface ApiTrip {
  id: string;
  status: string;
  brief: string;
  currency: string;
  intent: ApiTripIntent;
  selectedOptionId: string | null;
  funding: { amount: number | null; status: FundingStatus };
}

/** Computed funding view returned by /api/trips/[id]/funding (mirrors FundingView). */
export interface FundingView {
  status: FundingStatus;
  fundedAmount: number;
  estimatedCost: number;
  remaining: number;
  buffer: number;
  shortfall: number;
  sufficient: boolean;
  currency: string;
}

/** Fields the client may update (mirrors the server's tripPatchSchema). */
export interface TripPatch {
  destination?: string;
  arriveBy?: string;
  depart?: string;
  budget?: number;
  recoveryAllowance?: number;
  cabin?: string;
  baggage?: string;
  seat?: string;
  selectedOptionId?: string | null;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "Something went wrong.";
}

export async function createTrip(brief: string): Promise<ApiTrip> {
  const res = await fetch("/api/trips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).trip as ApiTrip;
}

export async function fetchTrip(id: string): Promise<ApiTrip> {
  const res = await fetch(`/api/trips/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).trip as ApiTrip;
}

export async function patchTrip(id: string, patch: TripPatch): Promise<ApiTrip> {
  const res = await fetch(`/api/trips/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).trip as ApiTrip;
}

// --- Funding ----------------------------------------------------------------

/** Read the trip's computed funding view (status + funded/remaining/buffer). */
export async function fetchFunding(tripId: string): Promise<FundingView> {
  const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/funding`);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).funding as FundingView;
}

/** Persist a funding update. The server resolves the status against the cost. */
export async function updateFunding(
  tripId: string,
  input: { status: FundingStatus; fundedAmount?: number | null },
): Promise<FundingView> {
  const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/funding`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()).funding as FundingView;
}

// --- Flight options ---------------------------------------------------------

export interface FlightOptionResponse {
  id: string;
  providerOfferId: string;
  origin: string;
  destination: string;
  via: string[];
  segments: { from: string; to: string; departAt: string; arriveAt: string; carrier?: string; flightNumber?: string }[];
  totalAmount: number;
  currency: string;
  durationMinutes: number;
  connections: number;
  departAt: string;
  arriveAt: string;
  rank: number;
  recommended: boolean;
  selected: boolean;
  expiresAt: string | null;
}

export type SearchStatus =
  | "ok"
  | "no_results"
  | "provider_unconfigured"
  | "operator_unavailable"
  | "provider_error"
  | "origin_unknown"
  | "destination_unknown"
  | "trip_not_found";

/** Read already-persisted options (runs no search). */
export async function fetchOptions(tripId: string): Promise<FlightOptionResponse[]> {
  const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/options`);
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()).options ?? []) as FlightOptionResponse[];
}

/** Trigger the agent-orchestrated search and return its outcome. */
export async function searchFlights(tripId: string): Promise<{ status: SearchStatus; options: FlightOptionResponse[] }> {
  const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/search`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  return { status: (body.status ?? "provider_error") as SearchStatus, options: (body.options ?? []) as FlightOptionResponse[] };
}

/** Persist the chosen option (marks it selected and sets trip.selectedOptionId). */
export async function selectOption(tripId: string, optionId: string): Promise<void> {
  const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/options/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ optionId }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Read a query param on the client without needing a Suspense boundary. */
export function useQueryParam(name: string): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    try {
      setValue(new URLSearchParams(window.location.search).get(name));
    } catch {
      setValue(null);
    }
  }, [name]);
  return value;
}

export interface UseTripResult {
  trip: ApiTrip | null;
  loading: boolean;
  error: string | null;
  /** Persist a patch; updates local state on success. Throws on failure. */
  save: (patch: TripPatch) => Promise<void>;
}

/**
 * Load a persisted trip by id and persist edits. When `id` is null (e.g. the
 * screen was opened without ?trip=), it settles to loading:false, trip:null so
 * callers can fall back to demo/flow state.
 */
export function useTrip(id: string | null): UseTripResult {
  const [trip, setTrip] = useState<ApiTrip | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setTrip(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchTrip(id)
      .then((t) => { if (!cancelled) setTrip(t); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the trip."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const save = useCallback(
    async (patch: TripPatch) => {
      if (!id) return;
      const updated = await patchTrip(id, patch);
      setTrip(updated);
    },
    [id],
  );

  return { trip, loading, error, save };
}
