"use client";

/**
 * Space Zero — Resolution.
 *
 * With ?trip=<id> the screen shows the REAL persisted recovery outcome for the
 * trip (read from /api/trips/[id]/monitor): RECOVERED (rebooked within authority
 * — before/after arrival, extra cost, new total, provider reference) or ESCALATED
 * (over authority/funding, auto-recovery off, or no eligible option — the reason
 * and the amount over). Nothing is shown as booked unless a provider confirmed it.
 *
 * Without a trip in context it falls back to the original two-outcome demo
 * (approved Resolution.dc.html design preserved).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFlow, money } from "../_lib/flow";
import { fetchMonitoring, type ApiRecovery } from "../_lib/trip-client";
import { PageHeader } from "../_components/PageHeader";
import { Wordmark, Check, Warn, ctaSolid, ctaAccent } from "../_components/ui";

export default function Resolution() {
  const [q, setQ] = useState<{ ready: boolean; id: string | null }>({ ready: false, id: null });
  useEffect(() => {
    try { setQ({ ready: true, id: new URLSearchParams(window.location.search).get("trip") }); }
    catch { setQ({ ready: true, id: null }); }
  }, []);

  if (!q.ready) {
    return (
      <>
        <PageHeader back="/app/disruption" center={<Wordmark />} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 20px" }}>
          <span className="sz-spin" style={{ width: 26, height: 26, borderRadius: 100, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
        </div>
      </>
    );
  }
  return q.id ? <ResolutionReal tripId={q.id} /> : <ResolutionDemo />;
}

// --- Real persisted recovery outcome ----------------------------------------

function ResolutionReal({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [recovery, setRecovery] = useState<ApiRecovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const back = `/app/disruption?trip=${encodeURIComponent(tripId)}`;

  useEffect(() => {
    let cancelled = false;
    fetchMonitoring(tripId)
      .then((m) => { if (!cancelled) setRecovery(m.recovery); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the recovery."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tripId]);

  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader back={back} center={<Wordmark />} />
      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "36px 22px 60px" }}>{children}</div>
    </>
  );

  if (loading) {
    return shell(
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0" }}>
        <span className="sz-spin" style={{ width: 26, height: 26, borderRadius: 100, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
      </div>,
    );
  }
  if (error) return shell(<p className="mono" style={{ fontSize: 13, color: "var(--warm)" }}>{error}</p>);

  if (!recovery) {
    return shell(
      <div className="sz-up">
        <h1 style={{ fontSize: "clamp(30px,8.5vw,42px)", lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>No recovery yet.</h1>
        <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.5, color: "var(--ink-2)" }}>Nothing has needed recovery on this trip. If a disruption is detected, Space Zero will search alternatives and act within your authority.</p>
        <button onClick={() => router.push(back)} className="sz-hover" style={{ ...ctaSolid, marginTop: 26 }}>Back to monitoring →</button>
      </div>,
    );
  }

  const c = recovery.currency;

  if (recovery.status === "RECOVERED") {
    return shell(
      <div className="sz-up">
        <div className="sz-pop" style={{ width: 60, height: 60, borderRadius: 100, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", display: "flex" }}><Check size={30} width={2.6} /></span>
        </div>
        <h1 style={{ marginTop: 24, fontSize: "clamp(38px,11vw,56px)", lineHeight: 0.98, fontWeight: 700, letterSpacing: "-0.04em", color: "var(--ink)" }}>Resolved.</h1>
        <p style={{ marginTop: 16, fontSize: 17, lineHeight: 1.5, color: "var(--ink-2)" }}>{recovery.reason}</p>

        <div style={{ marginTop: 26, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--faint)" }}>Was</div>
              <div className="mono" style={{ marginTop: 6, fontSize: 14, color: "var(--muted-2)", textDecoration: "line-through" }}>arrive {recovery.previousArrivalLabel ?? "—"}</div>
            </div>
            <span className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", border: "1px solid var(--line-3)", borderRadius: 100, padding: "4px 9px" }}>Disrupted</span>
          </div>
          <div style={{ padding: "16px 18px", borderTop: "1px solid var(--line-2)", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>Now</div>
              <div className="mono" style={{ marginTop: 6, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{recovery.from} → {recovery.to} · arrive {recovery.newArrivalLabel ?? "—"}</div>
            </div>
            <span style={{ color: "var(--accent)", display: "flex" }}><Check size={20} width={2.4} /></span>
          </div>
        </div>

        <div className="mono" style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--muted-2)", borderTop: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)", padding: "14px 2px" }}>
          <span>Extra cost</span>
          <span style={{ color: "var(--ink)", fontWeight: 700, fontSize: 15 }}>+{money(recovery.additionalCost, c)}</span>
        </div>
        {recovery.finalCost != null && (
          <div className="mono" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--muted-2)", borderBottom: "1px solid var(--line-2)", padding: "14px 2px" }}>
            <span>New total</span>
            <span style={{ color: "var(--ink)", fontWeight: 700, fontSize: 15 }}>{money(recovery.finalCost, c)}</span>
          </div>
        )}
        {recovery.bookingReference && (
          <div className="mono" style={{ marginTop: 12, fontSize: 11, letterSpacing: "0.04em", color: "var(--faint)" }}>Provider reference {recovery.bookingReference}</div>
        )}

        <button onClick={() => router.push(`/app/trips?trip=${encodeURIComponent(tripId)}`)} className="sz-hover" style={{ ...ctaSolid, marginTop: 26 }}>View updated trip →</button>
      </div>,
    );
  }

  // ESCALATED
  return shell(
    <div className="sz-up">
      <div className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--accent)" }}>
        <span style={{ color: "var(--accent)", display: "flex" }}><Warn /></span>
        Your decision is needed
      </div>
      <h1 style={{ marginTop: 16, fontSize: "clamp(30px,8.5vw,42px)", lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>{escalationHeadline(recovery.escalationReason)}</h1>
      <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.5, color: "var(--ink-2)" }}>{recovery.reason}</p>

      {recovery.newArrivalLabel && (
        <div style={{ marginTop: 24, border: "1.5px solid rgba(228,87,46,.4)", borderRadius: 16, background: "var(--surface)", padding: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>Best alternative · {recovery.from} → {recovery.to}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 5 }}>arrives {recovery.newArrivalLabel}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>+{money(recovery.additionalCost, c)}</div>
              {recovery.overBy != null && recovery.overBy > 0 && (
                <div className="mono" style={{ fontSize: 10, color: "var(--faint)", marginTop: 3 }}>{money(recovery.overBy, c)} over your limit</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={() => router.push(`/app/trips?trip=${encodeURIComponent(tripId)}`)} className="sz-hover" style={ctaAccent}>Review and decide</button>
        <button onClick={() => router.push(back)} className="sz-hover" style={{ width: "100%", background: "transparent", color: "var(--ink)", fontWeight: 600, fontSize: 14, padding: 15, border: "1px solid var(--line)", borderRadius: 100, cursor: "pointer" }}>Back to the disruption</button>
      </div>
    </div>,
  );
}

function escalationHeadline(reason: ApiRecovery["escalationReason"]): string {
  switch (reason) {
    case "OVER_ALLOWANCE": return "This one is above your limit.";
    case "INSUFFICIENT_FUNDING": return "This needs more funds.";
    case "OVER_BUDGET": return "This is over your trip budget.";
    case "AUTO_RECOVERY_DISABLED": return "This one needs your approval.";
    case "NO_ELIGIBLE_OPTION": return "No option still meets your trip.";
    default: return "Your decision is needed.";
  }
}

// --- Scripted demo (no trip in context; approved Resolution.dc.html design) --

type View = "resolved" | "escalated";

function ResolutionDemo() {
  const router = useRouter();
  const { authority, selectedOption } = useFlow();
  const [view, setView] = useState<View>("resolved");
  const allowance = authority.recoveryAllowance;
  const recoveryCost = 96;
  const newTotal = selectedOption.cost + recoveryCost;

  const toggle = (
    <div className="mono" style={{ display: "flex", gap: 4, border: "1px solid var(--line)", borderRadius: 100, padding: 3 }}>
      <button onClick={() => setView("resolved")} className="sz-hover" style={segBtn(view === "resolved")}>Resolved</button>
      <button onClick={() => setView("escalated")} className="sz-hover" style={segBtn(view === "escalated")}>Escalated</button>
    </div>
  );

  return (
    <>
      <PageHeader back="/app/disruption" center={toggle} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "36px 22px 60px" }}>
        {view === "resolved" ? (
          <div className="sz-up">
            <div className="sz-pop" style={{ width: 60, height: 60, borderRadius: 100, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", display: "flex" }}><Check size={30} width={2.6} /></span>
            </div>
            <h1 style={{ marginTop: 24, fontSize: "clamp(38px,11vw,56px)", lineHeight: 0.98, fontWeight: 700, letterSpacing: "-0.04em", color: "var(--ink)" }}>Resolved.</h1>
            <p style={{ marginTop: 16, fontSize: 17, lineHeight: 1.5, color: "var(--ink-2)" }}>
              Your flight was delayed 3 hours and the connection no longer worked. I rebooked you for <span className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{money(recoveryCost)}</span> more, within your <span className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{money(allowance)}</span> recovery allowance.
            </p>

            <div style={{ marginTop: 26, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
              <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--faint)" }}>Was</div>
                  <div className="mono" style={{ marginTop: 6, fontSize: 14, color: "var(--muted-2)", textDecoration: "line-through" }}>SQ221 · arrive 07:05 Sun</div>
                </div>
                <span className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", border: "1px solid var(--line-3)", borderRadius: 100, padding: "4px 9px" }}>Missed</span>
              </div>
              <div style={{ padding: "16px 18px", borderTop: "1px solid var(--line-2)", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>Now</div>
                  <div className="mono" style={{ marginTop: 6, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>SQ231 · arrive 08:40 Sun</div>
                </div>
                <span style={{ color: "var(--accent)", display: "flex" }}><Check size={20} width={2.4} /></span>
              </div>
            </div>

            <div className="mono" style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--muted-2)", borderTop: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)", padding: "14px 2px" }}>
              <span>New total <span style={{ color: "var(--faint)" }}>(staged)</span></span>
              <span style={{ color: "var(--ink)", fontWeight: 700, fontSize: 15 }}>{money(newTotal)}</span>
            </div>

            <button onClick={() => router.push("/app/trips")} className="sz-hover" style={{ ...ctaSolid, marginTop: 26 }}>View updated trip →</button>
          </div>
        ) : (
          <div className="sz-up">
            <div className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--accent)" }}>
              <span style={{ color: "var(--accent)", display: "flex" }}><Warn /></span>
              Your decision is needed
            </div>
            <h1 style={{ marginTop: 16, fontSize: "clamp(30px,8.5vw,42px)", lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>This one is above your limit.</h1>
            <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.5, color: "var(--ink-2)" }}>
              Every option that still lands before your deadline costs more than your <span className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{money(allowance)}</span> recovery allowance. I will not spend past it without you.
            </p>

            <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ border: "1.5px solid rgba(228,87,46,.4)", borderRadius: 16, background: "var(--surface)", padding: 18 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>Rebook via Doha</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 5 }}>QR flight · arrives 08:20 Sun</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>+{money(230)}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--faint)", marginTop: 3 }}>{money(230 - allowance)} over allowance</div>
                  </div>
                </div>
              </div>
              <div style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: 18 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>Next morning, direct</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 5 }}>Arrives 11:40 Mon · misses deadline</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>+{money(40)}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--faint)", marginTop: 3 }}>within allowance</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => router.push("/app/trips")} className="sz-hover" style={ctaAccent}>Approve extra {money(230 - allowance)} and rebook via Doha</button>
              <button onClick={() => router.push("/app/trips")} className="sz-hover" style={{ width: "100%", background: "transparent", color: "var(--ink)", fontWeight: 600, fontSize: 14, padding: 15, border: "1px solid var(--line)", borderRadius: 100, cursor: "pointer" }}>Take the direct next morning</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function segBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--ink)" : "transparent",
    color: active ? "var(--bg)" : "var(--muted-2)",
    fontSize: 9,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    padding: "6px 11px",
    border: "none",
    borderRadius: 100,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
