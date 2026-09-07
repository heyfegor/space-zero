/**
 * Space Zero — Duffel provider (server-side only).
 *
 * A minimal typed client over Duffel's offer-request API plus a `DuffelClient`
 * interface so the search service can be tested with a fake (no network, no
 * key). `isDuffelConfigured()` gates real calls — when the key is absent the
 * search returns an honest "unavailable" state rather than fabricating flights.
 *
 * Never import this from a client component; it reads DUFFEL_API_KEY.
 */

export type CabinClass = "economy" | "premium_economy" | "business" | "first";

export interface DuffelSearchParams {
  origin: string; // IATA
  destination: string; // IATA
  departureDate: string; // YYYY-MM-DD
  passengers: number;
  cabinClass: CabinClass;
}

// --- Minimal shapes of the Duffel response we consume -----------------------

export interface DuffelPlaceRef {
  iata_code?: string;
}
export interface DuffelSegment {
  origin: DuffelPlaceRef;
  destination: DuffelPlaceRef;
  departing_at: string;
  arriving_at: string;
  marketing_carrier?: { iata_code?: string };
  marketing_carrier_flight_number?: string;
}
export interface DuffelSlice {
  duration?: string;
  segments: DuffelSegment[];
}
/** A passenger id the offer expects an order to fill (id must be echoed back). */
export interface DuffelOfferPassenger {
  id: string;
  type?: string;
}
export interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  expires_at?: string;
  slices: DuffelSlice[];
  /** Passenger placeholders the order must supply details for. */
  passengers?: DuffelOfferPassenger[];
}

export interface DuffelClient {
  searchOffers(params: DuffelSearchParams): Promise<DuffelOffer[]>;
}

// --- Booking (order creation) ----------------------------------------------

/** Passenger details required to create an order. `id` echoes the offer's. */
export interface DuffelOrderPassenger {
  id: string;
  title?: string;
  given_name: string;
  family_name: string;
  born_on?: string; // YYYY-MM-DD
  gender?: string;
  email?: string;
  phone_number?: string;
}

export interface DuffelCreateOrderParams {
  offerId: string;
  /** The authoritative amount to pay, taken from the LIVE offer (never the LLM). */
  amount: string;
  currency: string;
  passengers: DuffelOrderPassenger[];
}

/** A confirmed Duffel order — the only proof a real booking succeeded. */
export interface DuffelOrder {
  id: string; // "ord_..."
  booking_reference: string; // airline PNR
  total_amount: string;
  total_currency: string;
}

/**
 * The subset of Duffel used to BOOK. Segregated from DuffelClient so the many
 * search-only test fakes stay valid. `getOffer` re-confirms an offer is live and
 * returns its authoritative price; `createOrder` throws on any non-2xx so the
 * caller surfaces an honest provider-failure state (never a fabricated success).
 */
export interface DuffelBookingClient {
  /** Fetch a single offer, or null if it no longer exists. */
  getOffer(offerId: string): Promise<DuffelOffer | null>;
  /** Create an instant order for an offer. Throws on failure. */
  createOrder(params: DuffelCreateOrderParams): Promise<DuffelOrder>;
}

export function isDuffelConfigured(): boolean {
  return Boolean(process.env.DUFFEL_API_KEY);
}

const DUFFEL_API_BASE = "https://api.duffel.com";

/** The real Duffel client. Throws on non-2xx so the caller can surface a
 *  provider-failure state (it never returns partial/fabricated data). */
export class HttpDuffelClient implements DuffelClient, DuffelBookingClient {
  private headers(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Duffel-Version": process.env.DUFFEL_API_VERSION ?? "v2",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private requireKey(): string {
    const apiKey = process.env.DUFFEL_API_KEY;
    if (!apiKey) throw new Error("DUFFEL_API_KEY is not set.");
    return apiKey;
  }

  async searchOffers(params: DuffelSearchParams): Promise<DuffelOffer[]> {
    const apiKey = this.requireKey();

    const body = {
      data: {
        slices: [
          { origin: params.origin, destination: params.destination, departure_date: params.departureDate },
        ],
        passengers: Array.from({ length: Math.max(1, params.passengers) }, () => ({ type: "adult" })),
        cabin_class: params.cabinClass,
      },
    };

    const res = await fetch(`${DUFFEL_API_BASE}/air/offer_requests?return_offers=true`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Duffel request failed (${res.status}).`);
    }
    const json = (await res.json()) as { data?: { offers?: DuffelOffer[] } };
    return json.data?.offers ?? [];
  }

  async getOffer(offerId: string): Promise<DuffelOffer | null> {
    const apiKey = this.requireKey();
    const res = await fetch(`${DUFFEL_API_BASE}/air/offers/${encodeURIComponent(offerId)}`, {
      method: "GET",
      headers: this.headers(apiKey),
    });
    // A gone/expired offer reads as not-found, not a hard failure.
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Duffel offer lookup failed (${res.status}).`);
    }
    const json = (await res.json()) as { data?: DuffelOffer };
    return json.data ?? null;
  }

  async createOrder(params: DuffelCreateOrderParams): Promise<DuffelOrder> {
    const apiKey = this.requireKey();
    const body = {
      data: {
        type: "instant",
        selected_offers: [params.offerId],
        // Test-mode Duffel settles from the account balance. No third-party
        // payment provider is involved (Airwallex is not integrated).
        payments: [{ type: "balance", amount: params.amount, currency: params.currency }],
        passengers: params.passengers,
      },
    };

    const res = await fetch(`${DUFFEL_API_BASE}/air/orders`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Duffel order creation failed (${res.status}).`);
    }
    const json = (await res.json()) as { data?: DuffelOrder };
    if (!json.data?.id) {
      throw new Error("Duffel order response did not include an order id.");
    }
    return json.data;
  }
}

/** Default client accessor (real HTTP client). Tests inject their own. */
export function getDuffelClient(): DuffelClient {
  return new HttpDuffelClient();
}

/** Default booking client accessor (real HTTP client). Tests inject their own. */
export function getDuffelBookingClient(): DuffelBookingClient {
  return new HttpDuffelClient();
}
