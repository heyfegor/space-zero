"use client";

/**
 * Space Zero — Authorization. Ported from Authorization.dc.html.
 *
 * Delegated authority: trip budget + recovery allowance, plus the automation
 * toggles. Budget and allowance are loaded from and persisted to the trip via
 * GET/PATCH; they are also mirrored into the client flow so the Execution screen
 * sends the chosen allowance to /api/agent. The deterministic backend authority
 * engine remains the sole enforcer — this screen creates no authority logic.
 *
 * Automation toggles are session-only for this phase (not yet a DB column).
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFlow, money } from "../_lib/flow";
import { useTrip, useQueryParam, fetchOptions, type FlightOptionResponse } from "../_lib/trip-client";
import { executionHref } from "../_lib/flow-nav";
import { PageHeader } from "../_components/PageHeader";
import { PageFooter } from "../_components/PageFooter";
import { Wordmark, Lock, Pencil, ctaAccent } from "../_components/ui";

export default function Authorization() {
  const router = useRouter();
  const tripId = useQueryParam("trip");
  const { trip, save } = useTrip(tripId);
  const { authority, updateAuthority, selectedOption, intent } = useFlow();
  const usingServer = Boolean(tripId);
  const seeded = useRef(false);

  // Seed the in-session authority from the persisted trip once it loads. Fall
  // back to the existing flow defaults when the brief specified no figure (0),
  // so the staged demo (recovery £96 ≤ £150) keeps working.
  useEffect(() => {
    if (!trip || seeded.current) return;
    seeded.current = true;
    updateAuthority({
      budget: trip.intent.budget || authority.budget,
      recoveryAllowance: trip.intent.recoveryAllowance || authority.recoveryAllowance,
    });
  }, [trip, authority.budget, authority.recoveryAllowance, updateAuthority]);

  const withTrip = (path: string) => (tripId ? `${path}?trip=${encodeURIComponent(tripId)}` : path);
  const destination = (usingServer ? trip?.intent.destination : intent.destination) || intent.destination;

  // With a trip in context, the "Selected journey" card must show the REAL
  // chosen Duffel option (route + price) — the same figure Funding derives —
  // not the demo fixture. Without a trip, fall back to the flow demo option.
  const [realOption, setRealOption] = useState<FlightOptionResponse | null>(null);
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    fetchOptions(tripId)
      .then((options) => {
        if (cancelled) return;
        setRealOption(pickSelected(options));
      })
      .catch(() => { /* keep the fixture fallback if options can't be read */ });
    return () => { cancelled = true; };
  }, [tripId]);

  const journey = realOption
    ? {
        route: `${realOption.origin} → ${[...realOption.via, realOption.destination].join(" → ")}`,
        arrive: fmtArrive(realOption.arriveAt),
        cost: realOption.totalAmount,
        currency: realOption.currency,
      }
    : {
        route: `${selectedOption.a} → ${selectedOption.b} → ${selectedOption.c}`,
        arrive: selectedOption.arrive,
        cost: selectedOption.cost,
        currency: selectedOption.currency,
      };

  const commitBudget = (n: number) => {
    updateAuthority({ budget: n });
    if (usingServer) void save({ budget: n }).catch(() => {});
  };
  const commitAllowance = (n: number) => {
    updateAuthority({ recoveryAllowance: n });
    if (usingServer) void save({ recoveryAllowance: n }).catch(() => {});
  };

  return (
    <>
      <PageHeader back={withTrip("/app/funding")} center={<Wordmark />} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "26px 20px 130px" }}>
        <h1 style={{ fontSize: "clamp(30px,8.5vw,40px)", lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>What may I do on my own?</h1>
        <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.55, color: "var(--muted)" }}>Set the limits. I act inside them without asking. Anything beyond them comes back to you.</p>

        <div className="sz-up" style={{ marginTop: 22, border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)", padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--faint)" }}>Selected journey</div>
            <div style={{ marginTop: 6, fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>{(destination || "Your trip").split(",")[0]}</div>
            <div className="mono" style={{ marginTop: 4, fontSize: 11, color: "var(--muted-2)" }}>{journey.route}{journey.arrive ? ` · arrives ${journey.arrive}` : ""}</div>
          </div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", flexShrink: 0 }}>{money(journey.cost, journey.currency)}</div>
        </div>

        <div className="mono" style={{ marginTop: 26, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--faint)" }}>Spending limits</div>
        <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
          <LimitRow label="Trip budget" hint="The most I can spend, all legs" value={authority.budget} currency={intent.currency} onCommit={commitBudget} />
          <LimitRow label="Recovery allowance" hint="Extra I can spend to fix disruptions" value={authority.recoveryAllowance} currency={intent.currency} onCommit={commitAllowance} />
        </div>

        <div className="mono" style={{ marginTop: 26, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--faint)" }}>Autonomy</div>
        <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
          <Toggle label="Automatic booking" desc="I book the selected journey without a second confirmation." on={authority.autoBook} onFlip={() => updateAuthority({ autoBook: !authority.autoBook })} />
          <Toggle label="Automatic recovery" desc="If a disruption hits, I rebook within your recovery allowance." on={authority.autoRecovery} onFlip={() => updateAuthority({ autoRecovery: !authority.autoRecovery })} />
        </div>

        <div className="sz-up" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "flex-start", border: "1px solid rgba(228,87,46,.4)", borderRadius: 14, background: "var(--surface)", padding: "15px 18px" }}>
          <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}><Lock /></span>
          <p style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)" }}>I will never spend beyond these limits, or book outside your requirements, without asking you first.</p>
        </div>
      </div>

      <PageFooter>
        <button onClick={() => router.push(executionHref(tripId))} className="sz-hover" style={ctaAccent}>Give Space Zero authority →</button>
      </PageFooter>
    </>
  );
}

/** Pick the traveler's chosen option: selected, else recommended, else first. */
function pickSelected(options: FlightOptionResponse[]): FlightOptionResponse | null {
  if (options.length === 0) return null;
  return options.find((o) => o.selected) ?? options.find((o) => o.recommended) ?? options[0];
}

/** Format an ISO arrival as "HH:MM Day" (matches the Options screen). */
function fmtArrive(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = d.toLocaleDateString([], { weekday: "short" });
  return `${time} ${day}`;
}

function LimitRow({ label, hint, value, currency, onCommit }: { label: string; hint: string; value: number; currency: string; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const start = () => { setDraft(String(value)); setEditing(true); };
  const commit = () => { const n = parseInt(draft, 10); onCommit(Number.isNaN(n) ? value : Math.max(0, n)); setEditing(false); };
  return (
    <div style={{ padding: "15px 18px", borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>{hint}</div>
      </div>
      {editing ? (
        <input value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} inputMode="numeric" autoFocus className="mono" style={{ width: 110, textAlign: "right", background: "transparent", border: "none", borderBottom: "1.5px solid var(--accent)", color: "var(--ink)", fontSize: 17, fontWeight: 700, padding: "2px 0", outline: "none" }} />
      ) : (
        <button onClick={start} className="sz-hover mono" style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", flexShrink: 0, background: "transparent", border: "none", padding: 0 }}>
          <span style={{ fontSize: 19, fontWeight: 700, color: "var(--ink)" }}>{money(value, currency)}</span>
          <span style={{ color: "var(--faint)", display: "flex" }}><Pencil /></span>
        </button>
      )}
    </div>
  );
}

function Toggle({ label, desc, on, onFlip }: { label: string; desc: string; on: boolean; onFlip: () => void }) {
  return (
    <button onClick={onFlip} className="sz-hover" role="switch" aria-checked={on} style={{ width: "100%", textAlign: "left", padding: "16px 18px", borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, cursor: "pointer", background: "transparent", border: "none" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{label}</div>
        <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--muted-2)", marginTop: 4 }}>{desc}</div>
      </div>
      <div style={{ width: 46, height: 27, borderRadius: 100, background: on ? "var(--accent)" : "var(--surface-2)", border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, flexShrink: 0, position: "relative", transition: "background .2s ease, border-color .2s ease", marginTop: 2 }}>
        <div style={{ position: "absolute", top: 2, left: 2, width: 21, height: 21, borderRadius: 100, background: on ? "#fff" : "var(--muted-2)", transform: `translateX(${on ? "19px" : "0px"})`, transition: "transform .2s cubic-bezier(.4,0,.2,1), background .2s ease" }} />
      </div>
    </button>
  );
}
