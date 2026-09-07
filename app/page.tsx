"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

/* Space Zero — Landing (marketing). Ported from Landing.dc.html (visual source
   of truth). Primary CTAs route to the real product flow at /app. */

const HEAD_MAP: [string, string][] = [
  ["MONITORING", "var(--accent)"],
  ["DISRUPTION DETECTED", "var(--disruption)"],
  ["EVALUATING RECOVERY", "var(--accent)"],
  ["CHECKING AUTHORITY", "var(--accent)"],
  ["REBOOKING", "var(--accent)"],
  ["RESOLVED", "var(--ink)"],
  ["RESOLVED", "var(--ink)"],
];

type Ledger = { at: number; t: string; el: ReactNode };
const LEDGER: Ledger[] = [
  { at: 1, t: "04:31", el: "Flight LHR to SIN delayed by 3h00" },
  { at: 2, t: "04:32", el: "Singapore connection no longer viable · 3 alternatives found" },
  {
    at: 4,
    t: "04:33",
    el: (
      <span>
        Authority check{"  "}
        <span style={{ color: "var(--accent)", fontWeight: 700 }}>+£96</span>
        {"  "}within{"  "}£150{"  "}
        <span style={{ color: "var(--accent)", fontWeight: 700 }}>permitted</span>
      </span>
    ),
  },
  { at: 5, t: "04:34", el: "Rebooked SIN to SYD · new arrival 08:40 Sat · conf SZ 4471" },
];

const STEPS = [
  { n: "01", title: "Describe the trip", body: "One brief. Where you need to be, by when, and the budget you will allow." },
  { n: "02", title: "Set the boundaries", body: "A trip budget and a recovery allowance. Space Zero acts freely inside them." },
  { n: "03", title: "It operates the journey", body: "It books, then monitors every leg in the background without asking you to watch." },
  { n: "04", title: "It fixes what breaks", body: "When reality changes, it recovers the trip inside your rules and reports the outcome." },
];

const REASONS = [
  { title: "It takes responsibility", body: "You hand over the objective, not a list of tabs to manage. Space Zero owns the journey end to end." },
  { title: "It acts inside your limits", body: "Every decision is bounded by the authority you grant. It cannot spend past your limit." },
  { title: "It resolves, it does not escalate", body: "Most disruptions are fixed before you would have noticed. You get the outcome, calmly." },
  { title: "It asks only when it must", body: "When a fix exceeds your rules, it stops and hands you one clear decision, never twenty options." },
];

const FAQS = [
  { q: "Do I need to plan anything myself?", a: "No. You give Space Zero the objective and your limits. It plans, books and manages the journey inside those limits." },
  { q: "What can it spend without asking?", a: "Only what you allow. You set a recovery allowance, and Space Zero can act up to that figure. Past it, the rule is enforced and it stops to ask you." },
  { q: "What happens when a flight is disrupted?", a: "It detects the disruption, finds the best alternative, checks it against your recovery allowance, and rebooks if it is permitted. You receive the outcome, not the crisis." },
  { q: "Can it act completely on its own?", a: "Only inside the authority you grant. Every action is bounded by the limits you set, and the boundary is enforced by the system, not by the agent." },
];

function RecoveryBoard() {
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);

  function play() {
    if (timer.current) clearInterval(timer.current);
    startedRef.current = true;
    setStarted(true);
    setRunning(true);
    setStep(0);
    let s = 0;
    timer.current = setInterval(() => {
      s += 1;
      if (s >= 6) {
        if (timer.current) clearInterval(timer.current);
        setStep(6);
        setRunning(false);
        return;
      }
      setStep(s);
    }, 1050);
  }

  useEffect(() => {
    const onScroll = () => {
      if (startedRef.current) return;
      const el = boardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.55 && r.bottom > 60) play();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const h = started ? HEAD_MAP[Math.min(step, 6)] : ["MONITORING", "var(--accent)"];
  const visibleLedger = LEDGER.filter((l) => started && step >= l.at);
  const runLabel = !started ? "RUN RECOVERY" : running ? "RUNNING" : "REPLAY";
  const runIcon = !started ? "▶" : "↻";

  return (
    <section id="recovery" ref={boardRef} style={{ maxWidth: 720, margin: "0 auto", padding: "80px 22px" }}>
      <div className="mono" style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent)" }}>
        The moment that matters
      </div>
      <h2 style={{ marginTop: 16, fontSize: "clamp(30px,5.6vw,48px)", lineHeight: 1.04, fontWeight: 700, letterSpacing: "-0.03em" }}>
        When travel breaks, Space Zero fixes it.
      </h2>
      <p style={{ marginTop: 18, fontSize: 18, lineHeight: 1.55, color: "var(--muted)", maxWidth: "52ch" }}>
        Flight delayed 3 hours. Your route no longer works. Space Zero finds an alternative within your spending limit and rebooks it automatically, saving you from delay and stress.
      </p>

      <div className="mono" style={{ marginTop: 30, display: "flex", alignItems: "center", gap: 11, fontSize: 12, letterSpacing: "0.08em" }}>
        <span style={{ position: "relative", width: 9, height: 9, borderRadius: "50%", background: h[1], flex: "none" }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: h[1], animation: h[0] === "MONITORING" ? "sz-pulse 2.4s ease-in-out infinite" : "none" }} />
        </span>
        <span style={{ color: h[1], fontWeight: 500 }}>{h[0]}</span>
      </div>

      <div className="mono" style={{ marginTop: 20, borderTop: "1px solid var(--line)" }}>
        {visibleLedger.map((l, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, padding: "13px 2px", borderBottom: "1px solid var(--line-2)", fontSize: 12, letterSpacing: "0.04em" }}>
            <span style={{ color: "var(--faint)" }}>{l.t}</span>
            <span style={{ color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis" }}>{l.el}</span>
          </div>
        ))}
        {running && step >= 1 && (
          <span style={{ display: "inline-block", color: "var(--accent)", animation: "sz-caret 1s step-end infinite", padding: "8px 2px" }}>▊</span>
        )}
      </div>

      <button
        onClick={play}
        className="mono"
        style={{
          marginTop: 22, display: "inline-flex", alignItems: "center", gap: 9,
          background: !started ? "var(--accent)" : "transparent",
          color: !started ? "var(--bg)" : "var(--muted-2)",
          border: `1px solid ${!started ? "var(--accent)" : "var(--line-3)"}`,
          borderRadius: 100, padding: "13px 22px", fontSize: 12, letterSpacing: "0.08em", cursor: "pointer",
        }}
      >
        <span>{runIcon}</span> {runLabel}
      </button>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section style={{ maxWidth: 720, margin: "0 auto", padding: "80px 22px" }}>
      <h2 style={{ fontSize: "clamp(34px,7vw,60px)", lineHeight: 1, fontWeight: 700, letterSpacing: "-0.035em" }}>Questions</h2>
      <div style={{ marginTop: 40 }}>
        {FAQS.map((f, i) => {
          const isOpen = open === i + 1;
          return (
            <div key={i} onClick={() => setOpen(isOpen ? 0 : i + 1)} style={{ borderTop: "1px solid var(--line)", padding: "22px 0", cursor: "pointer" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
                <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: isOpen ? "var(--accent)" : "var(--ink)" }}>{f.q}</span>
                <span className="mono" style={{ fontSize: 20, color: "var(--muted-2)" }}>{isOpen ? "−" : "+"}</span>
              </div>
              <div style={{ maxHeight: isOpen ? 200 : 0, overflow: "hidden", transition: "max-height .3s ease" }}>
                <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.55, color: "var(--muted)", maxWidth: "52ch" }}>{f.a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div id="top">
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 22px", maxWidth: 1120, margin: "0 auto" }}>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Space Zero</span>
        <Link href="/app" className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--ink)", border: "1px solid var(--line-3)", padding: "10px 16px", borderRadius: 100, whiteSpace: "nowrap" }}>
          PLAN A TRIP ↗
        </Link>
      </nav>

      <header style={{ position: "relative", minHeight: "82vh", display: "flex", alignItems: "center", padding: "60px 22px 90px" }}>
        <div style={{ textAlign: "center", maxWidth: 820, margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(52px,13vw,116px)", lineHeight: 0.92, fontWeight: 700, letterSpacing: "-0.045em", textWrap: "balance" }}>
            Your trip<br />runs <span style={{ color: "var(--accent)" }}>itself.</span>
          </h1>
          <p style={{ margin: "30px auto 0", fontSize: 18, lineHeight: 1.55, color: "var(--muted)", maxWidth: "40ch" }}>
            Tell Space Zero where you need to go, when you need to arrive, and how much you&apos;re willing to spend and it handles the rest.
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 36, flexWrap: "wrap" }}>
            <Link href="/app" style={{ background: "var(--ink)", color: "var(--bg)", fontWeight: 600, fontSize: 16, padding: "15px 28px", borderRadius: 100 }}>Plan a trip ↗</Link>
            <a href="#recovery" style={{ background: "var(--surface-3)", color: "var(--ink)", fontWeight: 600, fontSize: 16, padding: "15px 28px", borderRadius: 100, border: "1px solid var(--line-3)" }}>See it recover a trip</a>
          </div>
        </div>
      </header>

      <section style={{ maxWidth: 720, margin: "0 auto", padding: "80px 22px" }}>
        <div className="mono" style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent)" }}>The problem</div>
        <h2 style={{ marginTop: 16, fontSize: "clamp(30px,5.6vw,48px)", lineHeight: 1.04, fontWeight: 700, letterSpacing: "-0.03em" }}>Travel shouldn&apos;t be a complex process.</h2>
        <p style={{ marginTop: 18, fontSize: 18, lineHeight: 1.55, color: "var(--muted)", maxWidth: "52ch" }}>
          A lot of people still carry out their travel tasks manually. They have to search for flights themselves, and even book and pay for it themselves. And then after this they still experience delays and cancellation. All of this leads to waste of time, money, and effort. You shouldn&apos;t go through all that.
        </p>
      </section>

      <RecoveryBoard />

      <section style={{ maxWidth: 720, margin: "0 auto", padding: "80px 22px" }}>
        <h2 style={{ fontSize: "clamp(34px,7vw,60px)", lineHeight: 1, fontWeight: 700, letterSpacing: "-0.035em" }}>Give it the trip. Stay in control.</h2>
        <div style={{ marginTop: 52 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 20 }}>
              <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                <div style={{ position: "absolute", top: 6, bottom: -42, width: 1.5, background: "var(--line)" }} />
                <div style={{ position: "relative", zIndex: 1, width: 11, height: 11, borderRadius: "50%", background: "var(--accent)", marginTop: 6 }} />
              </div>
              <div style={{ paddingBottom: 42 }}>
                <div className="mono" style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted-2)" }}>{s.n}</div>
                <h3 style={{ marginTop: 8, fontSize: 23, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.title}</h3>
                <p style={{ marginTop: 8, fontSize: 17, lineHeight: 1.5, color: "var(--muted)", maxWidth: "48ch" }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 720, margin: "0 auto", padding: "80px 22px" }}>
        <h2 style={{ fontSize: "clamp(34px,7vw,60px)", lineHeight: 1, fontWeight: 700, letterSpacing: "-0.035em" }}>Why Space Zero?</h2>
        <div className="sz-why" style={{ marginTop: 44, display: "grid", gridTemplateColumns: "1fr", gap: 0 }}>
          {REASONS.map((r, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--line)", padding: "26px 0" }}>
              <span style={{ color: "var(--accent)", fontSize: 18 }}>✓</span>
              <h3 style={{ marginTop: 14, fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em" }}>{r.title}</h3>
              <p style={{ marginTop: 8, fontSize: 16, lineHeight: 1.5, color: "var(--muted)", maxWidth: "46ch" }}>{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      <Faq />

      <section id="cta" style={{ background: "var(--accent)", color: "var(--bg)", marginTop: 40 }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "96px 22px 60px" }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--bg)", opacity: 0.7 }}>Ready when you are</div>
          <h2 style={{ marginTop: 24, fontSize: "clamp(48px,13vw,112px)", lineHeight: 0.9, fontWeight: 700, letterSpacing: "-0.05em" }}>Stop coordinating<br />your trip.</h2>
          <p style={{ marginTop: 24, fontSize: 18, lineHeight: 1.5, maxWidth: "42ch", color: "var(--bg)", opacity: 0.82 }}>Tell Space Zero where you&apos;re going. Let it handle the work between here and there.</p>
          <div style={{ marginTop: 40 }}>
            <Link href="/app" style={{ background: "var(--bg)", color: "var(--ink)", fontWeight: 600, fontSize: 17, padding: "16px 32px", borderRadius: 100, display: "inline-block" }}>Plan a trip ↗</Link>
          </div>
          <div className="mono" style={{ marginTop: 80, paddingTop: 22, borderTop: "1px solid rgba(14,15,17,.25)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--bg)", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>Space Zero</span>
            <span style={{ opacity: 0.7 }}>Autonomous travel operator · 2026</span>
          </div>
        </div>
      </section>
    </div>
  );
}
