/**
 * Space Zero — DETERMINISTIC disruption demo (offline; no network, no key).
 *
 * Feeds a realistic FlightAware-style RAW AeroAPI response (a fixture) into the
 * EXISTING pipeline and prints each stage:
 *
 *   fixture raw response
 *     → real normalization (normalizeAeroApiResponse, the same code the live
 *       HttpFlightAwareClient uses)
 *     → deterministic disruption detection (assessDisruption)
 *     → persist the disruption
 *     → advance the trip to AT_RISK via the validated state machine
 *     → hand off to the EXISTING recovery workflow (triggerRecoveryWorkflow —
 *       the same entry the /monitor route uses), run deterministically.
 *
 * It never pretends the live API returned the data (the provider is a clearly
 * named fixture), never makes a live booking, and never fakes a RESOLVED state:
 * recovery is run with no eligible candidates so it honestly ESCALATES for the
 * traveler. Everything after the fixture is the real, unchanged code path.
 *
 * Run:  node --import tsx scripts/demo-disruption.ts [scenario]
 *   scenario ∈ on_time | cancelled | diverted | missed_connection |
 *              arrival_breach | delayed_minor | departed | arrived
 *   (default: cancelled)
 */

import { monitorTrip, getMonitoringView } from "../src/server/monitoring/monitoring-service";
import { triggerRecoveryWorkflow } from "../src/server/recovery/recovery-agent";
import { fixtureFlightAwareProvider, DEMO_ITINERARY, type DemoScenario } from "../src/server/monitoring/flightaware-fixtures";
import { InMemoryTripRepository } from "../src/server/persistence/in-memory-trip-repository";
import { InMemoryFlightOptionRepository } from "../src/server/persistence/flight-option-repository";
import { InMemoryDisruptionRepository } from "../src/server/persistence/disruption-repository";
import { InMemoryRecoveryRepository } from "../src/server/persistence/recovery-repository";
import type { Trip } from "../src/domain/trip";
import type { FlightOption, FlightSegment } from "../src/domain/flight-option";

const line = (s = "") => console.log(s);
const SCENARIOS: DemoScenario[] = ["on_time", "cancelled", "diverted", "missed_connection", "arrival_breach", "delayed_minor", "departed", "arrived"];

function bookedTrip(): Trip {
  return {
    id: "demo-trip", userId: "dev", status: "CONFIRMED", brief: "demo",
    origin: "London", destination: "Sydney", segments: [],
    arrivalDeadline: DEMO_ITINERARY.deadline, currency: "GBP",
    tripBudget: 2000, recoveryAllowance: 150, checkedBags: 1, autoRebook: true,
    bookingStatus: "CONFIRMED", bookingReference: "SZ-DEMO", selectedOptionId: "demo-opt",
  };
}

interface Leg { from: string; to: string; carrier: string; flightNumber: string; departAt: string; arriveAt: string }

function bookedOption(): FlightOption {
  const s1: Leg = DEMO_ITINERARY.seg1, s2: Leg = DEMO_ITINERARY.seg2;
  const seg = (s: Leg): FlightSegment => ({ from: s.from, to: s.to, departAt: s.departAt, arriveAt: s.arriveAt, carrier: s.carrier, flightNumber: s.flightNumber });
  return {
    id: "demo-opt", tripId: "demo-trip", providerOfferId: "off-demo",
    segments: [seg(s1), seg(s2)], totalAmount: 1468, currency: "GBP",
    durationMinutes: 1355, connections: 1, departAt: s1.departAt, arriveAt: s2.arriveAt,
    rank: 0, recommended: true, selected: true, expiresAt: null,
  };
}

async function main() {
  const scenario = (process.argv[2] as DemoScenario) || "cancelled";
  if (!SCENARIOS.includes(scenario)) {
    line(`Unknown scenario "${scenario}". Choose one of: ${SCENARIOS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  line("=== Space Zero — deterministic FlightAware disruption demo ===");
  line(`scenario : ${scenario}  (fixture raw AeroAPI response, NOT a live call)`);
  line(`itinerary: ${DEMO_ITINERARY.seg1.from} →(${DEMO_ITINERARY.seg1.flightNumber})→ ${DEMO_ITINERARY.seg1.to} →(${DEMO_ITINERARY.seg2.flightNumber})→ ${DEMO_ITINERARY.seg2.to}`);
  line(`deadline : ${DEMO_ITINERARY.deadline}`);
  line();

  // Shared in-memory stores so monitoring + recovery see the same state.
  const tripRepo = new InMemoryTripRepository();
  await tripRepo.create(bookedTrip());
  const optionRepo = new InMemoryFlightOptionRepository();
  await optionRepo.replaceForTrip("demo-trip", [bookedOption()]);
  const disruptionRepo = new InMemoryDisruptionRepository();
  const recoveryRepo = new InMemoryRecoveryRepository();

  let handedOff = false;
  const outcome = await monitorTrip("demo-trip", {
    provider: fixtureFlightAwareProvider(scenario), // real normalization, canned raw input
    tripRepo, optionRepo, disruptionRepo,
    now: new Date("2026-09-04T12:00:00Z"),
    onDisruption: async () => {
      handedOff = true;
      // Hand off to the EXISTING recovery workflow (same entry the /monitor route
      // uses). Deterministic, in-memory, and with no candidates so it cannot make
      // a live booking and cannot fake a RESOLVED — it honestly escalates.
      await triggerRecoveryWorkflow("demo-trip", {
        deterministicOnly: true,
        tripRepo, optionRepo, disruptionRepo, recoveryRepo,
        candidates: [],
      });
    },
  });

  line(`[1] normalize + detect : monitor status = ${outcome.status}`);
  for (const s of outcome.segments) {
    line(`    ${s.from}→${s.to} ${s.flightNumber ?? ""}: ${s.status}${s.delayMinutes ? ` (+${s.delayMinutes}m)` : ""}`);
  }
  if (outcome.disruptions.length > 0) {
    const d = outcome.disruptions[0];
    line(`[2] disruption         : ${d.type} (${d.severity}) — ${d.summary}`);
  } else {
    line(`[2] disruption         : none (trip holds)`);
  }
  line(`[3] trip state         : ${outcome.tripStatus}`);
  line(`[4] recovery hand-off  : ${handedOff ? "triggered (existing Strands recovery workflow)" : "not triggered (no threat)"}`);

  const view = await getMonitoringView("demo-trip", { tripRepo, optionRepo, disruptionRepo, recoveryRepo, providerConfigured: false });
  const rec = view?.recovery ?? null;
  line(`[5] recovery outcome   : ${rec ? `${rec.status}${rec.escalationReason ? ` (${rec.escalationReason})` : ""}` : "n/a"}`);
  if (rec) line(`    reason: ${rec.reason}`);
  line();

  // Honesty assertions the demo enforces on itself.
  const finalTrip = await tripRepo.getById("demo-trip");
  const fakedResolved = finalTrip?.status === "RESOLVED" || rec?.status === "RECOVERED";
  if (fakedResolved) {
    line("ERROR: a fixture must never produce RESOLVED/RECOVERED. Aborting as unsafe.");
    process.exitCode = 1;
    return;
  }
  line("RESULT: pipeline ran on fixture input; no live call, no booking, no fake RESOLVED.");
}

main().catch((err) => {
  console.error("DEMO ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
