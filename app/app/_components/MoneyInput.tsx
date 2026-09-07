"use client";

/**
 * Space Zero — the funding amount stepper (Funding screen).
 *
 * A large editable amount with −/+ controls and quick presets. Pure UI over a
 * number value the parent owns; it makes no funding claim itself.
 */

import { useState } from "react";
import { money } from "../_lib/flow";

export interface Preset {
  label: string;
  value: number;
}

export function MoneyInput({
  amount,
  onChange,
  currency = "GBP",
  step = 50,
  presets = [],
}: {
  amount: number;
  onChange: (n: number) => void;
  currency?: string;
  step?: number;
  presets?: Preset[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => { setDraft(String(amount)); setEditing(true); };
  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n)) onChange(Math.max(0, n));
    setEditing(false);
  };
  const set = (n: number) => { onChange(Math.max(0, n)); setEditing(false); };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18 }}>
        <button onClick={() => set(amount - step)} className="sz-hover" aria-label="Decrease" style={stepBtn}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M5 12h14" /></svg>
        </button>
        <div style={{ minWidth: 150, textAlign: "center" }}>
          {editing ? (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              inputMode="numeric"
              autoFocus
              className="mono"
              style={{ width: 190, textAlign: "center", background: "transparent", border: "none", borderBottom: "2px solid var(--accent)", color: "var(--ink)", fontSize: 42, fontWeight: 700, letterSpacing: "-0.02em", padding: "0 0 4px", outline: "none" }}
            />
          ) : (
            <button onClick={startEdit} className="sz-hover" style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "text", background: "transparent", border: "none", padding: 0 }}>
              <span className="mono" style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--ink)", lineHeight: 1 }}>{money(amount, currency)}</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            </button>
          )}
        </div>
        <button onClick={() => set(amount + step)} className="sz-hover" aria-label="Increase" style={stepBtn}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>

      {presets.length > 0 && (
        <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
          {presets.map((p) => {
            const active = amount === p.value;
            return (
              <button
                key={p.label}
                onClick={() => set(p.value)}
                className="sz-hover mono"
                style={{ fontSize: 12, fontWeight: 500, color: active ? "var(--accent)" : "var(--muted)", background: active ? "rgba(228,87,46,.1)" : "transparent", border: `1px solid ${active ? "rgba(228,87,46,.45)" : "var(--line)"}`, borderRadius: 100, padding: "7px 14px", cursor: "pointer" }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 100,
  border: "1px solid var(--line)",
  background: "var(--surface-2)",
  color: "var(--ink-2)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
