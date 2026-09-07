/**
 * Space Zero — flight search tests (deterministic; no Duffel key, no network).
 *
 * Covers airport resolution, offer normalization, deadline-enforcing ranking,
 * search-param derivation, the search service over a fake provider + in-memory
 * repos, the flight-option repo, mappers, and the Strands tool's honest states.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolvePlaceToIata } from "./airports";
import { normalizeOffer, normalizeOffers } from "./normalize";
import { rankOptions } from "./rank";
import { deriveSearchParams, deriveDepartureDate } from "./search-params";
import { searchAndPersistFlights } from "./search-service";
import { InMemoryTripRepository } from "../persistence/in-memory-trip-repository";
import { InMemoryFlightOptionRepository } from "../persistence/flight-option-repository";
import { rowToFlightOption, flightOptionToInsertRow, type FlightOptionRow } from "../persistence/flight-option-row";
import { searchFlightsTool } from "../tools/search-flights";
import { createTripFromBrief } from "../trips/service";
import type { DuffelClient, DuffelOffer, DuffelSearchParams } from "../../providers/duffel";
import type { Trip } from "../../domain/trip";
import type { FlightOption } from "../../domain/flight-option";

// --- helpers ----------------------------------------------------------------

let seq = 0;
const makeId = () => `opt_${++seq}`;

function offer(id: string, opts: { amount: string; segs: [string, string, string, string][]; expires?: string }): DuffelOffer {
  return {
    id,
    total_amount: opts.amount,
    total_currency: "GBP",
    expires_at: opts.expires,
    slices: [
      {
        segments: opts.segs.map(([from, to, dep, arr]) => ({
          origin: { iata_code: from },
          destination: { iata_code: to },
          departing_at: dep,
          arriving_at: arr,
          marketing_carrier: { iata_code: "SQ" },
          marketing_carrier_flight_number: "318",
        })),
      },
    ],
  };
}

function fakeDuffel(offers: DuffelOffer[]): DuffelClient {
  return { async searchOffers(_p: DuffelSearchParams) { return offers; } };
}

function tripFixture(over: Partial<Trip> = {}): Trip {
  return {
    id: "t1", userId: "u1", status: "DRAFT", brief: "b",
    origin: "London", destination: "Sydney", segments: [], arrivalDeadline: "",
    currency: "GBP", tripBudget: 2000, recoveryAllowance: 150, checkedBags: 0, autoRebook: true,
    ...over,
  };
}

// --- airports ---------------------------------------------------------------

test("airports: resolves cities, passes through codes, null for unknown", () => {
  assert.equal(resolvePlaceToIata("London"), "LHR");
  assert.equal(resolvePlaceToIata("Sydney, AU"), "SYD");
  assert.equal(resolvePlaceToIata("syd"), "SYD");
  assert.equal(resolvePlaceToIata("Nowhereville"), null);
  assert.equal(resolvePlaceToIata(""), null);
});

// --- normalize --------------------------------------------------------------

test("normalize: maps segments and computes duration/connections", () => {
  const o = normalizeOffer(
    offer("off_1", { amount: "1468.00", expires: "2026-09-01T10:00:00Z", segs: [
      ["LHR", "SIN", "2026-09-04T21:30:00Z", "2026-09-05T14:00:00Z"],
      ["SIN", "SYD", "2026-09-05T16:00:00Z", "2026-09-05T19:35:00Z"],
    ] }),
    "t1",
    makeId,
  );
  assert.ok(o);
  assert.equal(o!.providerOfferId, "off_1");
  assert.equal(o!.totalAmount, 1468);
  assert.equal(o!.connections, 1);
  assert.equal(o!.departAt, "2026-09-04T21:30:00Z");
  assert.equal(o!.arriveAt, "2026-09-05T19:35:00Z");
  assert.equal(o!.durationMinutes, 22 * 60 + 5);
  assert.equal(o!.expiresAt, "2026-09-01T10:00:00Z");
});

test("normalize: drops malformed offers (no valid segments)", () => {
  const bad: DuffelOffer = { id: "x", total_amount: "1", total_currency: "GBP", slices: [{ segments: [] }] };
  assert.equal(normalizeOffers([bad], "t1", makeId).length, 0);
});

// --- rank -------------------------------------------------------------------

function opt(over: Partial<FlightOption>): FlightOption {
  return {
    id: over.id ?? makeId(), tripId: "t1", providerOfferId: over.providerOfferId ?? "o",
    segments: [], totalAmount: 1000, currency: "GBP", durationMinutes: 600, connections: 1,
    departAt: "2026-09-04T20:00:00Z", arriveAt: over.arriveAt ?? "2026-09-05T06:00:00Z",
    rank: 0, recommended: false, selected: false, expiresAt: null, ...over,
  };
}

test("rank: enforces the hard arrival deadline (late options dropped)", () => {
  const deadline = "2026-09-05T09:00:00Z";
  const onTime = opt({ id: "a", arriveAt: "2026-09-05T08:00:00Z" });
  const late = opt({ id: "b", arriveAt: "2026-09-05T10:00:00Z" });
  const { ranked, dropped } = rankOptions([onTime, late], { deadline });
  assert.deepEqual(ranked.map((o) => o.id), ["a"]);
  assert.deepEqual(dropped.map((o) => o.id), ["b"]);
  assert.equal(ranked[0].recommended, true);
  assert.equal(ranked[0].rank, 0);
});

test("rank: cheaper + faster + fewer stops ranks higher; deterministic", () => {
  const cheapFast = opt({ id: "good", totalAmount: 800, durationMinutes: 500, connections: 0 });
  const dearSlow = opt({ id: "bad", totalAmount: 1600, durationMinutes: 900, connections: 2 });
  const r1 = rankOptions([dearSlow, cheapFast], {});
  assert.deepEqual(r1.ranked.map((o) => o.id), ["good", "bad"]);
  const r2 = rankOptions([cheapFast, dearSlow], {});
  assert.deepEqual(r2.ranked.map((o) => o.id), ["good", "bad"]); // order-independent
});

test("rank: no valid options → empty ranked set", () => {
  const late = opt({ id: "b", arriveAt: "2026-09-05T10:00:00Z" });
  const { ranked } = rankOptions([late], { deadline: "2026-09-05T09:00:00Z" });
  assert.equal(ranked.length, 0);
});

// --- search-params ----------------------------------------------------------

test("search-params: derives IATA + cabin, or reports unknown place", () => {
  const ok = deriveSearchParams(tripFixture({ cabin: "Business class" }));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.params.origin, "LHR");
    assert.equal(ok.params.destination, "SYD");
    assert.equal(ok.params.cabinClass, "business");
  }
  assert.deepEqual(deriveSearchParams(tripFixture({ origin: "" })), { ok: false, reason: "origin_unknown" });
  assert.deepEqual(deriveSearchParams(tripFixture({ destination: "Nowhereville" })), { ok: false, reason: "destination_unknown" });
});

test("search-params: departure date falls back to a near-future date", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  assert.equal(deriveDepartureDate(undefined, now), "2026-09-22");
  assert.equal(deriveDepartureDate("2026-10-05", now), "2026-10-05");
});

// --- search service (fake provider + in-memory repos) -----------------------

async function serviceWith(offers: DuffelOffer[] | "throw", trip: Trip) {
  const tripRepo = new InMemoryTripRepository();
  await tripRepo.create(trip);
  const optionRepo = new InMemoryFlightOptionRepository();
  const duffel: DuffelClient = offers === "throw"
    ? { async searchOffers() { throw new Error("boom"); } }
    : fakeDuffel(offers);
  const outcome = await searchAndPersistFlights(trip.id, { duffel, tripRepo, optionRepo, makeId });
  return { outcome, optionRepo };
}

test("service: ok — normalizes, ranks, and persists options", async () => {
  const offers = [
    offer("cheap", { amount: "1190.00", segs: [["LHR", "SYD", "2026-09-04T20:00:00Z", "2026-09-05T08:00:00Z"]] }),
    offer("dear", { amount: "1600.00", segs: [["LHR", "DXB", "2026-09-04T20:00:00Z", "2026-09-05T02:00:00Z"], ["DXB", "SYD", "2026-09-05T04:00:00Z", "2026-09-05T08:30:00Z"]] }),
  ];
  const { outcome, optionRepo } = await serviceWith(offers, tripFixture());
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.options.length, 2);
  assert.equal(outcome.options[0].recommended, true);
  const persisted = await optionRepo.listForTrip("t1");
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].rank, 0);
});

test("service: deadline enforced — options past the deadline are excluded", async () => {
  const trip = tripFixture({ arrivalDeadline: "2026-09-05T09:00:00Z" });
  const offers = [
    offer("ontime", { amount: "1200.00", segs: [["LHR", "SYD", "2026-09-04T20:00:00Z", "2026-09-05T08:00:00Z"]] }),
    offer("late", { amount: "900.00", segs: [["LHR", "SYD", "2026-09-04T20:00:00Z", "2026-09-05T12:00:00Z"]] }),
  ];
  const { outcome } = await serviceWith(offers, trip);
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.options.length, 1);
  assert.equal(outcome.options[0].providerOfferId, "ontime");
});

test("service: no_results when nothing meets the deadline", async () => {
  const trip = tripFixture({ arrivalDeadline: "2026-09-05T09:00:00Z" });
  const offers = [offer("late", { amount: "900.00", segs: [["LHR", "SYD", "2026-09-04T20:00:00Z", "2026-09-05T12:00:00Z"]] })];
  const { outcome } = await serviceWith(offers, trip);
  assert.equal(outcome.status, "no_results");
});

test("service: provider_error when the provider throws (no fabrication)", async () => {
  const { outcome, optionRepo } = await serviceWith("throw", tripFixture());
  assert.equal(outcome.status, "provider_error");
  assert.equal(outcome.options.length, 0);
  assert.equal((await optionRepo.listForTrip("t1")).length, 0);
});

test("service: trip_not_found for an unknown trip", async () => {
  const outcome = await searchAndPersistFlights("missing", {
    duffel: fakeDuffel([]), tripRepo: new InMemoryTripRepository(), optionRepo: new InMemoryFlightOptionRepository(), makeId,
  });
  assert.equal(outcome.status, "trip_not_found");
});

test("service: origin_unknown surfaces (no guessing) with a fake provider present", async () => {
  const { outcome } = await serviceWith([], tripFixture({ origin: "" }));
  assert.equal(outcome.status, "origin_unknown");
});

// --- flight-option repository ------------------------------------------------

test("repo: replace, list (rank order), and setSelected", async () => {
  const repo = new InMemoryFlightOptionRepository();
  const a = opt({ id: "a", rank: 1, recommended: false });
  const b = opt({ id: "b", rank: 0, recommended: true });
  await repo.replaceForTrip("t1", [a, b]);
  const list = await repo.listForTrip("t1");
  assert.deepEqual(list.map((o) => o.id), ["b", "a"]); // rank asc
  const sel = await repo.setSelected("t1", "a");
  assert.equal(sel?.id, "a");
  const after = await repo.listForTrip("t1");
  assert.equal(after.find((o) => o.id === "a")!.selected, true);
  assert.equal(after.find((o) => o.id === "b")!.selected, false);
  assert.equal(await repo.setSelected("t1", "missing"), null);
});

// --- mappers ----------------------------------------------------------------

test("mapper: numeric money (string) → number without float error", () => {
  const row: FlightOptionRow = {
    id: "o1", trip_id: "t1", provider_offer_id: "off", segments: [{ from: "LHR", to: "SYD", departAt: "x", arriveAt: "y" }],
    total_amount: "1468.00", currency: "GBP", duration_minutes: 1325, connections: 0,
    depart_at: "x", arrive_at: "y", rank: 0, recommended: true, selected: false, expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };
  const o = rowToFlightOption(row);
  assert.equal(o.totalAmount, 1468);
  assert.equal(o.recommended, true);
  const back = flightOptionToInsertRow(o);
  assert.equal(back.total_amount, 1468);
  assert.equal(back.provider_offer_id, "off");
});

// --- Strands tool -----------------------------------------------------------

test("tool: search_flights returns an honest status (provider unconfigured in tests)", async () => {
  const trip = await createTripFromBrief("Fly from London to Sydney under £2,000.");
  const r = (await searchFlightsTool.invoke({ tripId: trip.id })) as { status: string; count: number };
  // No DUFFEL_API_KEY in tests → honest unconfigured state, nothing invented.
  assert.equal(r.status, "provider_unconfigured");
  assert.equal(r.count, 0);
});

test("tool: search_flights reports trip_not_found for an unknown id", async () => {
  const r = (await searchFlightsTool.invoke({ tripId: "nope-" + Date.now() })) as { status: string };
  assert.equal(r.status, "trip_not_found"); // trip lookup happens before the provider check
});
