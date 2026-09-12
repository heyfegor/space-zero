/**
 * Space Zero — pure flow navigation + agent-run request builders.
 *
 * No React, no client/server imports: just the deterministic rules for how the
 * product screens thread a persisted trip id between each other and how the
 * Execution screen asks /api/agent to run. Kept pure so it is unit-testable and
 * shared verbatim by the pages and the tests (the id that Authorization passes
 * is exactly the id Execution sends).
 */

/** Append ?trip=<id> to a path when a persisted trip is in context. */
export function withTrip(path: string, tripId: string | null | undefined): string {
  return tripId ? `${path}?trip=${encodeURIComponent(tripId)}` : path;
}

/** The link Authorization follows to reach Execution for a persisted trip. */
export function executionHref(tripId: string | null | undefined): string {
  return withTrip("/app/execution", tripId);
}

/** Fallback brief when a persisted trip carries no free-text brief of its own. */
export const DEFAULT_EXECUTION_BRIEF = "Handle my trip within my authority.";

/** POST body for a REAL persisted-trip run: the server loads everything by id. */
export interface PersistedRunRequest {
  tripId: string;
  brief: string;
}

export function buildPersistedRun(tripId: string, brief?: string | null): PersistedRunRequest {
  const trimmed = (brief ?? "").trim();
  return { tripId, brief: trimmed || DEFAULT_EXECUTION_BRIEF };
}

/** POST body for an EXPLICIT deterministic demo scenario (never a real trip). */
export interface DemoRunRequest {
  brief: string;
  scenario: "recovery" | "over_limit";
  recoveryAllowance: number;
}

/** Backend accepts a recovery allowance in [0, 500]; clamp the user's value. */
export function clampAllowance(n: number): number {
  return Math.max(0, Math.min(500, Math.round(Number.isFinite(n) ? n : 0)));
}

export function buildDemoRun(
  scenario: "recovery" | "over_limit",
  recoveryAllowance: number,
  brief?: string | null,
): DemoRunRequest {
  const trimmed = (brief ?? "").trim();
  return {
    brief: trimmed || "Handle my LHR → SIN → SYD trip within my authority.",
    scenario,
    recoveryAllowance: clampAllowance(recoveryAllowance),
  };
}
