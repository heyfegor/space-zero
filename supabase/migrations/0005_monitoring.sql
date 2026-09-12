-- Space Zero — disruptions: what flight monitoring detected for a trip.
--
-- Append-only audit written ONLY by the server-side monitoring service, which
-- determines DETERMINISTICALLY (never via the model/provider) whether an observed
-- change threatens the trip. `threatens_trip` = the deterministic verdict;
-- `triggers_recovery` marks the ones that created an operational event for the
-- existing recovery flow (recovery is NOT run automatically here). RLS on,
-- deny-by-default (service-role bypasses); per-user policies land with auth.

create table if not exists public.disruptions (
  id                   uuid primary key default gen_random_uuid(),
  trip_id              uuid not null references public.trips (id) on delete cascade,
  type                 text not null,
  severity             text not null default 'MINOR',
  threatens_trip       boolean not null default false,
  triggers_recovery    boolean not null default false,
  segment_index        integer not null default 0,
  origin               text,
  destination          text,
  flight_number        text,
  delay_minutes        integer not null default 0,
  scheduled_arrive_at  timestamptz,
  estimated_arrive_at  timestamptz,
  summary              text,
  detail               text,
  detected_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  constraint disruptions_type_check
    check (type in ('CANCELLATION', 'DIVERSION', 'MISSED_CONNECTION', 'ARRIVAL_BREACH', 'DELAY')),
  constraint disruptions_severity_check
    check (severity in ('MINOR', 'CRITICAL'))
);

create index if not exists disruptions_trip_id_idx on public.disruptions (trip_id);
create index if not exists disruptions_trip_detected_idx on public.disruptions (trip_id, detected_at desc);

alter table public.disruptions enable row level security;
