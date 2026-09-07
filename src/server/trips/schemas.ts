/**
 * Space Zero — request/response validation for the trip API (Zod).
 *
 * Every write boundary validates here. Patch is `.strict()` so unknown columns
 * in the request body are rejected outright — the client can never set arbitrary
 * database fields.
 */

import { z } from "zod";

const money = z.number().finite().nonnegative().max(10_000_000);

/** POST /api/trips body. */
export const createTripSchema = z.object({
  brief: z.string().trim().min(1, "A non-empty trip brief is required.").max(4000),
});
export type CreateTripInput = z.infer<typeof createTripSchema>;

/** Validated structured intent (parser output and the shape the API returns). */
export const tripIntentSchema = z.object({
  origin: z.string().max(200).optional(),
  destination: z.string().max(200),
  arriveBy: z.string().max(200).optional(),
  depart: z.string().max(200).optional(),
  budget: money.optional(),
  recoveryAllowance: money.optional(),
  cabin: z.string().max(80).optional(),
  baggage: z.string().max(80).optional(),
  seat: z.string().max(80).optional(),
});

/**
 * PATCH /api/trips/[id]/funding body. Funding is its own boundary — it is NOT
 * part of tripPatchSchema, so funding can never be set through the generic trip
 * PATCH. The server resolves the terminal status against the estimated cost, so
 * a client asking for FUNDED while short is stored as INSUFFICIENT.
 */
export const fundingStatusSchema = z.enum(["UNFUNDED", "PROCESSING", "FUNDED", "INSUFFICIENT"]);

export const fundingUpdateSchema = z
  .object({
    status: fundingStatusSchema,
    fundedAmount: money.nullable().optional(),
  })
  .strict();
export type FundingUpdateInput = z.infer<typeof fundingUpdateSchema>;

/** PATCH /api/trips/[id] body — only these fields may be updated this phase. */
export const tripPatchSchema = z
  .object({
    origin: z.string().max(200),
    destination: z.string().max(200),
    arriveBy: z.string().max(200),
    depart: z.string().max(200),
    budget: money,
    recoveryAllowance: money,
    cabin: z.string().max(80),
    baggage: z.string().max(80),
    seat: z.string().max(80),
    selectedOptionId: z.string().max(200).nullable(),
  })
  .partial()
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one updatable field must be provided.",
  });
export type TripPatchInput = z.infer<typeof tripPatchSchema>;
