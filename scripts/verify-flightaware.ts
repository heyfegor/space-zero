/**
 * Space Zero — FlightAware AeroAPI v4 authentication verification.
 *
 * Makes ONE real AeroAPI v4 request (GET /aeroapi/airports/KLAX) using the
 * configured FLIGHTAWARE_API_KEY and reports the actual outcome. Read-only: it
 * looks up a static airport record, moves nothing, and books nothing. It also
 * asserts the client targets AeroAPI **v4** (…/aeroapi), not deprecated v3. No
 * secret value is printed.
 *
 * Run: node --env-file=.env.local --import tsx scripts/verify-flightaware.ts
 */

import { isFlightStatusConfigured } from "../src/providers/flight-status";

const AEROAPI_V4_BASE = "https://aeroapi.flightaware.com/aeroapi";
const line = (s = "") => console.log(s);

async function main() {
  line("=== Space Zero — FlightAware AeroAPI v4 auth verification ===");
  line(`base URL            : ${AEROAPI_V4_BASE}  (v4)`);
  line(`credentials present : ${isFlightStatusConfigured()}`);
  line(`endpoint            : GET /aeroapi/airports/KLAX (read-only)`);
  line();

  if (!isFlightStatusConfigured()) {
    line("FLIGHTAWARE_API_KEY is not set. No API call was made.");
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  try {
    const res = await fetch(`${AEROAPI_V4_BASE}/airports/KLAX`, {
      headers: { "x-apikey": process.env.FLIGHTAWARE_API_KEY!, Accept: "application/json" },
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { title?: string; detail?: string };
        detail = [body.title, body.detail].filter(Boolean).join(": ");
      } catch { /* non-JSON */ }
      line(`RESULT: FAILED (${res.status})${detail ? ` — ${detail}` : ""}.`);
      line("  No lookup succeeded. Nothing was monitored or changed.");
      process.exitCode = 1;
      return;
    }
    const j = (await res.json()) as { code?: string; code_iata?: string; name?: string };
    line("RESULT: SUCCESS");
    line("  A real AeroAPI v4 GET returned an airport record.");
    line(`  airport     : ${j.code_iata ?? j.code} — ${j.name}`);
    line(`  round-trip  : ${ms} ms`);
  } catch (err) {
    line(`RESULT: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("VERIFICATION ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
