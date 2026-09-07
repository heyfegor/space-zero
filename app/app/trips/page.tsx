"use client";

/**
 * Space Zero — Trips. Ported from Trips.dc.html.
 *
 * The trip-history hub: a featured active trip with live monitoring, a
 * decision-needed banner, and past trips. Data here is in-memory demo, shaped
 * so a real store (users' trips) can replace it without changing the layout.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFlow, money } from "../_lib/flow";
import { PageHeader } from "../_components/PageHeader";
import { Wordmark, BackButton, Clock, Warn, ChevronRight, Check } from "../_components/ui";

type Filter = "all" | "active" | "completed";

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
          <div className="sz-up sz-row sz-hover" onClick={() => router.push("/app/execution")} style={{ marginTop: 22, border: "1px solid var(--line)", borderRadius: 18, background: "var(--surface)", overflow: "hidden", cursor: "pointer" }}>
            <div style={{ padding: "20px 20px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="mono" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>
                    <span className="sz-soft" style={{ width: 6, height: 6, borderRadius: 100, background: "var(--accent)" }} />Monitoring · live
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
              <span style={{ color: "var(--accent)", flexShrink: 0, display: "flex" }}><Clock size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-2)", lineHeight: 1.35 }}>Boarding pass ready · check-in complete</div>
              </div>
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--faint)", flexShrink: 0 }}>2h ago</span>
            </div>
          </div>
        )}

        {/* DECISION NEEDED */}
        {showActive && (
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
