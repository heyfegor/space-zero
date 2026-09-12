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
import type { FlightOption } from "../domain/flight-option";
import {
  getTripById,
  putTrip,
  seedDemoTrip,
  DEMO_TRIP_ID,
  DEMO_TRIP_OVER_LIMIT_ID,
} from "./tools/dev-store";
import { recoveryOptionsFor } from "./tools/recovery-fixtures";
import { getTripRepository } from "./persistence/trip-repository";
import { getFlightOptionRepository } from "./persistence/flight-option-repository";
import { getFundingView } from "./trips/funding-service";

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
  /**
   * True when the client supplied an explicit trip id. Such an id is a REAL
   * persisted-trip candidate (the route confirms it against the persistence
   * layer); when it is not persisted it is treated as an explicit demo id. When
   * false, the run is the deterministic demo for `scenario`.
   */
  explicit: boolean;
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

  seedDemoTrip();

  // An explicit id is a real persisted-trip candidate (confirmed async in the
  // route) or an explicit demo id. Either way it is NOT rejected here — the demo
  // store is not authoritative for persisted trips.
  const explicitId = typeof tripId === "string" && tripId.trim() ? tripId.trim() : null;
  if (explicitId) {
    return {
      ok: true,
      value: { brief: brief.trim(), tripId: explicitId, scenario: key, recoveryAllowance: allowance, explicit: true },
    };
  }

  // No explicit id: run the deterministic demo for the requested scenario.
  const resolvedTripId = SCENARIO_TRIP[key];
  if (!getTripById(resolvedTripId)) {
    return { ok: false, status: 404, message: "That trip could not be found." };
  }
  return {
    ok: true,
    value: { brief: brief.trim(), tripId: resolvedTripId, scenario: key, recoveryAllowance: allowance, explicit: false },
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
  | { stage: "RESOLVED"; label: string; status: string; bookingReference?: string }
  // --- Initial-booking stages for a REAL persisted trip (honest, status-gated) --
  | { stage: "SEARCHING"; label: string }
  | { stage: "BOOKING"; label: string }
  | {
      stage: "BOOKED";
      label: string;
      status: string;
      currency: string;
      bookingReference?: string;
      finalCost?: number;
    }
  | { stage: "BOOKING_FAILED"; label: string; reason: string };

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

// ---------------------------------------------------------------------------
// Persisted-trip Execution run (real trip, real context, honest outcomes)
// ---------------------------------------------------------------------------

/** The route string for a real flight option: origin → via → destination. */
function optionRoute(option: FlightOption): string {
  const points = [option.segments[0]?.from, ...option.segments.map((s) => s.to)].filter(
    (p): p is string => Boolean(p),
  );
  return points.join(" → ");
}

/**
 * The structured context the agent is given for a REAL persisted trip, built
 * from the persisted trip intent, the selected real itinerary, the funding view,
 * and the authority settings. This is what makes the run operate on the actual
 * trip instead of a demo fixture. Pure/read-only — it never mutates or books.
 */
export interface PersistedExecutionContext {
  tripId: string;
  status: Trip["status"];
  intent: {
    origin?: string;
    destination: string;
    arriveBy?: string;
    depart?: string;
    cabin?: string;
    baggage?: string;
    seat?: string;
  };
  selectedOption: {
    id: string;
    route: string;
    totalAmount: number;
    currency: string;
    arriveAt: string;
    connections: number;
  } | null;
  funding: {
    status: string;
    fundedAmount: number;
    estimatedCost: number;
    sufficient: boolean;
    currency: string;
  } | null;
  authority: {
    tripBudget: number;
    recoveryAllowance: number;
    autoRebook: boolean;
    currency: string;
  };
}

/** Assemble the agent context from persisted trip + options + funding. */
export async function buildExecutionContext(trip: Trip): Promise<PersistedExecutionContext> {
  const options = await getFlightOptionRepository().listForTrip(trip.id);
  const chosen =
    options.find((o) => o.selected) ??
    (trip.selectedOptionId ? options.find((o) => o.id === trip.selectedOptionId) : undefined) ??
    options.find((o) => o.recommended) ??
    options[0] ??
    null;
  const funding = await getFundingView(trip.id);

  return {
    tripId: trip.id,
    status: trip.status,
    intent: {
      origin: trip.origin || undefined,
      destination: trip.destination,
      arriveBy: trip.arriveBy,
      depart: trip.depart,
      cabin: trip.cabin,
      baggage: trip.baggage,
      seat: trip.seat,
    },
    selectedOption: chosen
      ? {
          id: chosen.id,
          route: optionRoute(chosen),
          totalAmount: chosen.totalAmount,
          currency: chosen.currency,
          arriveAt: chosen.arriveAt,
          connections: chosen.connections,
        }
      : null,
    funding: funding
      ? {
          status: funding.status,
          fundedAmount: funding.fundedAmount,
          estimatedCost: funding.estimatedCost,
          sufficient: funding.sufficient,
          currency: funding.currency,
        }
      : null,
    authority: {
      tripBudget: trip.tripBudget,
      recoveryAllowance: trip.recoveryAllowance,
      autoRebook: trip.autoRebook,
      currency: trip.currency,
    },
  };
}

/**
 * The prompt the agent receives for a persisted trip. It states the concrete
 * trip id and the real structured facts (intent, selected itinerary, funding,
 * authority) so the agent is tool-driven — it never tells the agent what to
 * conclude, and never presents an unconfirmed booking/payment as done.
 */
export function buildPersistedAgentPrompt(
  brief: string,
  trip: Trip,
  ctx: PersistedExecutionContext,
): string {
  const c = ctx.authority.currency;
  const lines: string[] = [
    `The traveler's brief:`,
    `"${(trip.brief ?? "").trim() || brief}"`,
    ``,
    `You are handling persisted trip ${trip.id}, currently ${trip.status}.`,
    `Destination: ${ctx.intent.destination}${ctx.intent.arriveBy ? ` · must arrive ${ctx.intent.arriveBy}` : ""}.`,
    ctx.selectedOption
      ? `Selected itinerary: ${ctx.selectedOption.route}, ${ctx.selectedOption.currency}${ctx.selectedOption.totalAmount}.`
      : `No itinerary has been selected yet.`,
    ctx.funding
      ? `Funding: ${ctx.funding.status}, ${c}${ctx.funding.fundedAmount} set aside against a ${c}${ctx.funding.estimatedCost} estimate (${ctx.funding.sufficient ? "sufficient" : "insufficient"}).`
      : `Funding: not set.`,
    `Authority: budget ${c}${ctx.authority.tripBudget}, recovery allowance ${c}${ctx.authority.recoveryAllowance}, auto-rebook ${ctx.authority.autoRebook ? "on" : "off"}.`,
    ``,
    `Inspect the trip with get_trip. If it is at risk, find recovery options and rebook the best one that is within authority; otherwise book the selected itinerary with execute_booking. execute_booking enforces authority, funding, and budget itself and makes the real booking — never claim a booking, payment, or resolution unless a tool result confirms it. If a provider is unavailable, report that honestly. Report the outcome concisely.`,
  ];
  return lines.join("\n");
}

/**
 * Map a COMPLETED tool call on a PERSISTED trip to user-safe operational events.
 * Reads only the tool name + structured input and the trip's ACTUAL post-call
 * state (never model reasoning). Success is STATUS-GATED: a booking/resolution
 * is reported only when the persisted trip actually advanced to CONFIRMED/
 * MONITORING/RESOLVED — which the booking and recovery services do solely on a
 * provider-confirmed order. Any other outcome is reported as honest downtime.
 */
export function eventsForPersistedToolCall(
  toolName: string,
  input: unknown,
  trip: Trip | undefined,
): OperationalEvent[] {
  if (!trip) return [];
  const args = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;

  switch (toolName) {
    case "get_trip":
      return [{ stage: "PLANNING", label: "Inspecting the trip" }];

    case "search_flights":
    case "get_recovery_context":
    case "search_recovery_options":
      return [{ stage: "SEARCHING", label: "Reviewing itineraries" }];

    case "check_authority":
    case "evaluate_recovery_options": {
      const amount = num(args.amount);
      if (amount === undefined) {
        return [{ stage: "CHECKING_AUTHORITY", label: "Checking delegated authority" }];
      }
      return [
        {
          stage: "CHECKING_AUTHORITY",
          label: "Checking delegated authority",
          requestedAmount: amount,
          recoveryAllowance: trip.recoveryAllowance,
          permitted: evaluateAuthority(amount, trip.recoveryAllowance, trip.currency).permitted,
        },
      ];
    }

    case "execute_booking": {
      if (trip.status === "RESOLVED") {
        return [
          {
            stage: "RESOLVED",
            label: "Resolved",
            status: trip.status,
            bookingReference: trip.bookingReference,
          },
        ];
      }
      if (trip.status === "CONFIRMED" || trip.status === "MONITORING") {
        return [
          {
            stage: "BOOKED",
            label: "Booked",
            status: trip.status,
            currency: trip.currency,
            bookingReference: trip.bookingReference,
            finalCost: trip.finalCost ?? undefined,
          },
        ];
      }
      // No advance means no provider-confirmed order — never fabricate success.
      return [
        {
          stage: "BOOKING_FAILED",
          label: "Booking didn't complete",
          reason:
            "No confirmation from the provider. No booking was made and nothing was charged.",
        },
      ];
    }

    default:
      return [];
  }
}

/** Final summary for a persisted trip, read from real persistence. */
export async function persistedTripSummary(tripId: string): Promise<TripSummary | null> {
  const trip = await getTripRepository().getById(tripId);
  if (!trip) return null;
  const route = routeString(trip);
  return {
    tripId,
    status: trip.status,
    bookingReference: trip.bookingReference,
    route: route.trim() || trip.destination,
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
  // Missing/invalid credentials or an unconfigured provider.
  const unconfigured = /ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_REGION|api key|not set|not configured|credential/i.test(raw);
  // The provider is configured but the model call could not be served: no model
  // access, an EOL/withdrawn model, account verification pending, throttling, a
  // rate-limit / quota exhaustion (e.g. a Gemini 429 "exceeded your current
  // quota" / RESOURCE_EXHAUSTED), or the provider endpoint being unreachable. All
  // are "operator unavailable", never a booking failure that should read as
  // anything but honest downtime.
  const providerDown =
    /operation not allowed|end of its life|being verified|access to (this|the) model|accessdenied|throttl|rate ?limit|quota|resource_exhausted|too many requests|\b429\b|bedrock|getaddrinfo|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|service unavailable|502|503|504/i.test(
      raw,
    );
  if (unconfigured || providerDown) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      message:
        "Space Zero's operator is temporarily unavailable. No booking was made and nothing was charged.",
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
