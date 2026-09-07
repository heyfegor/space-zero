"use client";

/**
 * Space Zero — TripPlan. Ported from TripPlan.dc.html.
 *
 * Reads the persisted trip from GET /api/trips/[id] (via ?trip=<id>) and shows
 * the brief + structured intent. Field edits persist through PATCH. If opened
 * without a trip id, it falls back to the client flow's demo intent so the
 * screen still renders standalone. Visuals are unchanged from the design.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFlow, money } from "../_lib/flow";
import { useTrip, useQueryParam, type TripPatch } from "../_lib/trip-client";
import { PageHeader } from "../_components/PageHeader";
import { PageFooter } from "../_components/PageFooter";
import { Wordmark, Pencil, Clock, ctaSolid } from "../_components/ui";

export default function TripPlan() {
  const router = useRouter();
  const tripId = useQueryParam("trip");
  const flow = useFlow();
  const { trip, loading, error, save } = useTrip(tripId);
  const usingServer = Boolean(tripId);

  // Effective values: server-backed when a trip id is present, else flow demo.
  const brief = usingServer ? trip?.brief ?? "" : flow.brief;
  const currency = usingServer ? trip?.currency ?? "GBP" : flow.intent.currency;
  const i = trip?.intent;
  const destination = usingServer ? i?.destination ?? "" : flow.intent.destination;
  const arriveBy = usingServer ? i?.arriveBy ?? "" : flow.intent.arriveBy;
  const depart = usingServer ? i?.depart ?? "" : flow.intent.depart;
  const budget = usingServer ? i?.budget ?? 0 : flow.intent.budget;
  const recoveryAllowance = usingServer ? i?.recoveryAllowance ?? 0 : flow.intent.recoveryAllowance;
  const cabin = usingServer ? i?.cabin ?? "" : flow.intent.cabin;
  const baggage = usingServer ? i?.baggage ?? "" : flow.intent.baggage;
  const seat = usingServer ? i?.seat ?? "" : flow.intent.seat;

  // Persist a field: PATCH the server, or update flow state in fallback mode.
  const commit = (patch: TripPatch) => {
    if (usingServer) { void save(patch).catch(() => {}); }
    else flow.updateIntent(patch);
  };

  const hardArrival = arriveBy ? `Must arrive ${lower(arriveBy)}` : "No hard arrival requirement set yet";

  if (usingServer && loading) {
    return (
      <>
        <PageHeader back="/app" center={<Wordmark />} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <span className="mono" style={{ fontSize: 12, letterSpacing: "0.1em", color: "var(--muted-2)" }}>Loading your trip…</span>
        </div>
      </>
    );
  }

  if (usingServer && error) {
    return (
      <>
        <PageHeader back="/app" center={<Wordmark />} />
        <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "60px 22px" }}>
          <div style={{ border: "1px solid rgba(196,64,46,.4)", borderRadius: 16, background: "rgba(196,64,46,.06)", padding: 20 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--disruption-2)" }}>Trip unavailable</div>
            <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>{error}</p>
            <button onClick={() => router.push("/app")} className="sz-hover" style={{ ...ctaSolid, marginTop: 18 }}>Start a new brief →</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader back="/app" center={<Wordmark />} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "24px 20px 130px" }}>
        {brief.trim() && (
          <div className="sz-up" style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ maxWidth: "82%", background: "var(--surface-2)", border: "1px solid var(--line-2)", borderRadius: "16px 16px 4px 16px", padding: "14px 16px" }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 7 }}>You briefed</div>
              <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>{brief}</p>
            </div>
          </div>
        )}

        <div className="sz-up" style={{ marginTop: 20, display: "flex", gap: 11, alignItems: "flex-start" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 11, color: "#fff" }}>S0</span>
          </div>
          <p style={{ flex: 1, paddingTop: 3, fontSize: 16, lineHeight: 1.5, color: "var(--ink)" }}>Understood. Here&apos;s your trip as I read it. Edit anything, then I&apos;ll search real journeys.</p>
        </div>

        <div className="sz-up" style={{ marginTop: 20, marginLeft: 41, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
          <SectionLabel>Journey</SectionLabel>
          <TextRow label="Destination" value={destination} onCommit={(v) => commit({ destination: v })} />
          <TextRow label="Arrive by" value={arriveBy} onCommit={(v) => commit({ arriveBy: v })} />
          <TextRow label="Depart" value={depart} onCommit={(v) => commit({ depart: v })} />

          <SectionLabel divider>Money</SectionLabel>
          <MoneyRow label="Trip budget" hint="Total, all legs" value={budget} currency={currency} onCommit={(n) => commit({ budget: n })} />
          <MoneyRow label="Recovery allowance" hint="Spend to fix disruptions" value={recoveryAllowance} currency={currency} onCommit={(n) => commit({ recoveryAllowance: n })} />

          <SectionLabel divider>Preferences</SectionLabel>
          <TextRow label="Cabin" value={cabin} onCommit={(v) => commit({ cabin: v })} small />
          <TextRow label="Baggage" value={baggage} onCommit={(v) => commit({ baggage: v })} small />
          <TextRow label="Seat" value={seat} onCommit={(v) => commit({ seat: v })} small />
        </div>

        <div className="sz-up" style={{ marginTop: 14, marginLeft: 41, border: "1px solid rgba(228,87,46,.4)", borderRadius: 14, background: "var(--surface)", padding: "15px 18px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}><Clock /></span>
          <div>
            <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>Hard requirement</div>
            <div style={{ marginTop: 5, fontSize: 15, fontWeight: 500, color: "var(--ink)", lineHeight: 1.4 }}>{hardArrival}. I&apos;ll reject any itinerary that misses this.</div>
          </div>
        </div>
      </div>

      <PageFooter>
        <button onClick={() => router.push(tripId ? `/app/options?trip=${encodeURIComponent(tripId)}` : "/app/options")} className="sz-hover" style={ctaSolid}>Review options →</button>
      </PageFooter>
    </>
  );
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function SectionLabel({ children, divider }: { children: React.ReactNode; divider?: boolean }) {
  return (
    <div className="mono" style={{ padding: divider ? "15px 18px 4px" : "13px 18px 4px", borderTop: divider ? "1px solid var(--line)" : undefined, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--faint)" }}>{children}</div>
  );
}

function TextRow({ label, value, onCommit, small }: { label: string; value: string; onCommit: (v: string) => void; small?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => { onCommit(draft.trim()); setEditing(false); };
  return (
    <div className="sz-row" style={{ padding: "13px 18px", borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--muted-2)", flexShrink: 0 }}>{label}</div>
      {editing ? (
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} autoFocus style={{ flex: 1, textAlign: "right", background: "transparent", border: "none", borderBottom: "1.5px solid var(--accent)", color: "var(--ink)", fontSize: small ? 15 : 16, fontWeight: 600, padding: "2px 0", outline: "none", fontFamily: "inherit" }} />
      ) : (
        <button onClick={start} className="sz-hover" style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", minWidth: 0, background: "transparent", border: "none", padding: 0 }}>
          <span style={{ fontSize: small ? 15 : 16, fontWeight: 600, color: value ? "var(--ink)" : "var(--faint)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || "Add"}</span>
          <span style={{ color: "var(--faint)", display: "flex" }}><Pencil /></span>
        </button>
      )}
    </div>
  );
}

function MoneyRow({ label, hint, value, currency, onCommit }: { label: string; hint: string; value: number; currency: string; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const start = () => { setDraft(String(value)); setEditing(true); };
  const commit = () => { const n = parseInt(draft, 10); onCommit(Number.isNaN(n) ? value : Math.max(0, n)); setEditing(false); };
  return (
    <div className="sz-row" style={{ padding: "13px 18px", borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--muted-2)" }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>{hint}</div>
      </div>
      {editing ? (
        <input value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} inputMode="numeric" autoFocus className="mono" style={{ width: 120, textAlign: "right", background: "transparent", border: "none", borderBottom: "1.5px solid var(--accent)", color: "var(--ink)", fontSize: 16, fontWeight: 700, padding: "2px 0", outline: "none" }} />
      ) : (
        <button onClick={start} className="sz-hover mono" style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", background: "transparent", border: "none", padding: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>{money(value, currency)}</span>
          <span style={{ color: "var(--faint)", display: "flex" }}><Pencil /></span>
        </button>
      )}
    </div>
  );
}
