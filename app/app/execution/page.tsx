"use client";

/**
 * Space Zero — Execution. The autonomous operator working, driven by the REAL
 * /api/agent SSE stream. Only user-safe operational events (from the existing
 * server event model) are rendered — never model reasoning.
 *
 * Two modes, chosen by the URL:
 *   - PERSISTED (?trip=<id>): the real trip the traveler briefed, funded, and
 *     authorized. The server loads it, builds the agent context from its intent,
 *     selected itinerary, funding, and authority, and runs the Strands agent on
 *     it. Nothing is shown as booked/resolved unless the persisted trip actually
 *     advanced (a provider-confirmed order) — otherwise an honest "didn't
 *     complete / provider unavailable" state is shown. No booking is fabricated.
 *   - DEMO (?scenario=recovery|over_limit, or no trip): the deterministic £96 /
 *     £181 staged fixtures, kept available as explicit demos. They never replace
 *     a real trip — a real trip always carries ?trip=.
 *
 * Refresh preserves context: the trip id lives in the URL, so a reload re-loads
 * the same persisted trip and re-runs against it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFlow, money } from "../_lib/flow";
import { fetchTrip } from "../_lib/trip-client";
import { buildPersistedRun, buildDemoRun } from "../_lib/flow-nav";
import { PageHeader } from "../_components/PageHeader";
import { TimelineStep, type StepStatus } from "../_components/TimelineStep";
import { Wordmark, Check, Warn, ctaSolid } from "../_components/ui";

// Mirror of the server's operational event model (no server import in a client
// component). Kept in sync with src/server/agent-api.ts.
type RecoveryOpt = { id: string; from: string; to: string; additionalCost: number; newArrivalLabel: string; withinAuthority: boolean };
type StageEvent =
  | { stage: "RECEIVED"; label: string }
  | { stage: "PLANNING"; label: string }
  | { stage: "SEARCHING"; label: string }
  | { stage: "CHECKING_AUTHORITY"; label: string; requestedAmount?: number; recoveryAllowance?: number; permitted?: boolean }
  | { stage: "RECOVERY_FOUND"; label: string; currency: string; options: RecoveryOpt[] }
  | { stage: "REBOOKING"; label: string; requestedAmount: number; recoveryAllowance: number; currency: string }
  | { stage: "PERMITTED"; label: string; requestedAmount: number; recoveryAllowance: number; remainingAllowance: number; currency: string }
  | { stage: "REBOOKED"; label: string; mode: "STAGED"; bookingReference: string; status: string }
  | { stage: "BOOKING"; label: string }
  | { stage: "BOOKED"; label: string; status: string; currency: string; bookingReference?: string; finalCost?: number }
  | { stage: "BOOKING_FAILED"; label: string; reason: string }
  | { stage: "DENIED"; label: string; requestedAmount: number; recoveryAllowance: number; currency: string; reason: string }
  | { stage: "STOPPED"; label: string }
  | { stage: "RESOLVED"; label: string; status: string; bookingReference?: string };
type TripSummary = { tripId: string; status: string; bookingReference?: string; route: string };

type RunStatus = "running" | "done" | "error";
type RunMode = "persisted" | "demo";

function detailFor(e: StageEvent): string {
  switch (e.stage) {
    case "RECEIVED": return "Brief received";
    case "PLANNING": return "Inspecting the trip";
    case "SEARCHING": return "Reviewing itineraries";
    case "CHECKING_AUTHORITY":
      return e.requestedAmount !== undefined
        ? `${money(e.requestedAmount)} vs ${money(e.recoveryAllowance ?? 0)} allowance`
        : "Testing the spend against your allowance";
    case "RECOVERY_FOUND": {
      const best = e.options.find((o) => o.withinAuthority) ?? e.options[0];
      return best ? `${e.options.length} options · best +${money(best.additionalCost, e.currency)}` : "Searching alternatives";
    }
    case "REBOOKING": return `Rebooking within ${money(e.recoveryAllowance, e.currency)}`;
    case "PERMITTED": return `+${money(e.requestedAmount, e.currency)} within allowance · ${money(e.remainingAllowance, e.currency)} left`;
    case "REBOOKED": return `Staged confirmation ${e.bookingReference}`;
    case "BOOKING": return "Placing the booking with the provider";
    case "BOOKED":
      return e.bookingReference
        ? `Confirmed ${e.bookingReference}${e.finalCost !== undefined ? ` · ${money(e.finalCost, e.currency)}` : ""}`
        : "Confirmed by the provider";
    case "BOOKING_FAILED": return e.reason;
    case "DENIED": return `${money(e.requestedAmount, e.currency)} exceeds ${money(e.recoveryAllowance, e.currency)} · held`;
    case "STOPPED": return "Awaiting your decision";
    case "RESOLVED": return `Trip ${e.status.toLowerCase()}`;
    default: return "";
  }
}

/** Honest terminal outcome, derived from the REAL persisted/demo trip status. */
type Outcome = "booked" | "resolved" | "stopped" | "incomplete";
function outcomeFor(mode: RunMode, status: string | undefined): Outcome {
  if (status === "CONFIRMED" || status === "MONITORING") return "booked";
  if (status === "RESOLVED") return "resolved";
  if (status === "AT_RISK") return "stopped";
  return mode === "persisted" ? "incomplete" : "resolved";
}

export default function Execution() {
  const { authority } = useFlow();
  const [q, setQ] = useState<{ ready: boolean; tripId: string | null; scenario: "recovery" | "over_limit" }>({
    ready: false, tripId: null, scenario: "recovery",
  });
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [status, setStatus] = useState<RunStatus>("running");
  const [summary, setSummary] = useState<TripSummary | undefined>();
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const started = useRef(false);
  const allowanceRef = useRef(authority.recoveryAllowance);

  // Read the trip id + optional explicit demo scenario from the URL once.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const s = sp.get("scenario");
      setQ({ ready: true, tripId: sp.get("trip"), scenario: s === "over_limit" ? "over_limit" : "recovery" });
    } catch {
      setQ({ ready: true, tripId: null, scenario: "recovery" });
    }
  }, []);

  const mode: RunMode = q.tripId ? "persisted" : "demo";

  useEffect(() => {
    if (!q.ready || started.current) return;
    started.current = true;

    (async () => {
      try {
        // Build the request: a REAL persisted run (server loads everything by id)
        // or an EXPLICIT deterministic demo. A real trip is never replaced by a demo.
        let body: unknown;
        if (q.tripId) {
          let brief = "";
          try { brief = (await fetchTrip(q.tripId)).brief; } catch { /* server still loads by id */ }
          body = buildPersistedRun(q.tripId, brief);
        } else {
          body = buildDemoRun(q.scenario, allowanceRef.current);
        }

        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          setStatus("error");
          setErrorMsg(b.error ?? "Space Zero is unavailable right now.");
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split("\n\n");
          buf = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const ev = chunk.match(/^event: (.*)$/m)?.[1];
            const dataStr = chunk.match(/^data: (.*)$/m)?.[1];
            if (!ev || !dataStr) continue;
            const data = JSON.parse(dataStr);
            if (ev === "stage") setStages((p) => [...p, data as StageEvent]);
            else if (ev === "done") { setSummary((data as { summary: TripSummary }).summary); setStatus("done"); }
            else if (ev === "error") { setStatus("error"); setErrorMsg((data as { message?: string }).message ?? "The operator hit an error."); }
          }
        }
        setStatus((s) => (s === "running" ? "done" : s));
      } catch {
        setStatus("error");
        setErrorMsg("Lost connection to Space Zero.");
      }
    })();
  }, [q.ready, q.tripId, q.scenario]);

  const finished = status === "done";
  const errored = status === "error";
  const outcome = outcomeFor(mode, summary?.status);
  const success = outcome === "booked" || outcome === "resolved";
  const bookingRef =
    stages.find((s): s is Extract<StageEvent, { stage: "BOOKED" }> => s.stage === "BOOKED")?.bookingReference ??
    stages.find((s): s is Extract<StageEvent, { stage: "REBOOKED" }> => s.stage === "REBOOKED")?.bookingReference ??
    summary?.bookingReference;
  const route = summary?.route ?? "LHR → SIN → SYD";
  const staged = mode === "demo";
  const withTrip = (path: string) => (q.tripId ? `${path}?trip=${encodeURIComponent(q.tripId)}` : path);

  const eyebrow = finished
    ? (success ? "Monitoring your trip" : "Operator paused")
    : errored ? "Operator paused" : "Space Zero is working";
  const heading = finished
    ? (success ? "Your trip is running." : "This needs your attention.")
    : errored ? "I couldn't complete this run." : "Executing your trip.";
  const sub = finished
    ? (success ? "Space Zero has the journey. It stays on it in the background." : "No booking was made. Nothing was charged.")
    : errored ? "No booking was made. Nothing was charged." : "I'm putting the approved journey in place. This takes a moment.";

  return (
    <>
      <PageHeader left={<Wordmark />} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "34px 22px 60px" }}>
        <div className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--accent)" }}>
          <span className="sz-soft" style={{ width: 7, height: 7, borderRadius: 100, background: "var(--accent)" }} />
          {eyebrow}
        </div>
        <h1 style={{ marginTop: 16, fontSize: "clamp(30px,8.5vw,40px)", lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>
          {heading}
        </h1>
        <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.55, color: "var(--muted)" }}>{sub}</p>

        {/* timeline of real operational events */}
        <div style={{ marginTop: 34 }}>
          {stages.length === 0 && !errored && (
            <TimelineStep label="Starting up" detail="Connecting to the operator" status="active" last />
          )}
          {stages.map((e, i) => {
            const isLast = i === stages.length - 1;
            const stepStatus: StepStatus = !finished && isLast ? "active" : "done";
            return (
              <TimelineStep
                key={i}
                label={e.label}
                detail={detailFor(e)}
                status={stepStatus}
                last={isLast && (finished || errored)}
              />
            );
          })}
          {!finished && !errored && stages.length > 0 && (
            <TimelineStep label="Working…" status="active" last />
          )}
        </div>

        {/* error state — honest, no fake confirmation */}
        {errored && (
          <div style={{ marginTop: 8, border: "1px solid rgba(196,64,46,.4)", borderRadius: 16, background: "rgba(196,64,46,.06)", padding: 20 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--disruption-2)" }}>Run halted</div>
            <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}>{errorMsg}</p>
            <p className="mono" style={{ marginTop: 12, fontSize: 10, letterSpacing: "0.08em", color: "var(--faint)" }}>NO BOOKING WAS MADE · NOTHING WAS CHARGED</p>
          </div>
        )}

        {/* success — only when the backend confirmed a real/staged advance */}
        {finished && success && (
          <div className="sz-up" style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="sz-pop" style={{ width: 40, height: 40, borderRadius: 100, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", display: "flex" }}><Check size={20} width={2.6} /></span>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>{outcome === "resolved" ? "Resolved and monitoring." : "Booked and monitoring."}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 3 }}>
                  {bookingRef ? `Booking ${bookingRef} · ` : ""}{route}{staged ? " · staged" : ""}
                </div>
              </div>
            </div>
            <p style={{ marginTop: 15, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}>You&apos;re set. I&apos;ll watch every segment and act within your limits if anything changes. You don&apos;t need to stay here.</p>
            <Link href={withTrip("/app/trips")} className="sz-hover" style={{ ...ctaSolid, marginTop: 18 }}>View trip →</Link>
            <Link href={withTrip("/app/disruption")} className="sz-hover mono" style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)" }}>
              {staged ? "Demo: simulate a disruption" : "Monitoring"}
            </Link>
          </div>
        )}

        {/* honest non-success — stopped (over authority) or provider unavailable */}
        {finished && !success && (
          <div className="sz-up" style={{ marginTop: 8, border: "1px solid rgba(228,87,46,.4)", borderRadius: 16, background: "var(--surface)", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 100, background: "rgba(228,87,46,.14)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}><Warn /></div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>
                  {outcome === "stopped" ? "Held for your decision." : "The booking didn't complete."}
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 3 }}>{route}</div>
              </div>
            </div>
            <p style={{ marginTop: 15, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}>
              {outcome === "stopped"
                ? "The best alternative is beyond your delegated authority, so I stopped rather than overspend. No booking was made and nothing was charged."
                : "I couldn't get a confirmation from the provider, so nothing was booked and nothing was charged. Try again once the provider is available."}
            </p>
            <Link href={withTrip("/app/trips")} className="sz-hover" style={{ ...ctaSolid, marginTop: 18 }}>View trip →</Link>
          </div>
        )}
      </div>
    </>
  );
}
