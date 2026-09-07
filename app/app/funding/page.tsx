"use client";

/**
 * Space Zero — Funding. Ported from Funding.dc.html (approved design preserved).
 *
 * Funding answers "is money available for this trip?" — NOT "what may Space Zero
 * do on its own?" (that is Authorization). So there are deliberately no recovery
 * or automation controls here, and funding is kept SEPARATE from authority.
 *
 * When opened with ?trip=<id> the screen uses REAL PERSISTED funding: the
 * estimated cost comes from the selected real itinerary, and the funded amount /
 * status are read from and written to /api/trips/[id]/funding. Without a trip in
 * context it falls back to the standalone demo so the screen still renders.
 *
 * No money moves. Airwallex is not integrated; "Fund" persists a funding state
 * only and nothing here claims a charge or transfer has happened.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFlow, money } from "../_lib/flow";
import {
  useTrip,
  fetchFunding,
  fetchOptions,
  updateFunding as apiUpdateFunding,
  type FundingView,
  type FlightOptionResponse,
} from "../_lib/trip-client";
import { PageHeader } from "../_components/PageHeader";
import { PageFooter } from "../_components/PageFooter";
import { MoneyInput, type Preset } from "../_components/MoneyInput";
import { Wordmark, Lock, Check, ctaAccent } from "../_components/ui";

function roundUp(n: number, step: number) { return Math.ceil(n / step) * step; }
function defaultFunding(estimatedCost: number) {
  return estimatedCost > 0 ? roundUp(estimatedCost * 1.12, 50) : 0;
}

/** Display shape for the selected-itinerary card (source-agnostic). */
interface OptionDisplay { a: string; c: string; via: string; duration: string; cabin: string }

/** The unified funding view model both the persisted and demo paths produce. */
interface FundingVM {
  currency: string;
  estimatedCost: number;
  amount: number;
  setAmount: (n: number) => void;
  status: "idle" | "processing" | "funded";
  /** Persisted funded amount + remaining, for the funded confirmation view. */
  fundedAmount: number;
  fundedRemaining: number;
  option: OptionDisplay;
  fund: () => void;
  error: string | null;
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function optionFromResponse(o: FlightOptionResponse | null, cabin: string): OptionDisplay {
  if (!o) return { a: "—", c: "—", via: "—", duration: "—", cabin };
  return {
    a: o.origin,
    c: o.destination,
    via: o.connections === 0 ? "nonstop" : o.via.join(", ") || "—",
    duration: fmtDuration(o.durationMinutes),
    cabin,
  };
}

function pickSelected(options: FlightOptionResponse[], selectedOptionId: string | null): FlightOptionResponse | null {
  if (options.length === 0) return null;
  return (
    options.find((o) => o.selected) ??
    (selectedOptionId ? options.find((o) => o.id === selectedOptionId) : undefined) ??
    options.find((o) => o.recommended) ??
    options[0]
  );
}

export default function Funding() {
  const router = useRouter();

  // Read ?trip= once, distinguishing "not read yet" from "absent".
  const [q, setQ] = useState<{ ready: boolean; id: string | null }>({ ready: false, id: null });
  useEffect(() => {
    try { setQ({ ready: true, id: new URLSearchParams(window.location.search).get("trip") }); }
    catch { setQ({ ready: true, id: null }); }
  }, []);
  const tripId = q.id;
  const withTrip = (path: string) => (tripId ? `${path}?trip=${encodeURIComponent(tripId)}` : path);

  // Both controllers run unconditionally (hook rules); we render the right one.
  const demo = useDemoFunding();
  const persisted = usePersistedFunding(tripId);

  const goNext = () => router.push(withTrip("/app/authorization"));

  if (!q.ready || (tripId && persisted.loading)) {
    return (
      <>
        <PageHeader back={withTrip("/app/options")} center={<Wordmark />} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 20px" }}>
          <span className="sz-spin" style={{ width: 26, height: 26, borderRadius: 100, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
        </div>
      </>
    );
  }

  const vm = tripId ? persisted.vm : demo;
  return <FundingBody vm={vm} back={withTrip("/app/options")} onContinue={goNext} />;
}

// --- Demo controller (no trip in context) ----------------------------------

function useDemoFunding(): FundingVM {
  const { estimatedCost, funding, setFunding, fundingStatus, setFundingStatus, intent, selectedOption } = useFlow();
  const buffer = funding - estimatedCost;
  const status: FundingVM["status"] =
    fundingStatus === "FUNDED" ? "funded" : fundingStatus === "PROCESSING" ? "processing" : "idle";

  const fund = () => {
    if (funding < estimatedCost) return;
    setFundingStatus("PROCESSING");
    setTimeout(() => setFundingStatus("FUNDED"), 1500);
  };

  return {
    currency: intent.currency,
    estimatedCost,
    amount: funding,
    setAmount: setFunding,
    status,
    fundedAmount: funding,
    fundedRemaining: Math.max(0, buffer),
    option: { a: selectedOption.a, c: selectedOption.c, via: selectedOption.via, duration: selectedOption.duration, cabin: intent.cabin },
    fund,
    error: null,
  };
}

// --- Persisted controller (real funding via the API) -----------------------

function usePersistedFunding(tripId: string | null): { vm: FundingVM; loading: boolean } {
  const { trip } = useTrip(tripId);
  const [view, setView] = useState<FundingView | null>(null);
  const [selected, setSelected] = useState<FlightOptionResponse | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [status, setStatus] = useState<FundingVM["status"]>("idle");
  const [loading, setLoading] = useState<boolean>(Boolean(tripId));
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tripId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [f, options] = await Promise.all([fetchFunding(tripId), fetchOptions(tripId).catch(() => [])]);
        if (cancelled) return;
        setView(f);
        setSelected(pickSelected(options, null));
        if (!seeded.current) {
          seeded.current = true;
          setAmount(f.fundedAmount > 0 ? f.fundedAmount : defaultFunding(f.estimatedCost));
          setStatus(f.status === "FUNDED" ? "funded" : f.status === "PROCESSING" ? "processing" : "idle");
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load funding.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [tripId]);

  const estimatedCost = view?.estimatedCost ?? 0;

  const fund = () => {
    if (!tripId || amount < estimatedCost) return;
    setError(null);
    setStatus("processing");
    // Persist PROCESSING, then FUNDED. No money moves — this records state only.
    apiUpdateFunding(tripId, { status: "PROCESSING", fundedAmount: amount })
      .then((f) => setView(f))
      .catch(() => {});
    timer.current = setTimeout(() => {
      apiUpdateFunding(tripId, { status: "FUNDED", fundedAmount: amount })
        .then((f) => {
          setView(f);
          setStatus(f.status === "FUNDED" ? "funded" : "idle");
          if (f.status !== "FUNDED") setError("That amount no longer covers the trip. Add funds to continue.");
        })
        .catch((e: unknown) => {
          setStatus("idle");
          setError(e instanceof Error ? e.message : "Could not allocate funds right now.");
        });
    }, 1500);
  };

  const vm: FundingVM = {
    currency: view?.currency ?? "GBP",
    estimatedCost,
    amount,
    setAmount,
    status,
    fundedAmount: view?.fundedAmount ?? amount,
    fundedRemaining: view?.buffer ?? Math.max(0, amount - estimatedCost),
    option: optionFromResponse(selected, trip?.intent.cabin ?? ""),
    fund,
    error,
  };
  return { vm, loading };
}

// --- Presentation (the approved Funding.dc.html design) --------------------

function FundingBody({ vm, back, onContinue }: { vm: FundingVM; back: string; onContinue: () => void }) {
  const { currency, estimatedCost, amount, setAmount, status, option } = vm;
  const buffer = amount - estimatedCost;
  const sufficient = buffer >= 0;
  const funded = status === "funded";
  const processing = status === "processing";
  const idle = status === "idle";

  const presets: Preset[] = [
    { label: "Cost only", value: estimatedCost },
    { label: money(roundUp(estimatedCost * 1.2, 500), currency), value: roundUp(estimatedCost * 1.2, 500) },
    { label: money(roundUp(estimatedCost * 1.2, 500) + 500, currency), value: roundUp(estimatedCost * 1.2, 500) + 500 },
  ];

  return (
    <>
      <PageHeader back={back} center={<Wordmark />} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "26px 20px 140px" }}>
        {!funded ? (
          <>
            <div className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--faint)" }}>Before I book</div>
            <h1 style={{ marginTop: 12, fontSize: "clamp(30px,8.5vw,40px)", lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em", color: "var(--ink)" }}>Fund this trip</h1>
            <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.55, color: "var(--muted)" }}>I need a funded travel balance before I can book your selected itinerary. Set aside what this trip can draw on.</p>

            {/* selected itinerary */}
            <div className="sz-up" style={{ marginTop: 22, border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)", padding: "16px 18px" }}>
              <div className="mono" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--faint)" }}>Selected itinerary</div>
              <div className="mono" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 9, fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>
                <span>{option.a}</span><span style={{ color: "var(--faint)" }}>→</span><span>{option.c}</span>
              </div>
              <div className="mono" style={{ marginTop: 6, fontSize: 11, letterSpacing: "0.02em", color: "var(--muted-2)", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span>via {option.via}</span><span style={{ color: "var(--line-3)" }}>·</span><span>{option.duration}</span><span style={{ color: "var(--line-3)" }}>·</span><span>{option.cabin}</span>
              </div>
            </div>

            {/* funding panel */}
            <div style={{ marginTop: 14, border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
              <div style={{ padding: "15px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 14, color: "var(--muted)" }}>Estimated trip cost</span>
                <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--ink-2)" }}>{money(estimatedCost, currency)}</span>
              </div>
              <div style={{ padding: "22px 18px 20px", borderTop: "1px solid var(--line-2)" }}>
                <div className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--faint)", textAlign: "center" }}>Trip funding</div>
                <div style={{ marginTop: 14 }}>
                  <MoneyInput amount={amount} onChange={setAmount} currency={currency} presets={presets} />
                </div>
              </div>

              {sufficient ? (
                <div style={{ padding: "14px 18px", borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--muted)" }}>
                    <span style={{ color: "var(--accent)", display: "flex" }}><Check size={15} width={2.4} /></span>
                    Available buffer
                  </span>
                  <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{money(Math.abs(buffer), currency)}</span>
                </div>
              ) : (
                <div style={{ padding: "14px 18px", borderTop: "1px solid rgba(215,154,90,.35)", background: "rgba(215,154,90,.07)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--warm)" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5" /><path d="M12 16.5v.01" /><circle cx="12" cy="12" r="9" /></svg>
                    {money(Math.abs(buffer), currency)} below estimated cost
                  </span>
                  <span className="mono" style={{ fontSize: 13, color: "var(--warm)" }}>add funds</span>
                </div>
              )}
            </div>

            {vm.error && (
              <p className="mono" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5, color: "var(--warm)" }}>{vm.error}</p>
            )}

            {/* boundary */}
            <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "flex-start", border: "1px solid rgba(228,87,46,.4)", borderRadius: 14, background: "var(--surface)", padding: "15px 18px" }}>
              <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}><Lock /></span>
              <p style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)" }}>Funds are set aside for this trip. I can only use them within the authority you define next.</p>
            </div>
          </>
        ) : (
          <>
            <div className="sz-pop" style={{ marginTop: 8, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: 100, background: "rgba(228,87,46,.12)", border: "1px solid rgba(228,87,46,.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "var(--accent)", display: "flex" }}><Check size={26} width={2.6} /></span>
              </div>
              <div className="mono" style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "var(--accent)" }}>Funded</div>
              <div className="mono" style={{ marginTop: 12, fontSize: "clamp(46px,13vw,58px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--ink)" }}>{money(vm.fundedAmount, currency)}</div>
              <p style={{ marginTop: 12, fontSize: 15, color: "var(--muted)" }}>is set aside for this trip.</p>
            </div>

            <div className="sz-up" style={{ marginTop: 26, border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
              <div className="mono" style={{ padding: "14px 18px", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--faint)", borderBottom: "1px solid var(--line-2)" }}>Travel balance · {option.a} → {option.c}</div>
              <div style={{ padding: "15px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 14, color: "var(--muted)" }}>Estimated booking</span>
                <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>{money(estimatedCost, currency)}</span>
              </div>
              <div style={{ padding: "15px 18px", borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 14, color: "var(--muted)" }}>Remaining trip funds</span>
                <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{money(vm.fundedRemaining, currency)}</span>
              </div>
            </div>

            <div className="sz-up" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "flex-start", border: "1px solid rgba(228,87,46,.4)", borderRadius: 14, background: "var(--surface)", padding: "15px 18px" }}>
              <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}><Lock /></span>
              <p style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)" }}>These funds are held for this trip only. Next, decide what I may do with them on my own.</p>
            </div>
          </>
        )}
      </div>

      <PageFooter>
        {idle && sufficient && (
          <button onClick={vm.fund} className="sz-hover" style={ctaAccent}>Fund {money(amount, currency)}</button>
        )}
        {idle && !sufficient && (
          <button disabled style={{ ...ctaAccent, background: "var(--surface-2)", color: "var(--faint)", border: "1px solid var(--line)", cursor: "not-allowed" }}>Add {money(Math.abs(buffer), currency)} to continue</button>
        )}
        {processing && (
          <button disabled style={{ ...ctaAccent, opacity: 0.9, cursor: "default" }}>
            <span className="sz-spin" style={{ width: 17, height: 17, borderRadius: 100, border: "2px solid #fff", borderTopColor: "transparent" }} />
            Allocating funds…
          </button>
        )}
        {funded && (
          <button onClick={onContinue} className="sz-hover" style={ctaAccent}>Continue →</button>
        )}
      </PageFooter>
    </>
  );
}
