/**
 * Space Zero — Duffel (TEST MODE) real flight-search verification.
 *
 * Exercises the REAL flow end to end and reports the actual outcome:
 *
 *   Trip Intent → Duffel → flight offers → ranked options → persisted selected
 *   option → estimated cost that Funding/Authorization read.
 *
 * It makes REAL calls to Duffel's offer-request API using the configured
 * DUFFEL_API_KEY (a test-mode key: duffel_test_...). It NEVER creates an order,
 * so no booking happens and no money moves — this is search only.
 *
 * Persistence is deliberately routed to the in-memory repositories (the Supabase
 * env is unset at the top of this script) so the search→rank→persist→select→cost
 * chain is verified in isolation with real provider data, without touching the
 * live Supabase project. No secret value is printed.
 *
 * Run: node --env-file=.env.local --import tsx scripts/verify-duffel.ts
 */

// Route persistence to the in-memory store for this verification only. This does
// not modify any file or the Supabase project; it only affects this process so
// the pipeline logic is exercised with real Duffel data, not the network DB.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import {
  isDuffelConfigured,
  HttpDuffelClient,
  type DuffelClient,
  type DuffelOffer,
} from "../src/providers/duffel";
import type { Trip } from "../src/domain/trip";
import { getTripRepository } from "../src/server/persistence/trip-repository";
import { getFlightOptionRepository } from "../src/server/persistence/flight-option-repository";
import { searchAndPersistFlights } from "../src/server/flights/search-service";
import { estimatedCostForTrip } from "../src/server/trips/funding-service";

const line = (s = "") => console.log(s);
const pass = (s: string) => line(`  ✓ ${s}`);
const fail = (s: string) => line(`  ✗ ${s}`);

let failures = 0;
function expect(cond: boolean, ok: string, bad: string) {
  if (cond) pass(ok);
  else {
    fail(bad);
    failures++;
  }
}

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/** A realistic near-future trip the deriveSearchParams step can resolve. */
function makeTrip(): Trip {
  const departYmd = ymd(21);
  return {
    id: `verify_${Date.now()}`,
    origin: "London",
    destination: "New York",
    segments: [],
    arrivalDeadline: `${ymd(22)}T23:59:00.000Z`,
    currency: "GBP",
    tripBudget: 3000,
    recoveryAllowance: 300,
    checkedBags: 1,
    autoRebook: true,
    status: "PLANNING",
    depart: departYmd,
    cabin: "Economy",
  };
}

async function main() {
  line("=== Space Zero — Duffel TEST MODE flight-search verification ===");
  const key = process.env.DUFFEL_API_KEY ?? "";
  const mode = key.startsWith("duffel_test") ? "TEST" : key.startsWith("duffel_live") ? "LIVE" : "unknown";
  line(`configured    : ${isDuffelConfigured()}`);
  line(`key mode      : ${mode}${mode === "unknown" ? " (unexpected prefix)" : ""}`);
  line(`api version   : ${process.env.DUFFEL_API_VERSION ?? "v2"}`);
  line();

  if (!isDuffelConfigured()) {
    fail("DUFFEL_API_KEY is not set; no API call was made.");
    process.exitCode = 1;
    return;
  }
  if (mode === "LIVE") {
    fail("Key is a LIVE key. Refusing to run to avoid real bookings/charges.");
    process.exitCode = 1;
    return;
  }

  const duffel: DuffelClient = new HttpDuffelClient();

  // --- 1. Direct real search: authenticate + real offers -------------------
  line("[1] Direct Duffel offer request (real network call)");
  let directOffers: DuffelOffer[] = [];
  const t0 = Date.now();
  try {
    directOffers = await duffel.searchOffers({
      origin: "LHR",
      destination: "JFK",
      departureDate: ymd(21),
      passengers: 1,
      cabinClass: "economy",
    });
    const ms = Date.now() - t0;
    expect(true, `Authenticated: Duffel accepted the key and responded (${ms} ms).`, "");
    expect(
      directOffers.length > 0,
      `Real offers returned: ${directOffers.length} offer(s) from Duffel.`,
      "Duffel responded but returned zero offers (unexpected in test mode).",
    );
    const sample = directOffers[0];
    if (sample) {
      const looksReal =
        typeof sample.id === "string" &&
        sample.id.startsWith("off_") &&
        typeof sample.total_amount === "string" &&
        Number(sample.total_amount) > 0;
      expect(
        looksReal,
        `Offers are provider data, not fixtures (id ${sample.id}, ${sample.total_amount} ${sample.total_currency}).`,
        "First offer did not look like a real Duffel offer (id/off_ prefix / amount).",
      );
    }
  } catch (err) {
    fail(`Direct search failed: ${err instanceof Error ? err.message : String(err)}`);
    failures++;
  }
  line();

  // --- 2. Full pipeline: intent → rank → persist → select → cost -----------
  line("[2] Full pipeline via searchAndPersistFlights (real Duffel + in-memory persistence)");
  const trip = makeTrip();
  await getTripRepository().create(trip);

  const outcome = await searchAndPersistFlights(trip.id, { duffel });
  expect(
    outcome.status === "ok",
    `Search status: ${outcome.status}.`,
    `Search status was "${outcome.status}", expected "ok".`,
  );
  expect(
    outcome.options.length > 0,
    `Ranked + persisted ${outcome.options.length} option(s).`,
    "No options were persisted.",
  );

  const optionRepo = getFlightOptionRepository();
  const persisted = await optionRepo.listForTrip(trip.id);
  expect(
    persisted.length === outcome.options.length && persisted.length > 0,
    `Persistence readback: ${persisted.length} option(s) stored and retrievable.`,
    "Persisted options could not be read back.",
  );

  const ranks = persisted.map((o) => o.rank);
  const sortedAsc = ranks.every((r, i) => i === 0 || ranks[i - 1] <= r);
  const recommended = persisted.filter((o) => o.recommended);
  expect(sortedAsc, "Options are deterministically ordered by rank (0 best).", "Options are not rank-ordered.");
  expect(
    recommended.length === 1 && recommended[0].rank === 0,
    "Exactly one recommended option (rank 0).",
    `Expected exactly one recommended option at rank 0, got ${recommended.length}.`,
  );

  const best = persisted[0];
  expect(
    best.providerOfferId.startsWith("off_") && best.totalAmount > 0,
    `Persisted option carries the real Duffel offer id + price (${best.providerOfferId}, ${best.totalAmount} ${best.currency}).`,
    "Persisted option is missing a real provider offer id or price.",
  );
  line();

  // --- 3. Select an option, confirm it persists ----------------------------
  line("[3] Select an option and persist the choice");
  const chosen = persisted.find((o) => !o.recommended) ?? persisted[0];
  const selected = await optionRepo.setSelected(trip.id, chosen.id);
  await getTripRepository().update(trip.id, { selectedOptionId: chosen.id });
  expect(
    selected?.id === chosen.id && selected?.selected === true,
    `Selected option persisted (${chosen.id}, ${chosen.totalAmount} ${chosen.currency}).`,
    "Selection did not persist.",
  );
  const afterSelect = await optionRepo.listForTrip(trip.id);
  const selectedCount = afterSelect.filter((o) => o.selected).length;
  expect(selectedCount === 1, "Exactly one option is marked selected.", `Expected 1 selected, got ${selectedCount}.`);
  line();

  // --- 4. Real price reaches Funding / Authorization -----------------------
  line("[4] Estimated cost that Funding & Authorization read");
  const tripAfter = await getTripRepository().getById(trip.id);
  const cost = tripAfter ? await estimatedCostForTrip(tripAfter) : -1;
  expect(
    cost === chosen.totalAmount && cost > 0,
    `estimatedCostForTrip returns the SELECTED option's real price: ${cost} ${chosen.currency}.`,
    `estimatedCostForTrip returned ${cost}, expected the selected option's ${chosen.totalAmount}.`,
  );
  line();

  // --- 5. Honest provider-error handling -----------------------------------
  line("[5] Honest provider-error handling (no fabricated flights)");
  const throwingClient: DuffelClient = {
    async searchOffers() {
      throw new Error("simulated network/provider failure");
    },
  };
  const errTrip = { ...makeTrip(), id: `verify_err_${Date.now()}` };
  await getTripRepository().create(errTrip);
  const errOutcome = await searchAndPersistFlights(errTrip.id, { duffel: throwingClient });
  expect(
    errOutcome.status === "provider_error" && errOutcome.options.length === 0,
    "Provider failure surfaces status=provider_error with zero options (no fabrication).",
    `Provider failure produced "${errOutcome.status}" with ${errOutcome.options.length} options.`,
  );

  const emptyClient: DuffelClient = { async searchOffers() { return []; } };
  const emptyTrip = { ...makeTrip(), id: `verify_empty_${Date.now()}` };
  await getTripRepository().create(emptyTrip);
  const emptyOutcome = await searchAndPersistFlights(emptyTrip.id, { duffel: emptyClient });
  expect(
    emptyOutcome.status === "no_results" && emptyOutcome.options.length === 0,
    "Empty provider result surfaces status=no_results (no fabrication).",
    `Empty result produced "${emptyOutcome.status}".`,
  );
  line();

  line("=== Summary ===");
  if (failures === 0) {
    line("RESULT: ALL CHECKS PASSED. Real Duffel search verified; no booking made.");
  } else {
    line(`RESULT: ${failures} CHECK(S) FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("VERIFICATION ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
