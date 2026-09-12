"use client";

/**
 * Space Zero — Disruption.
 *
 * When opened with ?trip=<id> the screen shows REAL persisted monitoring:
 * disruptions detected by the deterministic backend for the booked itinerary,
 * read from /api/trips/[id]/monitor. It renders honest states — monitoring
 * unavailable when the flight-status provider is not configured, "no disruption"
 * when the trip is holding, and the detected disruption when one threatens the
 * trip. It never fabricates a recovery alternative here: automatic recovery is
 * not implemented yet, so it says so plainly and points to the recovery flow.
 *
 * Without a trip in context it falls back to the original scripted demo of the
 * LHR → SIN → SYD disruption (approved Disruption.dc.html design preserved).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFlow, money } from "../_lib/flow";
import { fetchMonitoring, runRecovery, type MonitoringView, type ApiRecovery } from "../_lib/trip-client";
import { PageHeader } from "../_components/PageHeader";
import { TimelineStep, type StepStatus } from "../_components/TimelineStep";
import { Wordmark, Alert, Clock, Check, Warn, ctaSolid } from "../_components/ui";

export default function Disruption() {
  const [q, setQ] = useState<{ ready: boolean; id: string | null }>({ ready: false, id: null });
  useEffect(() => {
    try { setQ({ ready: true, id: new URLSearchParams(window.location.search).get("trip") }); }
    catch { setQ({ ready: true, id: null }); }
  }, []);

  if (!q.ready) {
    return (
      <>
        <PageHeader back="/app/execution" center={<Wordmark />} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 20px" }}>
          <span className="sz-spin" style={{ width: 26, height: 26, borderRadius: 100, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
        </div>
      </>
    );
  }
  return q.id ? <DisruptionReal tripId={q.id} /> : <DisruptionDemo />;
}

// --- Real persisted monitoring/disruption view ------------------------------

const monoLabel: React.CSSProperties = { fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase" };

function DisruptionReal({ tripId }: { tripId: string }) {
  const [view, setView] = useState<MonitoringView | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = `/app/trips?trip=${encodeURIComponent(tripId)}`;

  const load = useCallback(async () => {
    try {
      const m = await fetchMonitoring(tripId);
      setView(m);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load monitoring.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { void load(); }, [load]);

  const recover = useCallback(async () => {
    setRecovering(true);
    setError(null);
    try {
      await runRecovery(tripId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Recovery could not run right now.");
    } finally {
      setRecovering(false);
    }
  }, [tripId, load]);

  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader back={back} center={<Wordmark />} />
      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "32px 22px 130px" }}>{children}</div>
    </>
  );

  if (loading) {
    return shell(
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0" }}>
        <span className="sz-spin" style={{ width: 26, height: 26, borderRadius: 100, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
      </div>,
    );
  }
  if (error || !view) {
    return shell(<p className="mono" style={{ fontSize: 13, color: "var(--warm)" }}>{error ?? "That trip could not be loaded."}</p>);
  }

  const threatening = view.disruptions.filter((d) => d.threatensTrip);
  const primary = threatening[0] ?? view.disruptions[0] ?? null;

  // Header eyebrow reflects the real trip state.
  const eyebrow = view.threatened ? "Resolving a disruption" : "Monitoring your trip";

  return shell(
    <>
      <div className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: view.threatened ? "var(--accent)" : "var(--muted-2)" }}>
        <span className="sz-soft" style={{ width: 7, height: 7, borderRadius: 100, background: view.threatened ? "var(--accent)" : "var(--muted-2)" }} />
        {eyebrow}
      </div>

      {/* Honest: no configured flight-status provider → nothing fabricated. */}
      {!view.monitored ? (
        <>
          <h1 style={headingStyle}>This trip isn&apos;t being monitored yet.</h1>
          <p style={paraStyle}>Monitoring begins once a booking is confirmed. There is nothing to watch on this trip yet.</p>
        </>
      ) : !view.providerConfigured && view.disruptions.length === 0 ? (
        <>
          <h1 style={headingStyle}>Monitoring is unavailable.</h1>
          <div className="sz-up" style={{ marginTop: 24, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: 18 }}>
            <div className="mono" style={{ ...monoLabel, color: "var(--faint)" }}>Flight tracker not configured</div>
            <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>
              No flight-status provider is connected, so live status cannot be checked. Space Zero will not fabricate a status — set <span className="mono" style={{ color: "var(--ink)" }}>FLIGHTAWARE_API_KEY</span> to monitor this trip for real.
            </p>
          </div>
        </>
      ) : !view.threatened ? (
        <>
          <h1 style={headingStyle}>Your trip is on track.</h1>
          <div className="sz-up" style={{ marginTop: 24, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: 18, display: "flex", gap: 13, alignItems: "flex-start" }}>
            <span style={{ color: "var(--muted-2)", flexShrink: 0, marginTop: 2 }}><Clock size={18} /></span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>No disruptions detected</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 5 }}>
                Monitoring live · {view.lastDisruptionAt ? `last change ${when(view.lastDisruptionAt)}` : "the booked journey still meets your requirement"}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <h1 style={headingStyle}>Something changed on your trip.</h1>

          {/* event — driven by the real persisted disruption */}
          {primary && (
            <div className="sz-up" style={{ marginTop: 24, border: "1px solid rgba(228,87,46,.4)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
              <div style={{ padding: 18, display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}><Alert /></span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{primary.summary}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 5 }}>
                    {primary.from} → {primary.to}
                    {primary.flightNumber ? ` · ${primary.flightNumber}` : ""}
                    {primary.delayMinutes > 0 ? ` · ${durationLabel(primary.delayMinutes)} late` : ""}
                    {" · reported by the flight tracker"}
                  </div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--line-2)", padding: "15px 18px", background: "var(--surface-2)" }}>
                <div className="mono" style={{ ...monoLabel, color: "var(--faint)" }}>Consequence</div>
                <div style={{ marginTop: 6, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.45 }}>{primary.detail}</div>
              </div>
            </div>
          )}

          {/* any additional detected disruptions */}
          {threatening.length > 1 && (
            <div className="mono" style={{ marginTop: 14, fontSize: 12, color: "var(--muted-2)" }}>
              +{threatening.length - 1} more affected {threatening.length - 1 === 1 ? "segment" : "segments"} on this trip.
            </div>
          )}

          {/* recovery outcome — real persisted result, or trigger it now */}
          {view.recovery ? (
            <RecoveryPanel recovery={view.recovery} />
          ) : (
            <div className="sz-up" style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: 18 }}>
              <div className="mono" style={{ ...monoLabel, color: "var(--accent)" }}>Trip now {view.tripStatus.replace("_", " ").toLowerCase()}</div>
              <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>
                This disruption has flagged your trip for recovery. I&apos;ll search alternatives, check them against your arrival requirement and authority, and rebook if one is within your allowance.
              </p>
            </div>
          )}

          {error && <p className="mono" style={{ marginTop: 12, fontSize: 12, color: "var(--warm)" }}>{error}</p>}

          {view.recovery ? (
            <Link href={`/app/resolution?trip=${encodeURIComponent(tripId)}`} className="sz-hover" style={{ ...ctaSolid, marginTop: 16 }}>See resolution →</Link>
          ) : (
            <button onClick={recover} disabled={recovering} className="sz-hover" style={{ ...ctaSolid, marginTop: 16, opacity: recovering ? 0.8 : 1, cursor: recovering ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              {recovering && <span className="sz-spin" style={{ width: 16, height: 16, borderRadius: 100, border: "2px solid var(--bg)", borderTopColor: "transparent" }} />}
              {recovering ? "Recovering…" : "Recover now →"}
            </button>
          )}
        </>
      )}
    </>,
  );
}

/** The persisted recovery outcome, in the approved card design. */
function RecoveryPanel({ recovery }: { recovery: ApiRecovery }) {
  const c = recovery.currency;
  if (recovery.status === "RECOVERED") {
    return (
      <div className="sz-up" style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", display: "flex", gap: 12, alignItems: "flex-start", background: "var(--surface-2)", borderBottom: "1px solid var(--line-2)" }}>
          <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}><Check size={18} width={2.4} /></span>
          <div>
            <div className="mono" style={{ ...monoLabel, color: "var(--accent)" }}>Recovered within authority</div>
            <div style={{ marginTop: 6, fontSize: 15, lineHeight: 1.5, color: "var(--ink)" }}>{recovery.reason}</div>
          </div>
        </div>
        <div className="mono" style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12, color: "var(--muted-2)" }}>
          <span>New arrival <span style={{ color: "var(--ink)", fontWeight: 700 }}>{recovery.newArrivalLabel ?? "—"}</span></span>
          <span>Extra cost <span style={{ color: "var(--ink)", fontWeight: 700 }}>+{money(recovery.additionalCost, c)}</span></span>
        </div>
      </div>
    );
  }
  return (
    <div className="sz-up" style={{ marginTop: 16, border: "1px solid rgba(228,87,46,.4)", borderRadius: 16, background: "var(--surface)", padding: 18 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}><Warn /></span>
        <div>
          <div className="mono" style={{ ...monoLabel, color: "var(--accent)" }}>Your decision is needed</div>
          <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>{recovery.reason}</p>
          {recovery.overBy != null && recovery.overBy > 0 && (
            <div className="mono" style={{ marginTop: 10, fontSize: 12, color: "var(--muted-2)" }}>{money(recovery.overBy, c)} over your limit</div>
          )}
        </div>
      </div>
    </div>
  );
}

const headingStyle: React.CSSProperties = { marginTop: 16, fontSize: "clamp(30px,8.5vw,40px)", lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" };
const paraStyle: React.CSSProperties = { marginTop: 16, fontSize: 15, lineHeight: 1.55, color: "var(--muted)" };

function durationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function when(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "just now";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// --- Scripted demo (no trip in context; approved Disruption.dc.html design) --

const STEPS = [
  { label: "Finding alternatives", detail: "Routes that still land before your deadline" },
  { label: "Comparing on cost and arrival", detail: "Ranking against your original trip" },
  { label: "Checking your authority", detail: "Testing cost against your recovery allowance" },
];

function DisruptionDemo() {
  const { authority, intent } = useFlow();
  const allowance = authority.recoveryAllowance;
  const recoveryCost = 96; // deterministic demo, matches the backend fixture
  const [step, setStep] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s >= STEPS.length) { if (timer.current) clearInterval(timer.current); return s; }
        return s + 1;
      });
    }, 1400);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const finished = step >= STEPS.length;

  return (
    <>
      <PageHeader back="/app/execution" center={<Wordmark />} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "32px 22px 130px" }}>
        <div className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--accent)" }}>
          <span className="sz-soft" style={{ width: 7, height: 7, borderRadius: 100, background: "var(--accent)" }} />
          Resolving a disruption
        </div>
        <h1 style={{ marginTop: 16, fontSize: "clamp(30px,8.5vw,40px)", lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>Something changed on your trip.</h1>

        {/* event */}
        <div className="sz-up" style={{ marginTop: 24, border: "1px solid rgba(228,87,46,.4)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ padding: 18, display: "flex", gap: 13, alignItems: "flex-start" }}>
            <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}><Alert /></span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>Flight SQ317 delayed 3 hours</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 5 }}>Now departs 23:10 · was 20:10 · reported by the flight tracker</div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--line-2)", padding: "15px 18px", background: "var(--surface-2)" }}>
            <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--faint)" }}>Consequence</div>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.45 }}>Your connection <span className="mono" style={{ color: "var(--ink)" }}>SIN → SYD</span> is no longer reachable. The booked journey no longer meets your trip.</div>
          </div>
        </div>

        {/* objective reminder */}
        <div className="sz-up" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 11, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)", padding: "13px 16px" }}>
          <span style={{ color: "var(--muted-2)", flexShrink: 0, display: "flex" }}><Clock size={16} /></span>
          <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>Still holding your requirement: <span style={{ color: "var(--ink)" }}>{intent.arriveBy.toLowerCase()}</span></div>
        </div>

        {/* operational steps */}
        <div className="mono" style={{ marginTop: 26, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--faint)" }}>What I&apos;m doing</div>
        <div style={{ marginTop: 12 }}>
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step && !finished;
            const stepStatus: StepStatus = done ? "done" : active ? "active" : "pending";
            return <TimelineStep key={i} label={s.label} detail={s.detail} status={stepStatus} last={i === STEPS.length - 1} />;
          })}
        </div>

        {/* outcome preview */}
        {finished && (
          <>
            <div className="sz-up" style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: 18 }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>Best alternative found</div>
              <div style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: "var(--ink)" }}>Rebook SIN → SYD on SQ231. Arrives <span className="mono" style={{ fontWeight: 700 }}>08:40 Sun</span>, still before your deadline.</div>
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 14, borderTop: "1px solid var(--line-2)" }}>
                <div className="mono" style={{ fontSize: 12, color: "var(--muted-2)" }}>Extra cost <span style={{ color: "var(--ink)", fontWeight: 700 }}>+{money(recoveryCost)}</span></div>
                <div className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>within {money(allowance)} allowance</div>
              </div>
            </div>
            <Link href="/app/resolution" className="sz-hover" style={{ ...ctaSolid, marginTop: 16 }}>See resolution →</Link>
          </>
        )}
      </div>
    </>
  );
}
