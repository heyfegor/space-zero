/**
 * Space Zero — place → IATA resolution (deterministic).
 *
 * A modest built-in city/airport table so a persisted trip's free-text origin
 * and destination can be turned into the IATA codes Duffel needs. Already-valid
 * 3-letter codes pass through. Unresolvable places return null so the search can
 * report an honest "couldn't resolve" state rather than guessing.
 *
 * (A later phase can back this with Duffel's place-suggestions API.)
 */

const CITY_TO_IATA: Record<string, string> = {
  london: "LHR",
  "new york": "JFK",
  paris: "CDG",
  berlin: "BER",
  lisbon: "LIS",
  madrid: "MAD",
  rome: "FCO",
  amsterdam: "AMS",
  frankfurt: "FRA",
  barcelona: "BCN",
  dublin: "DUB",
  oslo: "OSL",
  nice: "NCE",
  reykjavik: "KEF",
  "reykjavík": "KEF",
  sydney: "SYD",
  melbourne: "MEL",
  tokyo: "HND",
  singapore: "SIN",
  dubai: "DXB",
  doha: "DOH",
  "hong kong": "HKG",
  bangkok: "BKK",
  "los angeles": "LAX",
  "san francisco": "SFO",
  chicago: "ORD",
  boston: "BOS",
  toronto: "YYZ",
  cairo: "CAI",
  "cape town": "CPT",
  johannesburg: "JNB",
  mumbai: "BOM",
  delhi: "DEL",
};

/** Resolve a free-text place to an IATA code, or null if unknown. */
export function resolvePlaceToIata(place: string | undefined | null): string | null {
  if (!place) return null;
  const trimmed = place.trim();
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();

  // Drop a trailing country/qualifier ("Sydney, AU" → "Sydney") and lowercase.
  const city = trimmed.split(",")[0].trim().toLowerCase();
  if (CITY_TO_IATA[city]) return CITY_TO_IATA[city];

  // Try the first significant word (handles "Sydney Australia").
  const firstWord = city.split(/\s+/)[0];
  if (CITY_TO_IATA[firstWord]) return CITY_TO_IATA[firstWord];

  return null;
}
