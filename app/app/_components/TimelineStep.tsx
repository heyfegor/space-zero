"use client";

/**
 * Space Zero — a single step in an operator timeline (Execution, Disruption).
 *
 * Renders only an operational label + detail and a status ring (done / active /
 * pending). It never shows model reasoning — callers pass user-safe copy.
 */

import { Check } from "./ui";

export type StepStatus = "done" | "active" | "pending";

export function TimelineStep({
  label,
  detail,
  status,
  last = false,
}: {
  label: string;
  detail?: string;
  status: StepStatus;
  last?: boolean;
}) {
  const done = status === "done";
  const active = status === "active";
  const ringBorder = done || active ? "var(--accent)" : "var(--line)";
  const ringBg = done ? "var(--accent)" : "transparent";
  const lineBg = done ? "var(--accent)" : "var(--line)";
  const textColor = status === "pending" ? "var(--faint)" : "var(--ink)";

  return (
    <div style={{ display: "flex", gap: 15, alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div style={{ width: 30, height: 30, borderRadius: 100, border: `1.5px solid ${ringBorder}`, background: ringBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {done && (
            <span style={{ color: "#fff", display: "flex" }}>
              <Check size={15} />
            </span>
          )}
          {active && (
            <span className="sz-spin" style={{ width: 15, height: 15, borderRadius: 100, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
          )}
          {status === "pending" && (
            <span style={{ width: 7, height: 7, borderRadius: 100, background: "var(--line-3)" }} />
          )}
        </div>
        {!last && <div style={{ width: 1.5, height: 34, background: lineBg }} />}
      </div>
      <div style={{ paddingTop: 4, paddingBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: textColor }}>{label}</div>
        {detail && <div className="mono" style={{ fontSize: 11, letterSpacing: "0.02em", color: "var(--faint)", marginTop: 4 }}>{detail}</div>}
      </div>
    </div>
  );
}
