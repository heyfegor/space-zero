"use client";

/**
 * Space Zero — Product (authenticated home). Ported from Product.dc.html.
 *
 * The primary product experience: brief the operator, reach trip history, and
 * an account entry with a VISUAL-ONLY passkey flow (no real WebAuthn yet).
 * "Brief a new trip" carries the brief into TripPlan — it does NOT start the
 * agent here.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useFlow } from "./_lib/flow";
import { createTrip } from "./_lib/trip-client";
import { ThemeToggle } from "./_components/ThemeToggle";
import { Wordmark, Check } from "./_components/ui";

const RECENT_TRIPS = [
  { city: "SYDNEY", dates: "04 SEP — 18 SEP", route: "London → Singapore → Sydney", status: "ACTIVE", accent: true },
  { city: "LISBON", dates: "02 SEP — 06 SEP", route: "Berlin → Lisbon", status: "RESOLVED", accent: false },
  { city: "LONDON", dates: "20 AUG — 24 AUG", route: "New York → London · recovered +£40", status: "COMPLETED", accent: false },
  { city: "PARIS", dates: "01 AUG — 03 AUG", route: "Madrid → Paris", status: "COMPLETED", accent: false },
];

type PkPhase = "intro" | "sheet" | "done";
type PkMode = "create" | "signin";
type PkScan = "ready" | "scanning" | "ok";

export default function Product() {
  const router = useRouter();
  const { brief, setBrief } = useFlow();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function submitBrief() {
    const text = brief.trim();
    if (!text) { setCreateError("Tell me the trip first."); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const trip = await createTrip(text);
      router.push(`/app/trip-plan?trip=${encodeURIComponent(trip.id)}`);
    } catch (e) {
      setCreating(false);
      setCreateError(e instanceof Error ? e.message : "Could not start the trip. Try again.");
    }
  }

  return (
    <>
      {/* APP BAR */}
      <div style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(var(--bgr),.82)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--surface-3)" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Wordmark />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => { setHistoryOpen(true); setAccountOpen(false); }} className="sz-hover" style={pillBtn}>Trips</button>
            <button onClick={() => { setAccountOpen(true); setHistoryOpen(false); }} className="sz-hover" style={{ ...pillBtn, background: "var(--ink)", borderColor: "var(--ink)", color: "var(--bg)", fontWeight: 600 }}>Account</button>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* HERO / BRIEF */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 22px 80px" }}>
        <div style={{ width: "100%", maxWidth: 560, textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--accent)" }}>● Autonomous travel operator</div>
          <h1 style={{ marginTop: 26, fontSize: "clamp(38px,11vw,60px)", lineHeight: 0.98, fontWeight: 700, letterSpacing: "-0.04em", color: "var(--ink)" }}>Where are you going?</h1>
          <p style={{ margin: "18px auto 0", maxWidth: 400, fontSize: 16, lineHeight: 1.55, color: "var(--muted)" }}>Tell me the trip the way you&apos;d tell a person. I plan it, book it, and run it.</p>

          <div style={{ marginTop: 34, textAlign: "left", border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: "18px 18px 14px" }}>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder="I need to be in Sydney before 9am Sunday. Keep it under £1,200, aisle seat, and handle disruptions up to £150 without asking me."
              style={{ width: "100%", background: "transparent", border: "none", resize: "none", color: "var(--ink)", fontSize: 16, lineHeight: 1.5, outline: "none", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--disruption-2)", minHeight: 14 }}>{createError ?? ""}</span>
              <button onClick={submitBrief} disabled={creating} className="sz-hover" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "var(--ink)", color: "var(--bg)", fontWeight: 600, fontSize: 14, padding: "11px 18px", border: "none", borderRadius: 100, cursor: creating ? "default" : "pointer", opacity: creating ? 0.7 : 1 }}>
                {creating ? "Briefing…" : "Brief Space Zero →"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* TRIPS DRAWER */}
      {historyOpen && (
        <>
          <div onClick={() => setHistoryOpen(false)} style={scrim} />
          <div className="sz-up" style={drawer}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="mono" style={drawerTitle}>Trips</span>
              <span onClick={() => setHistoryOpen(false)} className="mono" style={{ fontSize: 11, color: "var(--muted-2)", cursor: "pointer", letterSpacing: "0.1em" }}>CLOSE ✕</span>
            </div>
            {hasAccount ? (
              <div style={{ marginTop: 26 }}>
                {RECENT_TRIPS.map((t) => (
                  <div key={t.city} style={{ padding: "22px 0", borderTop: "1px solid var(--line-2)" }}>
                    <div className="mono" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.06em", color: "var(--ink)" }}>{t.city}</span>
                      <span style={{ fontSize: 9, letterSpacing: "0.12em", color: t.accent ? "var(--accent)" : "var(--muted-2)", border: `1px solid ${t.accent ? "rgba(228,87,46,.4)" : "var(--line-3)"}`, borderRadius: 100, padding: "5px 11px" }}>{t.status}</span>
                    </div>
                    <div className="mono" style={{ marginTop: 9, fontSize: 11, letterSpacing: "0.06em", color: "var(--muted-2)" }}>{t.dates}</div>
                    <div className="mono" style={{ marginTop: 5, fontSize: 11, letterSpacing: "0.04em", color: "var(--faint)" }}>{t.route}</div>
                  </div>
                ))}
                <Link href="/app/trips" className="sz-hover" style={{ marginTop: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--ink)", color: "var(--bg)", fontWeight: 600, fontSize: 14, padding: 14, borderRadius: 100 }}>Open all trips →</Link>
              </div>
            ) : (
              <div style={{ marginTop: 64, textAlign: "center" }}>
                <div className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--faint)" }}>No trips yet</div>
                <p style={{ marginTop: 14, fontSize: 15, lineHeight: 1.55, color: "var(--muted-2)" }}>Trips you brief will live here once you have an account.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ACCOUNT DRAWER (visual-only passkey) */}
      {accountOpen && (
        <AccountDrawer
          onClose={() => setAccountOpen(false)}
          onCreated={() => setHasAccount(true)}
        />
      )}
    </>
  );
}

function AccountDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [phase, setPhase] = useState<PkPhase>("intro");
  const [mode, setMode] = useState<PkMode>("create");
  const [scan, setScan] = useState<PkScan>("ready");

  function openSheet(m: PkMode) { setMode(m); setPhase("sheet"); setScan("ready"); }
  function confirm() {
    if (scan !== "ready") return;
    setScan("scanning");
    setTimeout(() => setScan("ok"), 1200);
    setTimeout(() => { setScan("ready"); setPhase("done"); onCreated(); }, 1900);
  }

  const doneTitle = mode === "create" ? "You're all set." : "Welcome back.";
  const doneBody = mode === "create"
    ? "Your passkey is saved to this device (demo). Space Zero can now hold your trips and act within the limits you set."
    : "Your trips, authority limits and recovery history are back in sync.";

  return (
    <>
      <div onClick={onClose} style={scrim} />
      <div className="sz-up" style={drawer}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="mono" style={drawerTitle}>Account</span>
          <span onClick={onClose} className="mono" style={{ fontSize: 11, color: "var(--muted-2)", cursor: "pointer", letterSpacing: "0.1em" }}>CLOSE ✕</span>
        </div>

        {phase === "intro" && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, color: "var(--ink)" }}>Start your Space&nbsp;Zero account.</h2>
            <p style={{ marginTop: 14, fontSize: 15, lineHeight: 1.55, color: "var(--muted)" }}>One passkey keeps your trips, authority limits and recovery history in sync. No password to lose.</p>
            <button onClick={() => openSheet("create")} className="sz-hover" style={{ marginTop: 26, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 15, padding: 16, border: "none", borderRadius: 12, cursor: "pointer" }}>Create with passkey</button>
            <button onClick={() => openSheet("signin")} className="sz-hover" style={{ marginTop: 10, width: "100%", background: "transparent", color: "var(--ink)", fontWeight: 600, fontSize: 14, padding: 14, border: "1px solid var(--line)", borderRadius: 12, cursor: "pointer" }}>I already have one</button>
            <div className="mono" style={{ marginTop: 22, fontSize: 10, letterSpacing: "0.1em", color: "var(--faint)", lineHeight: 1.7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line-2)", padding: "12px 0" }}><span>ENCRYPTED</span><span style={{ color: "var(--muted-2)" }}>DEVICE-BOUND</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line-2)", padding: "12px 0" }}><span>NO PASSWORD</span><span style={{ color: "var(--muted-2)" }}>NOTHING TO STEAL</span></div>
            </div>
          </div>
        )}

        {phase === "sheet" && (
          <div className="sz-up" style={{ marginTop: 34, border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface)", padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.04em", color: "#fff" }}>S0</span>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ink)" }}>{mode === "create" ? "Create a passkey" : "Sign in with passkey"}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 2 }}>spacezero.app</div>
              </div>
            </div>
            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: 72, height: 72, borderRadius: 22, border: `2px solid ${scan === "ready" ? "var(--faint)" : "var(--accent)"}`, display: "flex", alignItems: "center", justifyContent: "center", transition: "border-color .3s ease" }}>
                {scan === "scanning" ? (
                  <span className="sz-spin" style={{ width: 26, height: 26, borderRadius: 100, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
                ) : (
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={scan === "ready" ? "var(--faint)" : "var(--accent)"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v1M15 10v1M12 10v3l-1 1" /><path d="M9 15s1 1 3 1 3-1 3-1" /></svg>
                )}
              </div>
              <div className="mono" style={{ marginTop: 16, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: scan === "ready" ? "var(--faint)" : "var(--accent)" }}>{scan === "ok" ? "Verified" : scan === "scanning" ? "Scanning…" : mode === "create" ? "Look to save passkey" : "Look to sign in"}</div>
            </div>
            <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 9 }}>
              <button onClick={confirm} disabled={scan === "scanning"} className="sz-hover" style={{ width: "100%", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 15, padding: 16, border: "none", borderRadius: 12, cursor: "pointer", opacity: scan === "scanning" ? 0.55 : 1 }}>{scan === "ok" ? "Done" : scan === "scanning" ? "Verifying…" : mode === "create" ? "Save passkey" : "Continue"}</button>
              <button onClick={() => setPhase("intro")} className="sz-hover" style={{ width: "100%", background: "transparent", color: "var(--muted-2)", fontWeight: 600, fontSize: 13, padding: 11, border: "none", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="sz-up" style={{ marginTop: 52, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div className="sz-pop" style={{ width: 70, height: 70, borderRadius: 100, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", display: "flex" }}><Check size={34} width={2.4} /></span>
            </div>
            <h2 style={{ marginTop: 26, fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.04, color: "var(--ink)" }}>{doneTitle}</h2>
            <p style={{ marginTop: 13, maxWidth: 300, fontSize: 15, lineHeight: 1.55, color: "var(--muted)" }}>{doneBody}</p>
            <button onClick={onClose} className="sz-hover" style={{ marginTop: 32, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--ink)", color: "var(--bg)", fontWeight: 600, fontSize: 15, padding: 16, border: "none", borderRadius: 100, cursor: "pointer" }}>{mode === "create" ? "Brief your first trip" : "Go to my trips"} →</button>
          </div>
        )}
      </div>
    </>
  );
}

const pillBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line)",
  color: "var(--muted)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  padding: "8px 13px",
  borderRadius: 100,
  cursor: "pointer",
};

const scrim: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 40,
  background: "rgba(6,7,8,.72)",
  backdropFilter: "blur(3px)",
};

const drawer: React.CSSProperties = {
  position: "fixed",
  zIndex: 41,
  top: 0,
  right: 0,
  bottom: 0,
  width: "min(420px,88vw)",
  background: "var(--bg)",
  borderLeft: "1px solid var(--line)",
  padding: "26px 24px",
  overflowY: "auto",
};

const drawerTitle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "var(--muted-2)",
};
