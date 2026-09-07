"use client";

/**
 * Space Zero — sticky app-bar shared by every product screen.
 *
 * The designs vary the three slots (a back control, an optional centered
 * wordmark, right-side actions) but the frame is identical everywhere, so it
 * lives here. The theme toggle is always the last right-side control.
 */

import type { ReactNode } from "react";
import { BackButton } from "./ui";
import { ThemeToggle } from "./ThemeToggle";

export function PageHeader({
  back,
  left,
  center,
  right,
}: {
  /** If set, render a back chevron linking here in the left slot. */
  back?: string;
  /** Override the left slot entirely (takes precedence over `back`). */
  left?: ReactNode;
  /** Centered content, typically the wordmark. */
  center?: ReactNode;
  /** Extra right-side controls, placed before the theme toggle. */
  right?: ReactNode;
}) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(var(--bgr),.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--surface-3)" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          {left ?? (back ? <BackButton href={back} /> : <span style={{ width: 1 }} />)}
        </div>
        {center ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{center}</div> : null}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {right}
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
