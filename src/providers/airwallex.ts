/**
 * Space Zero — Airwallex provider (server-side only).
 *
 * A minimal typed client over Airwallex's authentication API, behind the same
 * provider seam as Duffel and FlightAware so the funding/payment layer can be
 * tested with a fake (no network, no key). `isAirwallexConfigured()` gates real
 * calls — when credentials are absent the funding/payment layer stays honest (no
 * fabricated charge or transfer) rather than pretending a provider is available.
 *
 * This layer authenticates AND creates a sandbox PAYMENT INTENT (the real money
 * primitive) behind the same seam. It never fabricates a settled charge: a fresh
 * payment intent is reported as PENDING (settlement/capture needs a confirmed
 * payment method, which is deliberately out of scope), and only a provider that
 * actually reports SUCCEEDED yields a confirmed payment. The orchestration —
 * authority/funding gate, idempotency, persistence, and the honest reconciliation
 * with funding/recovery — lives in src/server/payments/payment-service.ts.
 *
 * Never import this from a client component; it reads AIRWALLEX_CLIENT_ID and
 * AIRWALLEX_API_KEY (secrets) and, optionally, AIRWALLEX_BASE_URL. The provider's
 * raw responses are NEVER returned to a client — only a typed, sanitized result.
 */

import type { PaymentStatus } from "../domain/payment";

/** Airwallex sandbox (demo/test) base URL — the default when none is configured. */
export const AIRWALLEX_SANDBOX_BASE = "https://api.sandbox.airwallex.com";

/** The configured base URL, defaulting to the sandbox environment. */
export function airwallexBaseUrl(): string {
  return process.env.AIRWALLEX_BASE_URL || AIRWALLEX_SANDBOX_BASE;
}

/** True when both Airwallex credentials are present (server-side). */
export function isAirwallexConfigured(): boolean {
  return Boolean(process.env.AIRWALLEX_CLIENT_ID && process.env.AIRWALLEX_API_KEY);
}

/**
 * A successful authentication result. `token` is a short-lived bearer JWT
 * (reusable until `expiresAt`, ~30 minutes) used as `Authorization: Bearer`.
 */
export interface AirwallexAuth {
  token: string;
  /** ISO8601 expiry returned by Airwallex. */
  expiresAt: string;
}

/** A single sandbox payment request. Amounts are in whole/decimal `currency`. */
export interface AirwallexPaymentRequest {
  /** Provider-side idempotency key — a repeat with the same id never re-charges. */
  requestId: string;
  /** Our own reference for the payment (e.g. a trip-scoped id). */
  merchantOrderId: string;
  amount: number;
  currency: string;
  description?: string;
}

/**
 * The typed, sanitized outcome of a payment attempt. Deliberately small: it
 * carries the provider's id and a mapped status, never the raw response body,
 * so nothing sensitive can leak past this seam.
 */
export interface AirwallexPaymentResult {
  /** The provider's payment-intent id, or null if none was created. */
  providerPaymentId: string | null;
  /** The provider status mapped to our honest lifecycle. */
  status: PaymentStatus;
  /** The provider's own status string (sanitized), for the audit record. */
  providerStatus: string | null;
}

/** The provider capability the payment service depends on (createPayment only). */
export interface PaymentProvider {
  /**
   * Create a sandbox payment intent. Throws on any non-2xx / transport failure
   * so the caller records an honest FAILED payment — never a fabricated success.
   * A freshly created intent that still needs a payment method is reported
   * PENDING; only a provider-reported settled status yields SUCCEEDED.
   */
  createPayment(req: AirwallexPaymentRequest): Promise<AirwallexPaymentResult>;
}

export interface AirwallexClient extends PaymentProvider {
  /**
   * Obtain an API access token via `POST /api/v1/authentication/login`, sending
   * the `x-client-id` and `x-api-key` headers. Throws on any non-2xx so the
   * caller can surface an honest provider-failure state (never a fabricated
   * success). Returns the bearer token and its expiry on success.
   */
  authenticate(): Promise<AirwallexAuth>;
}

/**
 * Map an Airwallex payment-intent status to our honest lifecycle. A settled
 * status is the ONLY thing that becomes SUCCEEDED; an explicit refusal becomes
 * DECLINED; a cancellable/awaiting state is PENDING; anything else fails closed
 * to FAILED (never a fabricated success).
 */
export function mapAirwallexStatus(providerStatus: string | null | undefined): PaymentStatus {
  switch ((providerStatus ?? "").toUpperCase()) {
    case "SUCCEEDED":
    case "CAPTURED":
      return "SUCCEEDED";
    case "DECLINED":
    case "PAYMENT_FAILED":
      return "DECLINED";
    case "REQUIRES_PAYMENT_METHOD":
    case "REQUIRES_CUSTOMER_ACTION":
    case "REQUIRES_CONFIRMATION":
    case "REQUIRES_CAPTURE":
    case "PENDING":
      return "PENDING";
    default:
      return "FAILED";
  }
}

/**
 * The real Airwallex client. Throws on non-2xx (including the provider's own
 * error code/message when present) so callers surface a provider-failure state;
 * it never returns partial or fabricated data.
 */
export class HttpAirwallexClient implements AirwallexClient {
  private requireCreds(): { clientId: string; apiKey: string } {
    const clientId = process.env.AIRWALLEX_CLIENT_ID;
    const apiKey = process.env.AIRWALLEX_API_KEY;
    if (!clientId || !apiKey) {
      throw new Error("AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY must be set.");
    }
    return { clientId, apiKey };
  }

  async authenticate(): Promise<AirwallexAuth> {
    const { clientId, apiKey } = this.requireCreds();

    const res = await fetch(`${airwallexBaseUrl()}/api/v1/authentication/login`, {
      method: "POST",
      headers: {
        "x-client-id": clientId,
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      // Surface the provider's error code/message (not secrets) to aid honest
      // diagnosis, e.g. 401 invalid credentials vs 404 wrong base URL.
      let detail = "";
      try {
        const body = (await res.json()) as { code?: string; message?: string };
        detail = [body.code, body.message].filter(Boolean).join(": ");
      } catch {
        /* non-JSON error body — the status code alone is the signal */
      }
      throw new Error(`Airwallex authentication failed (${res.status})${detail ? ` — ${detail}` : ""}.`);
    }

    const json = (await res.json()) as { token?: string; expires_at?: string };
    if (!json.token) {
      throw new Error("Airwallex authentication response did not include a token.");
    }
    return { token: json.token, expiresAt: json.expires_at ?? "" };
  }

  /**
   * Create a sandbox payment intent via `POST /api/v1/pa/payment_intents/create`.
   * Sends `request_id` for provider-side idempotency. Throws on any non-2xx so
   * the caller records an honest FAILED payment; on success it returns only the
   * intent id + a mapped/sanitized status (never the raw response body). A fresh
   * intent that still needs a payment method maps to PENDING — sandbox capture
   * with a real card is out of scope.
   */
  async createPayment(req: AirwallexPaymentRequest): Promise<AirwallexPaymentResult> {
    const { token } = await this.authenticate();

    const res = await fetch(`${airwallexBaseUrl()}/api/v1/pa/payment_intents/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        request_id: req.requestId,
        merchant_order_id: req.merchantOrderId,
        amount: req.amount,
        currency: req.currency,
        ...(req.description ? { descriptor: req.description.slice(0, 32) } : {}),
      }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { code?: string; message?: string };
        detail = [body.code, body.message].filter(Boolean).join(": ");
      } catch {
        /* non-JSON error body — the status code alone is the signal */
      }
      throw new Error(`Airwallex payment intent failed (${res.status})${detail ? ` — ${detail}` : ""}.`);
    }

    const json = (await res.json()) as { id?: string; status?: string };
    return {
      providerPaymentId: json.id ?? null,
      status: mapAirwallexStatus(json.status),
      providerStatus: json.status ?? null,
    };
  }
}

/** Default client accessor (real HTTP client). Tests inject their own fake. */
export function getAirwallexClient(): AirwallexClient {
  return new HttpAirwallexClient();
}
