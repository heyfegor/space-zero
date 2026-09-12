/**
 * Space Zero — payment integration tests (deterministic; no Airwallex key, no
 * network). A fake PaymentProvider stands in for the Airwallex sandbox seam.
 *
 * Covers the six required scenarios at the payment-service (money-movement)
 * boundary — successful payment, duplicate-payment prevention, declined payment,
 * provider failure, insufficient funding, and authority denial — plus the honest
 * "no provider configured" fallback, and the funding + recovery wiring that keeps
 * execute_booking the choke point and never marks a trip funded/resolved without
 * a CONFIRMED charge.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  capturePayment,
  type CapturePaymentInput,
} from "./payment-service";
import { InMemoryPaymentRepository } from "../persistence/payment-repository";
import { updateFunding, estimatedCostForTrip } from "../trips/funding-service";
import { runRecovery, type RecoveryDeps } from "../recovery/recovery-service";
import { createTripFromBrief } from "../trips/service";
import { getFlightOptionRepository } from "../persistence/flight-option-repository";
import { InMemoryTripRepository } from "../persistence/in-memory-trip-repository";
import { InMemoryFlightOptionRepository } from "../persistence/flight-option-repository";
import { InMemoryDisruptionRepository } from "../persistence/disruption-repository";
import { InMemoryRecoveryRepository } from "../persistence/recovery-repository";
import type {
  AirwallexPaymentRequest,
  AirwallexPaymentResult,
  PaymentProvider,
} from "../../providers/airwallex";
import type { PaymentStatus } from "../../domain/payment";
import type { Trip } from "../../domain/trip";
import type { FlightOption, FlightSegment } from "../../domain/flight-option";
import type { Disruption } from "../../domain/disruption";
import type {
  DuffelBookingClient,
  DuffelCreateOrderParams,
  DuffelOffer,
  DuffelOrder,
} from "../../providers/duffel";

// --- fakes ------------------------------------------------------------------

function fakeProvider(
  opts: { status?: PaymentStatus; throws?: boolean; providerId?: string } = {},
): PaymentProvider & { calls: AirwallexPaymentRequest[] } {
  const calls: AirwallexPaymentRequest[] = [];
  return {
    calls,
    async createPayment(req: AirwallexPaymentRequest): Promise<AirwallexPaymentResult> {
      calls.push(req);
      if (opts.throws) throw new Error("provider boom");
      const status = opts.status ?? "SUCCEEDED";
      return { providerPaymentId: opts.providerId ?? "int_123", status, providerStatus: status };
    },
  };
}

let seq = 0;
const makeId = () => `pay_${++seq}`;

function recoveryInput(over: Partial<CapturePaymentInput> = {}): CapturePaymentInput {
  return {
    tripId: "trip-1",
    kind: "RECOVERY",
    amount: 82,
    currency: "GBP",
    idempotencyKey: "recovery:trip-1:dis-1:82",
    fundedAmount: 1600,
    additionalCost: 82,
    recoveryAllowance: 150,
    ...over,
  };
}

// --- 1. successful payment --------------------------------------------------

test("successful payment: gate passes + provider confirms → SUCCEEDED, provider id persisted", async () => {
  const paymentRepo = new InMemoryPaymentRepository();
  const provider = fakeProvider({ status: "SUCCEEDED", providerId: "int_ok" });

  const r = await capturePayment(recoveryInput(), { provider, paymentRepo, makeId });

  assert.equal(r.ok, true);
  assert.equal(r.status, "SUCCEEDED");
  assert.equal(r.payment?.providerPaymentId, "int_ok");
  assert.equal(provider.calls.length, 1);
  // The idempotency key is passed to the provider as request_id (provider-side dedupe).
  assert.equal(provider.calls[0].requestId, "recovery:trip-1:dis-1:82");

  const persisted = await paymentRepo.findByIdempotencyKey("recovery:trip-1:dis-1:82");
  assert.equal(persisted?.status, "SUCCEEDED");
  assert.equal(persisted?.provider, "airwallex");
});

// --- 2. duplicate payment prevention ----------------------------------------

test("duplicate payment prevention: same idempotency key charges once, replays the record", async () => {
  const paymentRepo = new InMemoryPaymentRepository();
  const provider = fakeProvider({ status: "SUCCEEDED", providerId: "int_dup" });

  const first = await capturePayment(recoveryInput(), { provider, paymentRepo, makeId });
  const second = await capturePayment(recoveryInput(), { provider, paymentRepo, makeId });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.payment?.id, first.payment?.id); // same record, not a new charge
  assert.equal(provider.calls.length, 1); // provider called exactly once
});

// --- 3. declined payment ----------------------------------------------------

test("declined payment: provider declines → DECLINED, not ok, recorded honestly", async () => {
  const paymentRepo = new InMemoryPaymentRepository();
  const provider = fakeProvider({ status: "DECLINED" });

  const r = await capturePayment(recoveryInput(), { provider, paymentRepo, makeId });

  assert.equal(r.ok, false);
  assert.equal(r.status, "DECLINED");
  assert.equal(provider.calls.length, 1);
  const persisted = await paymentRepo.findByIdempotencyKey("recovery:trip-1:dis-1:82");
  assert.equal(persisted?.status, "DECLINED");
});

// --- 4. provider failure ----------------------------------------------------

test("provider failure: provider throws → FAILED, not ok, recorded with a reason", async () => {
  const paymentRepo = new InMemoryPaymentRepository();
  const provider = fakeProvider({ throws: true });

  const r = await capturePayment(recoveryInput(), { provider, paymentRepo, makeId });

  assert.equal(r.ok, false);
  assert.equal(r.status, "FAILED");
  const persisted = await paymentRepo.findByIdempotencyKey("recovery:trip-1:dis-1:82");
  assert.equal(persisted?.status, "FAILED");
  assert.ok((persisted?.failureReason ?? "").length > 0);
});

// --- 5. insufficient funding ------------------------------------------------

test("insufficient funding: funds below the charge → REFUSED, provider never called", async () => {
  const paymentRepo = new InMemoryPaymentRepository();
  const provider = fakeProvider({ status: "SUCCEEDED" });

  const r = await capturePayment(recoveryInput({ amount: 200, fundedAmount: 150 }), {
    provider,
    paymentRepo,
    makeId,
  });

  assert.equal(r.ok, false);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.code, "INSUFFICIENT_FUNDING");
  assert.equal(provider.calls.length, 0); // no charge attempted
});

// --- 6. authority denial ----------------------------------------------------

test("authority denial: extra cost over the recovery allowance → REFUSED, provider never called", async () => {
  const paymentRepo = new InMemoryPaymentRepository();
  const provider = fakeProvider({ status: "SUCCEEDED" });

  const r = await capturePayment(
    recoveryInput({ amount: 300, additionalCost: 300, recoveryAllowance: 150, fundedAmount: 2000 }),
    { provider, paymentRepo, makeId },
  );

  assert.equal(r.ok, false);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.code, "OVER_ALLOWANCE");
  assert.equal(provider.calls.length, 0);
});

// --- fallback: no provider configured ---------------------------------------

test("no provider configured: returns PROVIDER_UNCONFIGURED (caller keeps demo behavior)", async () => {
  const paymentRepo = new InMemoryPaymentRepository();
  // No injected provider and no AIRWALLEX creds in tests → honest unconfigured.
  const r = await capturePayment(recoveryInput(), { paymentRepo, makeId });
  assert.equal(r.ok, false);
  assert.equal(r.status, "PROVIDER_UNCONFIGURED");
  assert.equal(r.payment, null);
});

// --- funding wiring ---------------------------------------------------------

async function seedFundingTrip(amount: number) {
  const trip = await createTripFromBrief("Get me to Sydney under £2,000.");
  await getFlightOptionRepository().replaceForTrip(trip.id, [
    {
      id: "opt_a",
      tripId: trip.id,
      providerOfferId: "off_a",
      segments: [{ from: "LHR", to: "SYD", departAt: "2026-09-04T20:00:00Z", arriveAt: "2026-09-06T08:40:00Z" }],
      totalAmount: amount,
      currency: "GBP",
      durationMinutes: 1325,
      connections: 1,
      departAt: "2026-09-04T20:00:00Z",
      arriveAt: "2026-09-06T08:40:00Z",
      rank: 0,
      recommended: true,
      selected: true,
      expiresAt: null,
    },
  ]);
  return trip;
}

test("funding: a CONFIRMED charge records funds and marks FUNDED", async () => {
  const trip = await seedFundingTrip(1000);
  const paymentRepo = new InMemoryPaymentRepository();
  const view = await updateFunding(
    trip.id,
    { status: "FUNDED", fundedAmount: 1500 },
    { provider: fakeProvider({ status: "SUCCEEDED" }), paymentRepo, makeId },
  );
  assert.equal(view?.status, "FUNDED");
  assert.equal(view?.fundedAmount, 1500);
  const persisted = await paymentRepo.listForTrip(trip.id);
  assert.equal(persisted[0]?.kind, "FUNDING");
  assert.equal(persisted[0]?.status, "SUCCEEDED");
});

test("funding: a PENDING charge leaves the balance unsettled (PROCESSING, cannot unlock booking)", async () => {
  const trip = await seedFundingTrip(1000);
  const paymentRepo = new InMemoryPaymentRepository();
  const view = await updateFunding(
    trip.id,
    { status: "FUNDED", fundedAmount: 1500 },
    { provider: fakeProvider({ status: "PENDING" }), paymentRepo, makeId },
  );
  assert.equal(view?.status, "PROCESSING");
  assert.equal(view?.fundedAmount, 0); // not settled → not available
  assert.equal(view?.sufficient, false);
});

test("funding: a DECLINED charge records nothing as funded", async () => {
  const trip = await seedFundingTrip(1000);
  const paymentRepo = new InMemoryPaymentRepository();
  const view = await updateFunding(
    trip.id,
    { status: "FUNDED", fundedAmount: 1500 },
    { provider: fakeProvider({ status: "DECLINED" }), paymentRepo, makeId },
  );
  assert.equal(view?.sufficient, false);
  assert.equal(view?.fundedAmount, 0);
});

test("funding: with no provider, existing demo behavior is preserved exactly", async () => {
  const trip = await seedFundingTrip(1000);
  const view = await updateFunding(trip.id, { status: "FUNDED", fundedAmount: 1500 });
  assert.equal(view?.status, "FUNDED");
  assert.equal(view?.fundedAmount, 1500);
  assert.equal(await estimatedCostForTrip(trip), 1000);
});

// --- recovery wiring --------------------------------------------------------

const DEADLINE = "2026-09-05T21:00:00Z";
const NOW = new Date("2026-09-04T12:00:00Z");
const ORIGINAL_COST = 1468;

const BOOKED_SEGS: FlightSegment[] = [
  { from: "LHR", to: "SIN", departAt: "2026-09-04T21:00:00Z", arriveAt: "2026-09-05T14:00:00Z" },
  { from: "SIN", to: "SYD", departAt: "2026-09-05T16:00:00Z", arriveAt: "2026-09-05T19:35:00Z" },
];

function bookedTrip(): Trip {
  return {
    id: "trip-1", userId: "u1", status: "AT_RISK", brief: "b",
    origin: "London", destination: "Sydney", segments: [], arrivalDeadline: DEADLINE,
    currency: "GBP", tripBudget: 2000, recoveryAllowance: 150, checkedBags: 1,
    autoRebook: true, bookingStatus: "CONFIRMED", bookingReference: "SZ-4471",
    finalCost: ORIGINAL_COST, fundedAmount: 1600, selectedOptionId: "opt-booked",
  };
}

function bookedOption(): FlightOption {
  return {
    id: "opt-booked", tripId: "trip-1", providerOfferId: "off-booked", segments: BOOKED_SEGS,
    totalAmount: ORIGINAL_COST, currency: "GBP", durationMinutes: 1355, connections: 1,
    departAt: BOOKED_SEGS[0].departAt, arriveAt: BOOKED_SEGS[1].arriveAt,
    rank: 0, recommended: true, selected: true, expiresAt: null,
  };
}

function alt(): FlightOption {
  return {
    id: "alt-1", tripId: "trip-1", providerOfferId: "off-alt",
    segments: [{ from: "LHR", to: "SYD", departAt: "2026-09-04T22:00:00Z", arriveAt: "2026-09-05T18:00:00Z" }],
    totalAmount: 1550, currency: "GBP", durationMinutes: 1200, connections: 0,
    departAt: "2026-09-04T22:00:00Z", arriveAt: "2026-09-05T18:00:00Z",
    rank: 0, recommended: true, selected: false, expiresAt: null,
  };
}

function disruption(): Disruption {
  return {
    id: "dis-1", tripId: "trip-1", type: "MISSED_CONNECTION", severity: "CRITICAL",
    threatensTrip: true, triggersRecovery: true, segmentIndex: 0, from: "LHR", to: "SIN",
    flightNumber: "SQ317", delayMinutes: 120, scheduledArriveAt: "2026-09-05T14:00:00Z",
    estimatedArriveAt: "2026-09-05T15:40:00Z", summary: "Connection at SIN no longer works",
    detail: "…", detectedAt: NOW.toISOString(),
  };
}

function fakeBooking(): DuffelBookingClient {
  return {
    async getOffer(offerId: string): Promise<DuffelOffer | null> {
      return { id: offerId, total_amount: "1550", total_currency: "GBP", expires_at: "2026-09-05T00:00:00Z", slices: [], passengers: [{ id: "pas_1", type: "adult" }] };
    },
    async createOrder(p: DuffelCreateOrderParams): Promise<DuffelOrder> {
      return { id: "ord_rec_1", booking_reference: "PNR-REC", total_amount: p.amount, total_currency: p.currency };
    },
  };
}

async function setupRecovery() {
  const tripRepo = new InMemoryTripRepository();
  await tripRepo.create(bookedTrip());
  const optionRepo = new InMemoryFlightOptionRepository();
  await optionRepo.replaceForTrip("trip-1", [bookedOption()]);
  const disruptionRepo = new InMemoryDisruptionRepository();
  await disruptionRepo.add([disruption()]);
  const recoveryRepo = new InMemoryRecoveryRepository();
  const paymentRepo = new InMemoryPaymentRepository();
  return { tripRepo, optionRepo, disruptionRepo, recoveryRepo, paymentRepo };
}

function deps(repos: Awaited<ReturnType<typeof setupRecovery>>, extra: Partial<RecoveryDeps> = {}): RecoveryDeps {
  return { ...repos, now: NOW, makeId: () => `id_${++seq}`, candidates: [alt()], booking: fakeBooking(), ...extra };
}

test("recovery: a CONFIRMED payment lets the rebooking proceed and resolve the trip", async () => {
  const repos = await setupRecovery();
  const provider = fakeProvider({ status: "SUCCEEDED" });
  const outcome = await runRecovery("trip-1", deps(repos, { paymentProvider: provider }));

  assert.equal(outcome.status, "recovered");
  assert.equal(outcome.tripStatus, "RESOLVED");
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].amount, 82); // the authorized extra cost
  const payments = await repos.paymentRepo.listForTrip("trip-1");
  assert.equal(payments[0]?.kind, "RECOVERY");
  assert.equal(payments[0]?.status, "SUCCEEDED");
});

test("recovery: a DECLINED payment stops the rebooking — nothing booked, trip stays at risk", async () => {
  const repos = await setupRecovery();
  const provider = fakeProvider({ status: "DECLINED" });
  const outcome = await runRecovery("trip-1", deps(repos, { paymentProvider: provider }));

  assert.equal(outcome.status, "provider_error");
  const trip = await repos.tripRepo.getById("trip-1");
  assert.equal(trip!.status, "AT_RISK"); // not resolved
  assert.equal(trip!.duffelOrderId ?? null, null); // nothing booked
});
