/**
 * Space Zero — Airwallex sandbox authentication verification (NOT production).
 *
 * Makes a REAL request to Airwallex's authentication endpoint
 * (POST /api/v1/authentication/login) using the credentials in the environment,
 * and reports the actual outcome. It does NOT move money, provision a card, or
 * fund anything — it verifies only that the configured sandbox credentials can
 * obtain an API access token. No secret value (client id, api key, or token) is
 * printed; on success it reports the token's length and expiry, nothing more.
 *
 * Run: node --env-file=.env.local --import tsx scripts/verify-airwallex.ts
 */

import {
  isAirwallexConfigured,
  airwallexBaseUrl,
  getAirwallexClient,
} from "../src/providers/airwallex";

const line = (s = "") => console.log(s);

async function main() {
  line("=== Space Zero — Airwallex sandbox auth verification ===");
  line(`base URL            : ${airwallexBaseUrl()}`);
  line(`credentials present : ${isAirwallexConfigured()}`);
  line(`endpoint            : POST /api/v1/authentication/login`);
  line();

  if (!isAirwallexConfigured()) {
    line("AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY are not set in the environment.");
    line("No API call was made. Set both (see .env.example), then re-run.");
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  try {
    const auth = await getAirwallexClient().authenticate();
    const ms = Date.now() - started;
    line("RESULT: SUCCESS");
    line("  A real POST /api/v1/authentication/login returned a token.");
    line(`  token       : received (${auth.token.length} chars; value NOT printed)`);
    line(`  expires_at  : ${auth.expiresAt || "(not provided)"}`);
    line(`  round-trip  : ${ms} ms`);
  } catch (err) {
    line("RESULT: FAILED");
    line(`  ${err instanceof Error ? err.message : String(err)}`);
    line("  No token obtained. Nothing was funded or charged.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("VERIFICATION ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
