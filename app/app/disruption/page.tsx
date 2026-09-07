"use client";

/**
 * Space Zero — Disruption. Ported from Disruption.dc.html.
 *
 * A deterministic demo of a live disruption on the LHR → SIN → SYD trip (no
 * FlightAware yet). It shows the event, the broken connection, the still-held
 * requirement, the operator's operational steps (never chain-of-thought), and
 * the best alternative with its authority check. Values match the backend
 * recovery fixture: +£96 within the £150 recovery allowance.
 *
 * "See resolution" continues to the Resolution screen.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFlow, money } from "../_lib/flow";
import { PageHeader } from "../_components/PageHeader";
import { TimelineStep, type StepStatus } from "../_components/TimelineStep";
import { Wordmark, Alert, Clock, ctaSolid } from "../_components/ui";

const STEPS = [
  { label: "Finding alternatives", detail: "Routes that still land before your deadline" },
  { label: "Comparing on cost and arrival", detail: "Ranking against your original trip" },
  { label: "Checking your authority", detail: "Testing cost against your recovery allowance" },
];

export default function Disruption() {
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
