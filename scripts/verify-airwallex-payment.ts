/**
 * Space Zero — Airwallex sandbox PAYMENT-ACCEPTANCE readiness check (NOT prod).
 *
 * Extends verify-airwallex.ts (which checks auth only). This one diagnoses why a
 * PaymentIntent create may fail: it authenticates, reports the account's ACTIVE
 * payment methods for a currency, then attempts a real (unsettled) PaymentIntent
 * create through the SAME request shape the app uses, and reports the honest
 * outcome. It NEVER confirms/captures, so no money moves and no charge settles.
 *
 * A 400 `configuration_error` with an empty active-payment-method list means the
 * sandbox merchant account is not provisioned to accept online payments — an
 * account-side (dashboard/account-manager) action, not a code fix. No secret
 * value is printed.
 *
 * Run: node --env-file=.env.local --import tsx scripts/verify-airwallex-payment.ts
 */

import { airwallexBaseUrl, isAirwallexConfigured, getAirwallexClient } from "../src/providers/airwallex";

const line = (s = "") => console.log(s);
const BASE = airwallexBaseUrl();

async function main() {
  line("=== Space Zero — Airwallex sandbox PaymentIntent readiness ===");
  line(`base URL            : ${BASE}`);
  line(`credentials present : ${isAirwallexConfigured()}`);
  line();

  if (!isAirwallexConfigured()) {
    line("AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY are not set. No API call was made.");
    process.exitCode = 1;
    return;
  }

  // 1. Authenticate (reuses the app's client so we test the real seam).
  let token: string;
  try {
    token = (await getAirwallexClient().authenticate()).token;
    line("[1] Authentication : SUCCESS (token received; value not printed).");
  } catch (err) {
    line(`[1] Authentication : FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const authGet = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    return { status: res.status, body: await res.text() };
  };

  // 2. Active payment methods for a representative currency/country.
  const pm = await authGet(
    "/api/v1/pa/config/payment_method_types?__resources=true&transaction_currency=USD&country_code=US",
  );
  let methodCount = -1;
  try {
    methodCount = (JSON.parse(pm.body) as { items?: unknown[] }).items?.length ?? 0;
  } catch { /* leave -1 */ }
  line(`[2] Active payment methods (USD/US): ${methodCount < 0 ? `unparseable (${pm.status})` : methodCount}`);

  // 3. Real PaymentIntent create (same shape the app uses). Unsettled — no capture.
  const body = {
    request_id: `verify_${Date.now()}`,
    merchant_order_id: "verify:readiness",
    amount: 100,
    currency: "USD",
  };
  const res = await fetch(`${BASE}/api/v1/pa/payment_intents/create`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let code = "", message = "";
  try {
    const j = JSON.parse(text) as { code?: string; message?: string; id?: string; status?: string };
    code = j.code ?? "";
    message = j.message ?? "";
    if (res.ok) {
      line(`[3] PaymentIntent create : SUCCESS — id ${j.id}, status ${j.status}.`);
      line();
      line("RESULT: Sandbox CAN create a PaymentIntent. The confirm → simulate → SUCCEEDED flow can be implemented.");
      return;
    }
  } catch { /* non-JSON */ }

  line(`[3] PaymentIntent create : FAILED (${res.status})${code ? ` — ${code}: ${message}` : ` — ${text.slice(0, 200)}`}`);
  line();
  line("RESULT: Sandbox CANNOT create a PaymentIntent.");
  if (methodCount === 0 && code === "configuration_error") {
    line("EXTERNAL BLOCKER: the merchant account has NO active payment methods and is not");
    line("provisioned for Online Payments (Payment Acceptance). Enable payment methods in the");
    line("Airwallex sandbox dashboard (or ask the account manager to enable the Payments product),");
    line("then re-run. This is an account-configuration step, not a code change. Success was NOT faked.");
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("VERIFICATION ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
