"use client";

/**
 * Space Zero — sticky bottom action bar. Holds a single primary CTA (a button
 * or a next-screen link) over a fade so content scrolls cleanly beneath it.
 */

import type { ReactNode } from "react";

export function PageFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 20,
        background: "linear-gradient(to top, var(--bg) 62%, rgba(var(--bgr),0))",
        padding: "22px 20px calc(22px + env(safe-area-inset-bottom))",
      }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto" }}>{children}</div>
    </div>
  );
}
