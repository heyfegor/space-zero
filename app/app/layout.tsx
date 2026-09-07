"use client";

/**
 * Space Zero — product-flow layout. Wraps every /app/* screen in the shared
 * flow state and applies the active theme via a `data-theme` wrapper, so the
 * design-system CSS variables (and thus every screen) respond to the toggle.
 *
 * This layout persists across client-side navigation between the product
 * screens, so the trip-flow state and chosen theme survive Landing → Product →
 * TripPlan → … without a store framework. The marketing Landing (app/page.tsx)
 * is outside this subtree and stays dark.
 */

import type { ReactNode } from "react";
import { FlowProvider, useFlow } from "./_lib/flow";

function ThemedShell({ children }: { children: ReactNode }) {
  const { theme } = useFlow();
  return (
    <div data-theme={theme} style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)", display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <FlowProvider>
      <ThemedShell>{children}</ThemedShell>
    </FlowProvider>
  );
}
