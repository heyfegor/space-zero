-- Space Zero — real booking outcome columns on trips.
--
-- These record the result of a REAL provider (Duffel) order and are written ONLY
-- by the server-side booking service, which gates every booking through the
-- deterministic authority/precondition checks and advances trip state through the
-- validated state machine. They are NOT exposed on the public trip PATCH schema,
-- so no browser/LLM value can set them. Money is numeric(12,2) (exact decimal).
--
-- booking_status is the outcome of the last booking ATTEMPT, distinct from the
-- trip lifecycle status:
--   CONFIRMED — the provider confirmed a real order.
--   FAILED    — a booking was attempted at the provider but did not confirm.

alter table public.trips
  add column if not exists duffel_order_id   text,
  add column if not exists booking_reference text,
  add column if not exists final_cost        numeric(12,2),
  add column if not exists booking_status     text;

alter table public.trips drop constraint if exists trips_booking_status_check;
alter table public.trips
  add constraint trips_booking_status_check
  check (booking_status is null or booking_status in ('CONFIRMED', 'FAILED'));
