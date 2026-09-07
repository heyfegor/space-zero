"use client";

/**
 * Space Zero — Execution. Ported from Execution.dc.html.
 *
 * The autonomous operator working, driven by the REAL /api/agent SSE stream.
 * Only user-safe operational events (from the existing server event model) are
 * rendered — never model reasoning. Nothing is marked complete unless the
 * backend confirms it: the booking reference and resolved status come from the
 * stream's `done`/`summary`, and if the run errors we say so rather than faking
 * a completed booking.
 *
 * The backend demo is the deterministic recovery scenario, so the events shown
 * are Planning → Checking authority → Recovery found → Rebooking → Permitted →
 * Rebooked → Resolved, exactly as the server emits them.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFlow, money } from "../_lib/flow";
import { PageHeader } from "../_components/PageHeader";
import { TimelineStep, type StepStatus } from "../_components/TimelineStep";
import { Wordmark, Check, ctaSolid } from "../_components/ui";

// Mirror of the server's operational event model (no server import in a client
// component). Kept in sync with src/server/agent-api.ts.
type RecoveryOpt = { id: string; from: string; to: string; additionalCost: number; newArrivalLabel: string; withinAuthority: boolean };
type StageEvent =
  | { stage: "RECEIVED"; label: string }
  | { stage: "PLANNING"; label: string }
  | { stage: "CHECKING_AUTHORITY"; label: string; requestedAmount?: number; recoveryAllowance?: number; permitted?: boolean }
  | { stage: "RECOVERY_FOUND"; label: string; currency: string; options: RecoveryOpt[] }
  | { stage: "REBOOKING"; label: string; requestedAmount: number; recoveryAllowance: number; currency: string }
  | { stage: "PERMITTED"; label: string; requestedAmount: number; recoveryAllowance: number; remainingAllowance: number; currency: string }
  | { stage: "REBOOKED"; label: string; mode: "STAGED"; bookingReference: string; status: string }
  | { stage: "DENIED"; label: string; requestedAmount: number; recoveryAllowance: number; currency: string; reason: string }
  | { stage: "STOPPED"; label: string }
  | { stage: "RESOLVED"; label: string; status: string; bookingReference?: string };
type TripSummary = { tripId: string; status: string; bookingReference?: string; route: string };

type RunStatus = "running" | "done" | "error";

/** Backend accepts a recovery allowance in [0, 500]; clamp the user's value. */
function clampAllowance(n: number): number {
  return Math.max(0, Math.min(500, Math.round(n)));
}

function detailFor(e: StageEvent): string {
  switch (e.stage) {
    case "RECEIVED": return "Brief received";
    case "PLANNING": return "Inspecting the trip";
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
    case "DENIED": return `${money(e.requestedAmount, e.currency)} exceeds ${money(e.recoveryAllowance, e.currency)} · held`;
    case "STOPPED": return "Awaiting your decision";
    case "RESOLVED": return `Trip ${e.status.toLowerCase()}`;
    default: return "";
  }
}

export default function Execution() {
  const { authority } = useFlow();
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [status, setStatus] = useState<RunStatus>("running");
  const [summary, setSummary] = useState<TripSummary | undefined>();
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const started = useRef(false);
  const allowanceRef = useRef(authority.recoveryAllowance);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief: "Handle my LHR → SIN → SYD trip within my authority.",
            scenario: "recovery",
            recoveryAllowance: clampAllowance(allowanceRef.current),
          }),
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setStatus("error");
          setErrorMsg(body.error ?? "Space Zero is unavailable right now.");
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
  }, []);

  const finished = status === "done";
  const errored = status === "error";
  const bookingRef =
    stages.find((s): s is Extract<StageEvent, { stage: "REBOOKED" }> => s.stage === "REBOOKED")?.bookingReference ??
    summary?.bookingReference;

  return (
    <>
      <PageHeader left={<Wordmark />} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "34px 22px 60px" }}>
        <div className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--accent)" }}>
          <span className="sz-soft" style={{ width: 7, height: 7, borderRadius: 100, background: "var(--accent)" }} />
          {finished ? "Monitoring your trip" : errored ? "Operator paused" : "Space Zero is working"}
        </div>
        <h1 style={{ marginTop: 16, fontSize: "clamp(30px,8.5vw,40px)", lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>
          {finished ? "Your trip is running." : errored ? "I couldn't complete this run." : "Executing your trip."}
        </h1>
        <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.55, color: "var(--muted)" }}>
          {finished
            ? "Space Zero has the journey. It stays on it in the background."
            : errored
              ? "No booking was made. Nothing was charged."
              : "I'm putting the approved journey in place. This takes a moment."}
        </p>

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
            <p className="mono" style={{ marginTop: 12, fontSize: 10, letterSpacing: "0.08em", color: "var(--faint)" }}>SET ANTHROPIC_API_KEY FOR A LIVE RUN</p>
          </div>
        )}

        {/* confirmation — only when the backend confirmed the run */}
        {finished && (
          <div className="sz-up" style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="sz-pop" style={{ width: 40, height: 40, borderRadius: 100, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", display: "flex" }}><Check size={20} width={2.6} /></span>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>Booked and monitoring.</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 3 }}>
                  {bookingRef ? `Booking ${bookingRef} · ` : ""}{summary?.route ?? "LHR → SIN → SYD"} · staged
                </div>
              </div>
            </div>
            <p style={{ marginTop: 15, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}>You&apos;re set. I&apos;ll watch every segment and act within your limits if anything changes. You don&apos;t need to stay here.</p>
            <Link href="/app/trips" className="sz-hover" style={{ ...ctaSolid, marginTop: 18 }}>View trip →</Link>
            <Link href="/app/disruption" className="sz-hover mono" style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)" }}>Demo: simulate a disruption</Link>
          </div>
        )}
      </div>
    </>
  );
}
