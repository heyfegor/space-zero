-- Space Zero — flight_options: ranked itinerary options for a trip.
-- Money is numeric(12,2) (exact). Segments are jsonb. RLS on, deny-by-default
-- (service-role bypasses); per-user policies land with auth. A fresh search
-- replaces a trip's rows (see SupabaseFlightOptionRepository.replaceForTrip).

create table if not exists public.flight_options (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips (id) on delete cascade,
  provider_offer_id text not null,
  segments          jsonb not null default '[]'::jsonb,
  total_amount      numeric(12,2) not null default 0,
  currency          text not null default 'GBP',
  duration_minutes  integer not null default 0,
  connections       integer not null default 0,
  depart_at         timestamptz,
  arrive_at         timestamptz,
  rank              integer not null default 0,
  recommended       boolean not null default false,
  selected          boolean not null default false,
  expires_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists flight_options_trip_id_idx on public.flight_options (trip_id);
create index if not exists flight_options_trip_rank_idx on public.flight_options (trip_id, rank);

alter table public.flight_options enable row level security;
