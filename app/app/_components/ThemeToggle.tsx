"use client";

import { useFlow } from "../_lib/flow";
import { iconButton } from "./ui";

/** The sun/moon theme switch present in every product-screen header. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useFlow();
  const isDark = theme === "dark";
  return (
    <button onClick={toggleTheme} className="sz-hover" title="Toggle theme" aria-label="Toggle theme" style={iconButton}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
