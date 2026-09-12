/**
 * Space Zero — recovery workflow (Strands orchestration + honest fallback).
 *
 * The recovery agent is the SAME verified Strands runtime and model factory as
 * the main agent, given the recovery tools and a recovery-focused prompt. When a
 * disruption is detected, the workflow runs the agent to orchestrate
 * get_recovery_context → search_recovery_options → evaluate_recovery_options →
 * execute_booking. Every decision inside those tools is deterministic backend
 * code (src/domain/recovery.ts + recovery-service) — the model never decides
 * authority, funding, ranking, or eligibility.
 *
 * If the model provider is unavailable (no key), the workflow still completes the
 * recovery deterministically through the same choke point (runRecovery) so an
 * at-risk trip is never left stuck — it does not fabricate anything. Only user-
 * safe OPERATIONAL EVENTS are streamed; the model's reasoning is never exposed.
 */

import { Agent } from "@strands-agents/sdk";
import { getModel } from "../../agent/model";
import { spaceZeroTools } from "../tools";
import {
  runRecovery,
  getRecoveryContext,
  type RecoveryDeps,
  type RecoveryOutcome,
} from "./recovery-service";
import { getRecoveryRepository } from "../persistence/recovery-repository";
import type { Recovery } from "../../domain/recovery";

const RECOVERY_SYSTEM_PROMPT = `You are Space Zero, an autonomous travel operator recovering a disrupted trip on the traveler's behalf.

Work the recovery in this order, and follow these rules exactly:
- Call get_recovery_context first to load the affected trip, its disruption, and the booked itinerary. Do not assume state.
- Call search_recovery_options to find real alternatives. It queries the provider and ranks deterministically — never invent, filter, or reorder flights, and never invent prices or times.
- Call evaluate_recovery_options to get the deterministic verdict. You do NOT decide eligibility, ranking, authority, funding, or budget yourself — the backend does. Treat its decision as binding.
- If the decision is AUTO_BOOK, call execute_booking to rebook. It is the only action that moves money and it re-checks everything itself.
- If the decision is ESCALATE or NO_OPTION, STOP. Do not book, do not try lower amounts or other tricks to get under a limit. Surface that the traveler's approval is needed.
- Never claim an action happened unless a tool result confirms it. Do not fabricate references or confirmations.

Communicate like a capable operator: short, factual, no filler.`;

/** Builds the recovery agent (same model provider + tools as the main agent). */
export async function buildRecoveryAgent(): Promise<Agent> {
  const model = await getModel();
  return new Agent({ model, tools: spaceZeroTools, systemPrompt: RECOVERY_SYSTEM_PROMPT });
}

/** The prompt the recovery agent receives — states facts, never conclusions. */
export function buildRecoveryPrompt(tripId: string): string {
  return [
    `Trip ${tripId} is at risk from a disruption. Recover it.`,
    `Use get_recovery_context, then search_recovery_options, then evaluate_recovery_options.`,
    `If the deterministic decision is AUTO_BOOK, use execute_booking. If it is ESCALATE or NO_OPTION, stop and report that the traveler's approval is needed.`,
    `Report the outcome concisely.`,
  ].join("\n");
}

export interface TriggerRecoveryDeps extends RecoveryDeps {
  /** Force the deterministic path (skip the Strands agent). Used in tests. */
  deterministicOnly?: boolean;
  /** Injected agent runner (tests). Defaults to running the real Strands agent. */
  runAgent?: (tripId: string) => Promise<void>;
}

async function runRealAgent(tripId: string): Promise<void> {
  const agent = await buildRecoveryAgent();
  const gen = agent.stream(buildRecoveryPrompt(tripId));
  let next = await gen.next();
  while (!next.done) next = await gen.next();
}

/**
 * Trigger the recovery workflow for an at-risk trip. Prefers the Strands agent as
 * the orchestrator; if the model provider is unavailable (or the agent run fails)
 * it completes the recovery deterministically through the same choke point, so
 * the trip is never left stuck. Returns the final recovery outcome.
 */
export async function triggerRecoveryWorkflow(
  tripId: string,
  deps: TriggerRecoveryDeps = {},
): Promise<RecoveryOutcome> {
  const recoveryRepo = deps.recoveryRepo ?? getRecoveryRepository();

  if (!deps.deterministicOnly) {
    try {
      await (deps.runAgent ?? runRealAgent)(tripId);
    } catch {
      // The model provider is unavailable or the run failed — fall through to the
      // deterministic completion below. Never leave an at-risk trip unresolved.
    }
    // If the agent already produced a recovery outcome, surface it.
    const latest = await recoveryRepo.latestForTrip(tripId);
    if (latest) return outcomeFromRecovery(tripId, latest, deps);
  }

  // Deterministic completion through the recovery choke point.
  return runRecovery(tripId, deps);
}

async function outcomeFromRecovery(
  tripId: string,
  recovery: Recovery,
  deps: RecoveryDeps,
): Promise<RecoveryOutcome> {
  const ctx = await getRecoveryContext(tripId, deps);
  return {
    status: recovery.status === "RECOVERED" ? "recovered" : "escalated",
    tripId,
    tripStatus: ctx?.trip.status ?? null,
    recovery,
    reason: recovery.reason,
  };
}

// ---------------------------------------------------------------------------
// Operational events (user-safe; derived from the deterministic outcome only —
// never the model's reasoning). Streamed by the /recover route.
// ---------------------------------------------------------------------------

export type RecoveryOperationalEvent =
  | { stage: "RECEIVED"; label: string }
  | { stage: "SEARCHING"; label: string }
  | { stage: "EVALUATING"; label: string }
  | {
      stage: "REBOOKING";
      label: string;
      additionalCost: number;
      recoveryAllowance: number;
      currency: string;
    }
  | {
      stage: "RESOLVED";
      label: string;
      bookingReference?: string;
      additionalCost: number;
      newArrivalLabel?: string;
      currency: string;
    }
  | {
      stage: "ESCALATED";
      label: string;
      escalationReason: string;
      overBy?: number;
      currency: string;
      reason: string;
    }
  | { stage: "UNAVAILABLE"; label: string; reason: string };

/** Synthesize user-safe operational events from a completed recovery outcome. */
export function recoveryOutcomeEvents(outcome: RecoveryOutcome): RecoveryOperationalEvent[] {
  const events: RecoveryOperationalEvent[] = [
    { stage: "SEARCHING", label: "Searching alternatives" },
    { stage: "EVALUATING", label: "Checking arrival, connection, authority, and funding" },
  ];
  const r = outcome.recovery;

  if (outcome.status === "recovered" && r) {
    events.push({
      stage: "REBOOKING",
      label: "Rebooking within authority",
      additionalCost: r.additionalCost,
      recoveryAllowance: 0,
      currency: r.currency,
    });
    events.push({
      stage: "RESOLVED",
      label: "Resolved",
      bookingReference: r.bookingReference ?? undefined,
      additionalCost: r.additionalCost,
      newArrivalLabel: r.newArrivalLabel ?? undefined,
      currency: r.currency,
    });
    return events;
  }

  if (outcome.status === "escalated" && r) {
    events.push({
      stage: "ESCALATED",
      label: "Your decision is needed",
      escalationReason: r.escalationReason ?? "NO_ELIGIBLE_OPTION",
      overBy: r.overBy ?? undefined,
      currency: r.currency,
      reason: r.reason,
    });
    return events;
  }

  // provider_unconfigured / provider_error / not_at_risk / no_booking / not_found
  events.push({
    stage: "UNAVAILABLE",
    label: "Recovery could not complete",
    reason: outcome.reason,
  });
  return events;
}
