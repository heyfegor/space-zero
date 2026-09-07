/**
 * Space Zero — trip-intent parser (server-side, deterministic).
 *
 * Turns a free-text brief into a structured, VALIDATED TripIntent. It is
 * deterministic (regex/keyword heuristics), so it needs no model and produces
 * the same output every run — the traveler refines the result on TripPlan.
 *
 * A model-assisted parser (via the existing Strands infrastructure) can later
 * replace the body of parseBrief() behind this exact boundary. Even then, the
 * model's output MUST pass through tripIntentSchema before it is used — the
 * model never writes to the database; deterministic code does.
 */

import type { TripIntent } from "../../domain/trip";
import { tripIntentSchema } from "./schemas";

function firstNumber(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseOrigin(brief: string): string | undefined {
  // "from London", "leaving London", "out of LHR", "departing from Berlin"
  const m = brief.match(
    /\b(?:from|leaving(?:\s+from)?|out of|departing(?:\s+from)?)\s+([A-Z][A-Za-z .'-]+?)(?:[,.;]|\s+(?:to|for|before|by|on|under|next|this)\b|$)/,
  );
  return m && m[1] ? m[1].trim() : undefined;
}

function parseDestination(brief: string): string {
  // "to Sydney", "get me to Sydney", "in Sydney", "fly to Tokyo"
  const patterns = [
    /\b(?:get me to|fly to|travel to|go to|trip to|need to be in|be in|to)\s+([A-Z][A-Za-z .'-]+?)(?:[,.;]|\s+(?:by|before|on|arriving|arrive|for|under|next|this|from)\b|$)/,
    /\b(?:in)\s+([A-Z][A-Za-z .'-]+?)(?:[,.;]|\s+(?:by|before|on)\b|$)/,
  ];
  for (const re of patterns) {
    const m = brief.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return "";
}

function parseArriveBy(brief: string): string | undefined {
  const m = brief.match(/\b(?:arrive|arriving|land|be there)\b[^.,;]*?\b(before|by)\b\s*([^.,;]+)/i)
    ?? brief.match(/\b(before|by)\b\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?[^.,;]*)/i);
  if (m) {
    const phrase = (m[2] ?? "").trim();
    if (phrase) return `Before ${phrase.replace(/^(before|by)\s+/i, "")}`.trim();
  }
  return undefined;
}

function parseDepart(brief: string): string | undefined {
  const m = brief.match(/\b(?:depart|departing|leave|leaving|fly out)\b[^.,;]*?\b(on|from)?\s*([^.,;]+)/i);
  if (m && m[2]) return m[2].trim();
  return undefined;
}

function parseBudget(brief: string): number | undefined {
  const m = brief.match(/\b(?:under|below|budget(?:\s+of)?|keep it under|max(?:imum)?|no more than)\D{0,12}?[£$€]?\s*([\d,]+)/i)
    ?? brief.match(/[£$€]\s*([\d,]{3,})/);
  return firstNumber(m?.[1]);
}

function parseRecoveryAllowance(brief: string): number | undefined {
  // Phrasings that tie a figure to disruptions/fixing/recovery.
  const m =
    brief.match(/\b(?:up to)\s*[£$€]?\s*([\d,]+)\D{0,24}?(?:disruption|fix|recover|delay|without asking)/i) ??
    brief.match(/(?:disruption|fix|recover|delay|without asking)\D{0,24}?[£$€]?\s*([\d,]+)/i) ??
    brief.match(/\b(?:recovery allowance|allowance)\D{0,12}?[£$€]?\s*([\d,]+)/i);
  return firstNumber(m?.[1]);
}

function parseCabin(brief: string): string | undefined {
  const m = brief.match(/\b(premium economy|business class|business|first class|first|economy)\b/i);
  if (!m) return undefined;
  const v = m[1].toLowerCase();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
};

function parseBaggage(brief: string): string | undefined {
  const m = brief.match(
    /\b(\d+|a|an|one|two|three|four|five)\s*(?:checked\s*bags?|bags?|suitcases?|luggage)\b/i,
  );
  if (m) {
    const token = m[1].toLowerCase();
    const n = /^\d+$/.test(token) ? parseInt(token, 10) : (WORD_NUMBERS[token] ?? 1);
    return `${n} checked bag${n === 1 ? "" : "s"}`;
  }
  if (/\b(?:carry[-\s]?on only|hand luggage only|no checked bags?)\b/i.test(brief)) return "Carry-on only";
  return undefined;
}

function parseSeat(brief: string): string | undefined {
  const m = brief.match(/\b(aisle|window|middle)\b/i);
  if (!m) return undefined;
  const v = m[1].toLowerCase();
  return `${v.charAt(0).toUpperCase()}${v.slice(1)} preferred`;
}

/**
 * Parse a brief into a validated TripIntent. Throws (via Zod) only if the
 * heuristic somehow produces an out-of-range value; in normal use it always
 * returns a valid intent with empty/undefined fields the user can fill in.
 */
export function parseBrief(brief: string): TripIntent {
  const intent = {
    origin: parseOrigin(brief),
    destination: parseDestination(brief),
    arriveBy: parseArriveBy(brief),
    depart: parseDepart(brief),
    budget: parseBudget(brief),
    recoveryAllowance: parseRecoveryAllowance(brief),
    cabin: parseCabin(brief),
    baggage: parseBaggage(brief),
    seat: parseSeat(brief),
  };
  return tripIntentSchema.parse(intent);
}
