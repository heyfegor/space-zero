"use client";

/**
 * Space Zero — Trips. Ported from Trips.dc.html.
 *
 * The trip-history hub: a featured active trip with live monitoring, a
 * decision-needed banner, and past trips. Data here is in-memory demo, shaped
 * so a real store (users' trips) can replace it without changing the layout.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFlow, money } from "../_lib/flow";
import { fetchMonitoring, type MonitoringView } from "../_lib/trip-client";
import { PageHeader } from "../_components/PageHeader";
import { Wordmark, BackButton, Clock, Warn, ChevronRight, Check } from "../_components/ui";

type Filter = "all" | "active" | "completed";

/** Read persisted monitoring for the active trip (null until a trip id is known). */
function useMonitoring(tripId: string | null): MonitoringView | null {
  const [view, setView] = useState<MonitoringView | null>(null);
  useEffect(() => {
    if (!tripId) { setView(null); return; }
    let cancelled = false;
    fetchMonitoring(tripId)
      .then((m) => { if (!cancelled) setView(m); })
      .catch(() => { if (!cancelled) setView(null); });
    return () => { cancelled = true; };
  }, [tripId]);
  return view;
}

/** The active-trip footer line, honest about the real monitoring state. */
function activeFooter(
  monitoring: MonitoringView | null,
  primary: { summary: string } | null,
): string {
  if (!monitoring) return "Boarding pass ready · check-in complete"; // demo
  if (monitoring.threatened && primary) return primary.summary;
  if (!monitoring.monitored) return "Not yet monitored · awaiting a confirmed booking";
  if (!monitoring.providerConfigured) return "Monitoring unavailable · flight tracker not configured";
  return "Monitoring live · no disruptions detected";
}

function relTime(iso: string | null): string {
  if (!iso) return "live";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "live";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

const PAST = [
  { city: "Lisbon", status: "RESOLVED", kind: "active", dates: "02 Sep — 06 Sep", route: "Berlin → Lisbon · direct", cost: "€340", travelers: "1 traveler", note: null as string | null },
  { city: "London", status: "COMPLETED", kind: "past", dates: "20 Aug — 24 Aug", route: "New York → London", cost: "$1,240", travelers: "1 traveler", note: "Recovered a 3h delay · +$96" },
  { city: "Paris", status: "COMPLETED", kind: "past", dates: "01 Aug — 03 Aug", route: "Madrid → Paris · direct", cost: "€210", travelers: "2 travelers", note: null },
  { city: "Tokyo", status: "COMPLETED", kind: "past", dates: "12 Jun — 24 Jun", route: "London → Tokyo Haneda", cost: "£980", travelers: "1 traveler", note: null },
];

export default function Trips() {
  const router = useRouter();
  const { authority, selectedOption } = useFlow();
  const [filter, setFilter] = useState<Filter>("all");

  // When opened with ?trip=<id>, the active trip reflects REAL persisted
  // monitoring/disruption state; without one it stays the scripted demo.
  const [tripId, setTripId] = useState<string | null>(null);
  useEffect(() => {
    try { setTripId(new URLSearchParams(window.location.search).get("trip")); } catch { setTripId(null); }
  }, []);
  const monitoring = useMonitoring(tripId);

  // Derive the monitoring pill + decision banner from real data when present.
  const atRisk = monitoring?.threatened ?? false;
  const monitorLabel = !monitoring
    ? "Monitoring · live"
    : atRisk
      ? "At risk · action needed"
      : monitoring.monitored && !monitoring.providerConfigured
        ? "Monitoring · unavailable"
        : monitoring.monitored
          ? "Monitoring · live"
          : "Not yet monitored";
  const primaryDisruption = monitoring?.disruptions.find((d) => d.threatensTrip) ?? null;
  const openActive = () => router.push(tripId ? `/app/disruption?trip=${encodeURIComponent(tripId)}` : "/app/execution");

  const showActive = filter === "all" || filter === "active";
  let past = PAST;
  if (filter === "completed") past = PAST.filter((t) => t.kind === "past");
  if (filter === "active") past = [];

  return (
    <>
      <PageHeader left={<div style={{ display: "flex", alignItems: "center", gap: 11 }}><BackButton href="/app" /><Wordmark /></div>} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "26px 20px 60px" }}>
        <h1 style={{ fontSize: "clamp(32px,9vw,44px)", lineHeight: 1, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>Trips</h1>
        <p style={{ marginTop: 10, fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>1 active · 5 completed this year</p>

        <div style={{ marginTop: 20, display: "flex", gap: 7 }}>
          {(["all", "active", "completed"] as Filter[]).map((f) => {
            const on = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)} className="sz-hover mono" style={{ background: on ? "var(--ink)" : "transparent", border: `1px solid ${on ? "var(--ink)" : "var(--line)"}`, color: on ? "var(--bg)" : "var(--muted)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", padding: "8px 14px", borderRadius: 100, cursor: "pointer", fontFamily: "inherit" }}>{f}</button>
            );
          })}
        </div>

        {/* ACTIVE TRIP */}
        {showActive && (
          <div className="sz-up sz-row sz-hover" onClick={openActive} style={{ marginTop: 22, border: "1px solid var(--line)", borderRadius: 18, background: "var(--surface)", overflow: "hidden", cursor: "pointer" }}>
            <div style={{ padding: "20px 20px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="mono" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: atRisk ? "var(--accent)" : monitoring && !monitoring.providerConfigured ? "var(--muted-2)" : "var(--accent)" }}>
                    <span className="sz-soft" style={{ width: 6, height: 6, borderRadius: 100, background: atRisk ? "var(--accent)" : "var(--muted-2)" }} />{monitorLabel}
                  </div>
                  <div style={{ marginTop: 12, fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, color: "var(--ink)" }}>Sydney</div>
                  <div className="mono" style={{ marginTop: 9, fontSize: 12, letterSpacing: "0.02em", color: "var(--muted-2)" }}>04 Sep — 18 Sep · 1 traveler</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="mono" style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)" }}>Total</div>
                  <div className="mono" style={{ marginTop: 5, fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>{money(selectedOption.cost)}</div>
                  <div className="mono" style={{ marginTop: 3, fontSize: 10, letterSpacing: "0.04em", color: "var(--faint)" }}>of {money(authority.budget)}</div>
                </div>
              </div>
              <div className="mono" style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, fontSize: 12, letterSpacing: "0.02em", color: "var(--muted)", flexWrap: "wrap" }}>
                <span style={{ color: "var(--ink-2)" }}>LHR</span><span style={{ color: "var(--faint)" }}>→</span><span style={{ color: "var(--ink-2)" }}>SIN</span><span style={{ color: "var(--faint)" }}>→</span><span style={{ color: "var(--ink-2)" }}>SYD</span>
                <span style={{ color: "var(--line-3)" }}>·</span><span>{selectedOption.duration}</span><span style={{ color: "var(--line-3)" }}>·</span><span>{selectedOption.stops}</span>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--line-2)", padding: "14px 20px", display: "flex", alignItems: "center", gap: 11, background: "var(--surface-2)" }}>
              <span style={{ color: atRisk ? "var(--accent)" : "var(--muted-2)", flexShrink: 0, display: "flex" }}>{atRisk ? <Warn /> : <Clock size={15} />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-2)", lineHeight: 1.35 }}>{activeFooter(monitoring, primaryDisruption)}</div>
              </div>
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--faint)", flexShrink: 0 }}>{monitoring ? relTime(monitoring.lastDisruptionAt) : "2h ago"}</span>
            </div>
          </div>
        )}

        {/* DECISION NEEDED — real disruption when a trip is in context, else demo */}
        {showActive && tripId && atRisk && primaryDisruption && (
          <div className="sz-row sz-hover" onClick={() => router.push(`/app/disruption?trip=${encodeURIComponent(tripId)}`)} style={{ marginTop: 12, border: "1px solid rgba(228,87,46,.45)", borderRadius: 16, background: "var(--surface)", padding: "16px 18px", display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }}>
            <div style={{ width: 32, height: 32, borderRadius: 100, background: "rgba(228,87,46,.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--accent)" }}><Warn /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>Disruption detected</div>
              <div style={{ marginTop: 4, fontSize: 14, fontWeight: 500, color: "var(--ink)", lineHeight: 1.35 }}>{primaryDisruption.summary} · flagged for recovery</div>
            </div>
            <span style={{ color: "var(--muted-2)", flexShrink: 0, display: "flex" }}><ChevronRight /></span>
          </div>
        )}
        {showActive && !tripId && (
          <div className="sz-row sz-hover" onClick={() => router.push("/app/resolution")} style={{ marginTop: 12, border: "1px solid rgba(228,87,46,.45)", borderRadius: 16, background: "var(--surface)", padding: "16px 18px", display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }}>
            <div style={{ width: 32, height: 32, borderRadius: 100, background: "rgba(228,87,46,.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--accent)" }}><Warn /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>Your decision is needed</div>
              <div style={{ marginTop: 4, fontSize: 14, fontWeight: 500, color: "var(--ink)", lineHeight: 1.35 }}>Reykjavík · alternative exceeds recovery allowance by £80</div>
            </div>
            <span style={{ color: "var(--muted-2)", flexShrink: 0, display: "flex" }}><ChevronRight /></span>
          </div>
        )}

        {/* PAST TRIPS */}
        <div style={{ marginTop: 34 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--faint)", paddingBottom: 4 }}>{filter === "completed" ? "Completed" : "Earlier"}</div>
          {past.map((t) => (
            <div key={t.city} className="sz-row sz-hover" style={{ padding: "20px 2px", borderTop: "1px solid var(--line-2)", cursor: "default", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--ink)" }}>{t.city}</span>
                  <span className="mono" style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: t.status === "RESOLVED" ? "var(--accent)" : "var(--muted-2)", border: `1px solid ${t.status === "RESOLVED" ? "rgba(228,87,46,.4)" : "var(--line-3)"}`, borderRadius: 100, padding: "3px 9px" }}>{t.status}</span>
                </div>
                <div className="mono" style={{ marginTop: 9, fontSize: 11, letterSpacing: "0.04em", color: "var(--muted-2)" }}>{t.dates}</div>
                <div className="mono" style={{ marginTop: 5, fontSize: 11, letterSpacing: "0.02em", color: "var(--faint)" }}>{t.route}</div>
                {t.note && (
                  <div style={{ marginTop: 9, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
                    <span style={{ color: "var(--accent)", display: "flex" }}><Check size={13} width={2} /></span>
                    <span>{t.note}</span>
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{t.cost}</div>
                <div className="mono" style={{ marginTop: 4, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)" }}>{t.travelers}</div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={() => router.push("/app")} className="sz-hover" style={{ marginTop: 30, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: "transparent", color: "var(--ink)", fontWeight: 600, fontSize: 14, padding: 16, border: "1px dashed var(--line)", borderRadius: 14, cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          Brief a new trip
        </button>
      </div>
    </>
  );
}
