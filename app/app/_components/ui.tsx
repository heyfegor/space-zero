"use client";

/**
 * Space Zero — small shared UI primitives for the product flow.
 *
 * Deliberately minimal: icons, the wordmark, the back control, and a few style
 * constants that recur on every screen. Anything used on only one screen stays
 * inline in that screen rather than being lifted here.
 */

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// --- Icons (inline SVG, currentColor) --------------------------------------

export function ChevronLeft({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ChevronRight({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function Check({ size = 15, width = 3 }: { size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function Lock({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function Clock({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function Pencil({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export function Alert({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

export function Warn({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v5M12 16.5v.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

// --- Wordmark + back button -------------------------------------------------

export function Wordmark() {
  return (
    <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--ink)", whiteSpace: "nowrap" }}>
      Space&nbsp;Zero
    </span>
  );
}

export function BackButton({ href }: { href: string }) {
  return (
    <Link href={href} className="sz-hover" aria-label="Back" style={iconButton}>
      <ChevronLeft />
    </Link>
  );
}

// --- Shared style constants -------------------------------------------------

export const iconButton: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line)",
  color: "var(--muted)",
  width: 32,
  height: 32,
  borderRadius: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

export const eyebrow: CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "var(--accent)",
};

export const h1: CSSProperties = {
  fontSize: "clamp(30px,8.5vw,40px)",
  lineHeight: 1.02,
  fontWeight: 700,
  letterSpacing: "-0.035em",
  color: "var(--ink)",
};

export const lead: CSSProperties = {
  marginTop: 12,
  fontSize: 15,
  lineHeight: 1.55,
  color: "var(--muted)",
};

export const card: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 14,
  background: "var(--surface)",
};

/** Solid "ink" CTA (dark text-on-ink); the neutral primary action. */
export const ctaSolid: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
  background: "var(--ink)",
  color: "var(--bg)",
  fontWeight: 600,
  fontSize: 15,
  padding: 17,
  border: "none",
  borderRadius: 100,
  cursor: "pointer",
};

/** Signal-orange CTA with white label, matching the designs' primary accent. */
export const ctaAccent: CSSProperties = {
  ...ctaSolid,
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 700,
};

/** The boundary/authority reassurance panel used on several screens. */
export function BoundaryNote({ children }: { children: ReactNode }) {
  return (
    <div className="sz-up" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "flex-start", border: "1px solid rgba(228,87,46,.4)", borderRadius: 14, background: "var(--surface)", padding: "15px 18px" }}>
      <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}>
        <Lock />
      </span>
      <p style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)" }}>{children}</p>
    </div>
  );
}
