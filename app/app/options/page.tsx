"use client";

/**
 * Space Zero — Options. Ported from Options.dc.html.
 *
 * Shows REAL, persisted flight options for the trip (?trip=<id>): on mount it
 * loads any stored options, and if there are none it triggers the agent-
 * orchestrated search. Searching, no-results, and provider-failure/unconfigured
 * states are all shown honestly — no fabricated flights. Selecting persists the
 * choice (option row + trip.selectedOptionId). Without a trip id it falls back
 * to the demo options so the screen still renders standalone.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFlow, type FlightOption as CardOption } from "../_lib/flow";
import {
  fetchOptions,
  searchFlights,
  selectOption,
  type FlightOptionResponse,
  type SearchStatus,
} from "../_lib/trip-client";
import { PageHeader } from "../_components/PageHeader";
import { PageFooter } from "../_components/PageFooter";
import { OptionCard } from "../_components/OptionCard";
import { Wordmark, ctaSolid } from "../_components/ui";

type View = "loading" | "searching" | "ready" | "empty" | "fallback";

export default function Options() {
  const router = useRouter();
  const flow = useFlow();

  // Read ?trip= once, distinguishing "not read yet" from "absent" — otherwise a
  // no-trip visit (or a retry) can never leave the loading state.
  const [q, setQ] = useState<{ ready: boolean; id: string | null }>({ ready: false, id: null });
  useEffect(() => {
    try { setQ({ ready: true, id: new URLSearchParams(window.location.search).get("trip") }); }
    catch { setQ({ ready: true, id: null }); }
  }, []);
  const tripId = q.id;

  const [view, setView] = useState<View>("loading");
  const [options, setOptions] = useState<FlightOptionResponse[]>([]);
  const [reason, setReason] = useState<SearchStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fallbackSel, setFallbackSel] = useState<string>(flow.selectedOptionId);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!q.ready) return; // query not read yet
    if (!q.id) { setView("fallback"); return; }
    const id = q.id;
    let cancelled = false;
    setView("loading");

    (async () => {
      try {
        const existing = await fetchOptions(id);
        if (cancelled) return;
        if (existing.length > 0) {
          setOptions(existing);
          setSelectedId(existing.find((o) => o.selected)?.id ?? existing.find((o) => o.recommended)?.id ?? existing[0].id);
          setView("ready");
          return;
        }
      } catch {
        if (cancelled) return; // fall through to a fresh search
      }
      setView("searching");
      const res = await searchFlights(id);
      if (cancelled) return;
      if (res.options.length > 0) {
        setOptions(res.options);
        setSelectedId(res.options.find((o) => o.recommended)?.id ?? res.options[0].id);
        setView("ready");
      } else {
        setReason(res.status);
        setView("empty");
      }
    })();

    return () => { cancelled = true; };
  }, [q.ready, q.id, retry]);

  async function choose(id: string) {
    setSelectedId(id);
    flow.setSelectedOptionId(id);
    if (tripId) { try { await selectOption(tripId, id); } catch { /* keep local selection */ } }
  }

  const withTrip = (path: string) => (tripId ? `${path}?trip=${encodeURIComponent(tripId)}` : path);

  return (
    <>
      <PageHeader back={withTrip("/app/trip-plan")} center={<Wordmark />} />

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "24px 20px 130px" }}>
        {view === "fallback" ? (
          <FallbackDemo flow={flow} selected={fallbackSel} onSelect={(id) => { setFallbackSel(id); flow.setSelectedOptionId(id); }} />
        ) : view === "loading" || view === "searching" ? (
          <SearchingState searching={view === "searching"} />
        ) : view === "empty" ? (
          <EmptyState reason={reason} tripId={tripId} onRetry={() => setRetry((n) => n + 1)} />
        ) : (
          <>
            <AgentLine count={options.length} />
            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12 }}>
              {options.map((o) => (
                <OptionCard key={o.id} option={toCard(o)} selected={o.id === selectedId} onSelect={() => choose(o.id)} />
              ))}
            </div>
            <div className="mono" style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.02em", color: "var(--faint)", lineHeight: 1.6 }}>
              Live fares from the travel provider. I&apos;ll hold the selected fare while you authorize.
            </div>
          </>
        )}
      </div>

      <PageFooter>
        <button
          onClick={() => router.push(withTrip("/app/funding"))}
          disabled={view === "ready" && !selectedId}
          className="sz-hover"
          style={{ ...ctaSolid, opacity: view === "searching" || view === "loading" ? 0.6 : 1 }}
        >
          Select this itinerary →
        </button>
      </PageFooter>
    </>
  );
}

function AgentLine({ count }: { count: number }) {
  return (
    <div className="sz-up" style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontWeight: 800, fontSize: 11, color: "#fff" }}>S0</span>
      </div>
      <p style={{ flex: 1, paddingTop: 3, fontSize: 16, lineHeight: 1.5, color: "var(--ink)" }}>
        {count === 1 ? "One journey" : `${count} journeys`} match your requirements, ranked best-first. I recommend the first.
      </p>
    </div>
  );
}

function SearchingState({ searching }: { searching: boolean }) {
  return (
    <div className="sz-up" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "60px 0" }}>
      <span className="sz-spin" style={{ width: 26, height: 26, borderRadius: 100, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
      <div className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted-2)" }}>
        {searching ? "Searching real flights…" : "Loading options…"}
      </div>
    </div>
  );
}

const REASON_COPY: Record<SearchStatus, { title: string; body: string }> = {
  ok: { title: "", body: "" },
  no_results: { title: "No journeys matched", body: "Nothing matched your requirements and hard arrival deadline. Try adjusting the trip on the plan screen." },
  provider_unconfigured: { title: "Live search not configured", body: "Real flight search isn't switched on in this environment. No flights are shown because none can be fetched yet." },
  operator_unavailable: { title: "Operator unavailable", body: "The operator that runs the search isn't configured, so no live search ran. No flights were invented." },
  provider_error: { title: "Provider didn't respond", body: "The travel provider didn't return results just now. Please try again shortly." },
  origin_unknown: { title: "Origin unclear", body: "I couldn't resolve your origin to an airport. Edit the origin on the trip plan and try again." },
  destination_unknown: { title: "Destination unclear", body: "I couldn't resolve your destination to an airport. Edit it on the trip plan and try again." },
  trip_not_found: { title: "Trip not found", body: "That trip could not be found." },
};

function EmptyState({ reason, tripId, onRetry }: { reason: SearchStatus | null; tripId: string | null; onRetry: () => void }) {
  const copy = REASON_COPY[reason ?? "no_results"];
  const router = useRouter();
  return (
    <div className="sz-up" style={{ border: "1px solid rgba(196,64,46,.4)", borderRadius: 16, background: "rgba(196,64,46,.06)", padding: 20, marginTop: 8 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--disruption-2)" }}>{copy.title}</div>
      <p style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>{copy.body}</p>
      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={onRetry} className="sz-hover" style={{ ...ctaSolid, width: "auto", padding: "12px 20px" }}>Try again</button>
        <button onClick={() => router.push(tripId ? `/app/trip-plan?trip=${encodeURIComponent(tripId)}` : "/app/trip-plan")} className="sz-hover" style={{ width: "auto", padding: "12px 20px", display: "flex", alignItems: "center", gap: 8, background: "transparent", color: "var(--ink)", fontWeight: 600, fontSize: 15, border: "1px solid var(--line)", borderRadius: 100, cursor: "pointer" }}>Edit trip</button>
      </div>
    </div>
  );
}

function FallbackDemo({ flow, selected, onSelect }: { flow: ReturnType<typeof useFlow>; selected: string; onSelect: (id: string) => void }) {
  return (
    <>
      <AgentLine count={flow.options.length} />
      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12 }}>
        {flow.options.map((o) => (
          <OptionCard key={o.id} option={o} selected={o.id === selected} onSelect={() => onSelect(o.id)} />
        ))}
      </div>
      <div className="mono" style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.02em", color: "var(--faint)", lineHeight: 1.6 }}>
        Demo fares (no trip in context). Brief a trip to search real flights.
      </div>
    </>
  );
}

// --- mapping: real option → OptionCard's display shape ----------------------

function toCard(o: FlightOptionResponse): CardOption {
  return {
    id: o.id,
    tag: o.recommended ? "Recommended" : "Option",
    recommended: o.recommended,
    cost: o.totalAmount,
    currency: o.currency,
    a: o.origin,
    b: o.via.join(" · "),
    c: o.destination,
    duration: fmtDuration(o.durationMinutes),
    stops: o.connections === 0 ? "Direct" : `${o.connections} stop${o.connections > 1 ? "s" : ""}`,
    via: o.connections === 0 ? "nonstop" : o.via.join(", ") || "—",
    arrive: fmtArrive(o.arriveAt),
  };
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function fmtArrive(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = d.toLocaleDateString([], { weekday: "short" });
  return `${time} ${day}`;
}
