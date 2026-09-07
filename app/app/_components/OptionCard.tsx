"use client";

/**
 * Space Zero — a selectable journey option (Options screen).
 *
 * Presentational: it takes a FlightOption plus selection state and reports
 * clicks. Real search results (e.g. Duffel) can populate FlightOption without
 * any change here.
 */

import { Check } from "./ui";
import { money, type FlightOption } from "../_lib/flow";

export function OptionCard({
  option,
  selected,
  onSelect,
}: {
  option: FlightOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const border = selected
    ? "var(--accent)"
    : option.recommended
      ? "rgba(228,87,46,.4)"
      : "var(--line)";
  const shadow = selected ? "0 0 0 4px rgba(228,87,46,.14)" : "none";
  const tagColor = option.recommended ? "var(--accent)" : "var(--muted-2)";
  const tagBorder = option.recommended ? "rgba(228,87,46,.4)" : "var(--line-3)";

  return (
    <div
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className="sz-up sz-hover"
      style={{ border: `1.5px solid ${border}`, boxShadow: shadow, borderRadius: 16, background: "var(--surface)", padding: 18, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
        <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: tagColor, border: `1px solid ${tagBorder}`, borderRadius: 100, padding: "5px 11px" }}>
          {option.recommended && <span style={{ width: 5, height: 5, borderRadius: 100, background: "var(--accent)" }} />}
          {option.tag}
        </span>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--ink)", lineHeight: 1 }}>{money(option.cost, option.currency)}</div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.04em", color: "var(--faint)", marginTop: 4 }}>total, all legs</div>
        </div>
      </div>

      <div className="mono" style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 9, fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>
        <span>{option.a}</span>
        <span style={{ color: "var(--faint)" }}>→</span>
        {option.b && (
          <>
            <span>{option.b}</span>
            <span style={{ color: "var(--faint)" }}>→</span>
          </>
        )}
        <span>{option.c}</span>
      </div>
      <div className="mono" style={{ marginTop: 7, fontSize: 11, letterSpacing: "0.02em", color: "var(--muted-2)", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <span>{option.duration}</span>
        <span style={{ color: "var(--line-3)" }}>·</span>
        <span>{option.stops}</span>
        <span style={{ color: "var(--line-3)" }}>·</span>
        <span>via {option.via}</span>
      </div>

      <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--accent)", display: "flex" }}><Check size={15} width={2.4} /></span>
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>Arrives {option.arrive}</span>
        </div>
        <div style={{ width: 22, height: 22, borderRadius: 100, border: `1.5px solid ${selected ? "var(--accent)" : "var(--line)"}`, background: selected ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {selected && <span style={{ color: "#fff", display: "flex" }}><Check size={12} /></span>}
        </div>
      </div>
    </div>
  );
}
