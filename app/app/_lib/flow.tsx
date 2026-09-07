"use client";

/**
 * Space Zero — client-side trip-flow state (frontend only).
 *
 * This is temporary, in-session state that carries a trip through the product
 * screens (Product → TripPlan → Options → Funding → Authorization → Execution
 * → Trips). It is NOT persistence and makes no server claims: it holds the
 * user's edits and selections so the next screen can render them.
 *
 * The shape is designed so each field maps cleanly onto real persisted/server
 * data later (the domain Trip, a Duffel option, an Airwallex funding record)
 * without the screens needing to change.
 *
 * Authority remains authoritative on the SERVER. The `authority` values here are
 * only the user's chosen settings that get sent to /api/agent; the deterministic
 * backend still enforces them.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

// --- Types the screens expect (frontend view models) -----------------------

/** Structured trip intent, parsed from the free-text brief (demo values here). */
export interface TripIntent {
  origin: string;
  destination: string;
  /** Human label, e.g. "Before 10:00, Fri 12 Sep". */
  arriveBy: string;
  depart: string;
  budget: number;
  recoveryAllowance: number;
  cabin: string;
  baggage: string;
  seat: string;
  /** The non-negotiable arrival requirement, highlighted on TripPlan. */
  hardArrival: string;
  currency: string;
}

/** A journey option shown on Options. Shaped to accept real Duffel data later. */
export interface FlightOption {
  id: string;
  tag: string;
  recommended: boolean;
  cost: number;
  currency: string;
  a: string;
  b: string;
  c: string;
  duration: string;
  stops: string;
  via: string;
  arrive: string;
}

// Mirrors the server funding lifecycle (src/domain/funding.ts). Used only by the
// standalone demo fallback; the persisted Funding screen drives real state.
export type FundingStatus = "UNFUNDED" | "PROCESSING" | "FUNDED" | "INSUFFICIENT";

/** The user's delegated-authority settings (sent to the server, enforced there). */
export interface AuthoritySettings {
  budget: number;
  recoveryAllowance: number;
  autoBook: boolean;
  autoRecovery: boolean;
}

export type Theme = "dark" | "light";

// --- Demo defaults (consistent with the deterministic backend fixtures) -----

const DEMO_INTENT: TripIntent = {
  origin: "London (LHR)",
  destination: "Sydney, AU",
  arriveBy: "Before 09:00, Sun 6 Sep",
  depart: "Fri 4 Sep, flexible",
  budget: 1200,
  recoveryAllowance: 150,
  cabin: "Economy",
  baggage: "1 checked bag",
  seat: "Aisle preferred",
  hardArrival: "Must arrive before 09:00, Sun 6 Sep",
  currency: "GBP",
};

/** Journey options — deterministic demo, matching the LHR → SIN → SYD trip.
 *  Structured so real search results can replace this array verbatim. */
const DEMO_OPTIONS: FlightOption[] = [
  { id: "opt_sin", tag: "Recommended", recommended: true, cost: 1468, currency: "GBP", a: "LHR", b: "SIN", c: "SYD", duration: "22h 05m", stops: "1 stop", via: "Singapore", arrive: "08:40 Sun" },
  { id: "opt_dxb", tag: "Cheapest", recommended: false, cost: 1190, currency: "GBP", a: "LHR", b: "DXB", c: "SYD", duration: "24h 40m", stops: "1 stop", via: "Dubai", arrive: "08:15 Sun" },
  { id: "opt_doh", tag: "Earliest arrival", recommended: false, cost: 1495, currency: "GBP", a: "LHR", b: "DOH", c: "SYD", duration: "20h 15m", stops: "1 stop", via: "Doha", arrive: "07:30 Sun" },
];

// --- Context ----------------------------------------------------------------

interface FlowValue {
  theme: Theme;
  toggleTheme: () => void;

  brief: string;
  setBrief: (v: string) => void;

  intent: TripIntent;
  updateIntent: (patch: Partial<TripIntent>) => void;

  options: FlightOption[];
  selectedOptionId: string;
  setSelectedOptionId: (id: string) => void;
  selectedOption: FlightOption;
  estimatedCost: number;

  funding: number;
  setFunding: (n: number) => void;
  fundingStatus: FundingStatus;
  setFundingStatus: (s: FundingStatus) => void;

  authority: AuthoritySettings;
  updateAuthority: (patch: Partial<AuthoritySettings>) => void;
}

const FlowContext = createContext<FlowValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [brief, setBrief] = useState("");
  const [intent, setIntent] = useState<TripIntent>(DEMO_INTENT);
  const [selectedOptionId, setSelectedOptionId] = useState(DEMO_OPTIONS[0].id);
  const [fundingStatus, setFundingStatus] = useState<FundingStatus>("UNFUNDED");
  const [authority, setAuthority] = useState<AuthoritySettings>({
    budget: 1500,
    recoveryAllowance: DEMO_INTENT.recoveryAllowance,
    autoBook: true,
    autoRecovery: true,
  });

  const selectedOption =
    DEMO_OPTIONS.find((o) => o.id === selectedOptionId) ?? DEMO_OPTIONS[0];
  const estimatedCost = selectedOption.cost;

  // Default the funding amount to a sensible buffer above the estimate.
  const [funding, setFunding] = useState(() => roundUp(estimatedCost * 1.12, 50));

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );
  const updateIntent = useCallback(
    (patch: Partial<TripIntent>) => setIntent((prev) => ({ ...prev, ...patch })),
    [],
  );
  const updateAuthority = useCallback(
    (patch: Partial<AuthoritySettings>) => setAuthority((prev) => ({ ...prev, ...patch })),
    [],
  );

  // Overscroll polish: paint the document background in the active theme, and
  // reset when the provider unmounts (e.g. navigating back to the Landing page).
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = theme === "light" ? "#f4f2ec" : "#0e0f11";
    return () => {
      document.body.style.background = prev;
    };
  }, [theme]);

  const value = useMemo<FlowValue>(
    () => ({
      theme,
      toggleTheme,
      brief,
      setBrief,
      intent,
      updateIntent,
      options: DEMO_OPTIONS,
      selectedOptionId,
      setSelectedOptionId,
      selectedOption,
      estimatedCost,
      funding,
      setFunding,
      fundingStatus,
      setFundingStatus,
      authority,
      updateAuthority,
    }),
    [
      theme, toggleTheme, brief, intent, updateIntent, selectedOptionId,
      selectedOption, estimatedCost, funding, fundingStatus, authority, updateAuthority,
    ],
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowValue {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error("useFlow must be used within <FlowProvider>.");
  return ctx;
}

// --- Small shared formatting helpers ---------------------------------------

export function money(amount: number, currency = "GBP"): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency + " ";
  return `${symbol}${Math.max(0, Math.round(amount)).toLocaleString("en-GB")}`;
}

function roundUp(n: number, step: number): number {
  return Math.ceil(n / step) * step;
}
