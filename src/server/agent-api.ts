/**
 * Space Zero — agent API helpers (server-side, testable, no LLM).
 *
 * Pure/deterministic glue between the HTTP route and the agent:
 *   - request parsing/validation
 *   - the prompt the agent receives (injects the concrete trip id so the agent
 *     is tool-driven, never given a hardcoded answer)
 *   - user-safe OPERATIONAL EVENTS derived from tool-call metadata + the
 *     deterministic domain (never chain-of-thought / hidden reasoning)
 *   - user-safe error mapping (no stack traces, no secrets)
 *
 * These functions are unit-tested without a live model.
 */

import { evaluateAuthority } from "../domain/authority";
import type { Trip } from "../domain/trip";
import {
  getTripById,
  putTrip,
  seedDemoTrip,
  DEMO_TRIP_ID,
  DEMO_TRIP_OVER_LIMIT_ID,
} from "./tools/dev-store";
import { recoveryOptionsFor } from "./tools/recovery-fixtures";

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

export type ScenarioKey = "recovery" | "over_limit";

const SCENARIO_TRIP: Record<ScenarioKey, string> = {
  recovery: DEMO_TRIP_ID,
  over_limit: DEMO_TRIP_OVER_LIMIT_ID,
};

export interface AgentRequest {
  brief: string;
  tripId: string;
  scenario: ScenarioKey;
  /** The user's chosen recovery allowance (from the Authority screen slider). */
  recoveryAllowance?: number;
}

export type ParseResult =
  | { ok: true; value: AgentRequest }
  | { ok: false; status: number; message: string };

/** Bounds for the user-set recovery allowance (matches the design slider). */
export const ALLOWANCE_MIN = 0;
export const ALLOWANCE_MAX = 500;

export function parseAgentRequest(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, status: 400, message: "Request body must be a JSON object." };
  }
  const { brief, scenario, tripId, recoveryAllowance } = raw as Record<string, unknown>;

  if (typeof brief !== "string" || !brief.trim()) {
    return { ok: false, status: 400, message: "A non-empty trip brief is required." };
  }
  if (brief.length > 4000) {
    return { ok: false, status: 400, message: "Trip brief is too long." };
  }

  let key: ScenarioKey = "recovery";
  if (scenario !== undefined) {
    if (scenario !== "recovery" && scenario !== "over_limit") {
      return { ok: false, status: 400, message: "Unknown scenario." };
    }
    key = scenario;
  }

  let allowance: number | undefined;
  if (recoveryAllowance !== undefined) {
    if (
      typeof recoveryAllowance !== "number" ||
      !Number.isFinite(recoveryAllowance) ||
      recoveryAllowance < ALLOWANCE_MIN ||
      recoveryAllowance > ALLOWANCE_MAX
    ) {
      return { ok: false, status: 400, message: "Recovery allowance is out of range." };
    }
    allowance = recoveryAllowance;
  }

  let resolvedTripId = SCENARIO_TRIP[key];
  if (typeof tripId === "string" && tripId.trim()) resolvedTripId = tripId.trim();

  seedDemoTrip();
  if (!getTripById(resolvedTripId)) {
    return { ok: false, status: 404, message: "That trip could not be found." };
  }

  return {
    ok: true,
    value: { brief: brief.trim(), tripId: resolvedTripId, scenario: key, recoveryAllowance: allowance },
  };
}

/**
 * Apply the user's chosen recovery allowance to the trip up front. This is a
 * legitimate USER delegation (the Authority screen), not an agent action — the
 * agent still cannot inflate it, and execute_booking enforces against whatever
 * is stored here. Returns the stored allowance actually in effect.
 */
export function applyUserAuthority(tripId: string, recoveryAllowance?: number): number | null {
  const trip = getTripById(tripId);
  if (!trip) return null;
  if (recoveryAllowance === undefined) return trip.recoveryAllowance;
  putTrip({ ...trip, recoveryAllowance });
  return recoveryAllowance;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function routeString(trip: Trip): string {
  const points = [trip.segments[0]?.from ?? trip.origin, ...trip.segments.map((s) => s.to)];
  return points.join(" → ");
}

/**
 * The message the agent receives. It states the concrete trip id and facts so
 * the agent can drive the tools — it does NOT tell the agent what to conclude.
 */
export function buildAgentPrompt(brief: string, trip: Trip): string {
  return [
    `The traveler's brief:`,
    `"${brief}"`,
    ``,
    `You are handling trip ${trip.id} (${routeString(trip)}), currently ${trip.status} ` +
      `with a ${trip.currency}${trip.recoveryAllowance} recovery allowance.`,
    `Inspect it with get_trip. If it is at risk, find recovery options with recover_trip, ` +
      `then use execute_booking to book the best option that is within authority. ` +
      `If no option is within authority, stop and report that it exceeds the delegated authority. ` +
      `Report the outcome concisely.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Operational events (user-safe; derived from tool metadata + domain)
// ---------------------------------------------------------------------------

export type OperationalEvent =
  | { stage: "RECEIVED"; label: string }
  | { stage: "PLANNING"; label: string }
  | {
      stage: "CHECKING_AUTHORITY";
      label: string;
      requestedAmount?: number;
      recoveryAllowance?: number;
      permitted?: boolean;
    }
  | {
      stage: "RECOVERY_FOUND";
      label: string;
      currency: string;
      options: {
        id: string;
        from: string;
        to: string;
        additionalCost: number;
        newArrivalLabel: string;
        withinAuthority: boolean;
      }[];
    }
  | {
      stage: "REBOOKING";
      label: string;
      requestedAmount: number;
      recoveryAllowance: number;
      currency: string;
    }
  | {
      stage: "PERMITTED";
      label: string;
      requestedAmount: number;
      recoveryAllowance: number;
      remainingAllowance: number;
      currency: string;
    }
  | {
      stage: "REBOOKED";
      label: string;
      mode: "STAGED";
      bookingReference: string;
      status: string;
    }
  | {
      stage: "DENIED";
      label: string;
      requestedAmount: number;
      recoveryAllowance: number;
      currency: string;
      reason: string;
    }
  | { stage: "STOPPED"; label: string }
  | { stage: "RESOLVED"; label: string; status: string; bookingReference?: string };

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Map a COMPLETED tool call to user-safe operational events. Reads only the
 * tool name + structured input and the deterministic domain/store — never the
 * model's reasoning text. Called on afterToolCallEvent, so the store already
 * reflects any mutation the tool made.
 */
export function eventsForToolCall(
  toolName: string,
  input: unknown,
  tripId: string,
): OperationalEvent[] {
  const trip = getTripById(tripId);
  if (!trip) return [];
  const args = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  switch (toolName) {
    case "get_trip":
      return [{ stage: "PLANNING", label: "Inspecting the trip" }];

    case "check_authority": {
      const amount = num(args.amount);
      if (amount === undefined) {
        return [{ stage: "CHECKING_AUTHORITY", label: "Checking delegated authority" }];
      }
      const a = evaluateAuthority(amount, trip.recoveryAllowance, trip.currency);
      return [
        {
          stage: "CHECKING_AUTHORITY",
          label: "Checking delegated authority",
          requestedAmount: amount,
          recoveryAllowance: trip.recoveryAllowance,
          permitted: a.permitted,
        },
      ];
    }

    case "recover_trip": {
      const options = recoveryOptionsFor(trip).map((o) => ({
        id: o.id,
        from: o.from,
        to: o.to,
        additionalCost: o.additionalCost,
        newArrivalLabel: o.newArrivalLabel,
        withinAuthority: evaluateAuthority(o.additionalCost, trip.recoveryAllowance, trip.currency)
          .permitted,
      }));
      return [
        { stage: "RECOVERY_FOUND", label: "Recovery options found", currency: trip.currency, options },
      ];
    }

    case "execute_booking": {
      const amount = num(args.amount) ?? 0;
      const a = evaluateAuthority(amount, trip.recoveryAllowance, trip.currency);
      if (a.permitted) {
        return [
          {
            stage: "REBOOKING",
            label: "Rebooking within authority",
            requestedAmount: amount,
            recoveryAllowance: trip.recoveryAllowance,
            currency: trip.currency,
          },
          {
            stage: "PERMITTED",
            label: "Authorized",
            requestedAmount: amount,
            recoveryAllowance: trip.recoveryAllowance,
            remainingAllowance: a.remainingAllowance,
            currency: trip.currency,
          },
          {
            stage: "REBOOKED",
            label: "Staged booking confirmed",
            mode: "STAGED",
            bookingReference: trip.bookingReference ?? "SZ-0000",
            status: trip.status,
          },
          {
            stage: "RESOLVED",
            label: "Resolved",
            status: trip.status,
            bookingReference: trip.bookingReference,
          },
        ];
      }
      return [
        {
          stage: "REBOOKING",
          label: "Attempting recovery",
          requestedAmount: amount,
          recoveryAllowance: trip.recoveryAllowance,
          currency: trip.currency,
        },
        {
          stage: "DENIED",
          label: "Exceeds delegated authority",
          requestedAmount: amount,
          recoveryAllowance: trip.recoveryAllowance,
          currency: trip.currency,
          reason: a.reason,
        },
        { stage: "STOPPED", label: "Stopped — awaiting your decision" },
      ];
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Final summary + errors
// ---------------------------------------------------------------------------

export interface TripSummary {
  tripId: string;
  status: Trip["status"];
  bookingReference?: string;
  route: string;
}

export function tripSummary(tripId: string): TripSummary | null {
  const trip = getTripById(tripId);
  if (!trip) return null;
  return {
    tripId,
    status: trip.status,
    bookingReference: trip.bookingReference,
    route: routeString(trip),
  };
}

export interface UserSafeError {
  code: string;
  message: string;
}

/**
 * Map any error to a user-safe shape. Never returns raw messages (which could
 * contain secrets or internals) except as fixed, vetted strings.
 */
export function toUserSafeError(err: unknown): UserSafeError {
  const raw = err instanceof Error ? err.message : String(err);
  if (/ANTHROPIC_API_KEY|OPENAI_API_KEY|api key|not set|not configured|credential/i.test(raw)) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      message:
        "Space Zero's operator is temporarily unavailable (model provider not configured).",
    };
  }
  if (/Invalid trip transition|InvalidTransition/i.test(raw)) {
    return {
      code: "INVALID_TRIP_STATE",
      message: "The trip is not in a state that allows this action.",
    };
  }
  return {
    code: "AGENT_ERROR",
    message: "Space Zero hit a problem handling the trip. Please try again.",
  };
}
