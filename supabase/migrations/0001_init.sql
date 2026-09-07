-- Space Zero — initial schema: users + trips.
-- Money is stored as numeric(12,2) (exact decimal — never floating point).
-- RLS is enabled with NO permissive public policy: by default no anonymous
-- client can read or write any row. The server uses the service-role key, which
-- bypasses RLS. When WebAuthn lands, add per-user policies (auth.uid() = user_id)
-- and switch user-facing access to a user-scoped client.

create extension if not exists "pgcrypto";

-- Keep updated_at fresh on every UPDATE.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- USERS -----------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function set_updated_at();

-- TRIPS -----------------------------------------------------------------------
create table if not exists public.trips (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  status             text not null default 'DRAFT'
                       check (status in (
                         'DRAFT','PLANNING','AWAITING_AUTHORITY','READY','BOOKING',
                         'CONFIRMED','MONITORING','AT_RISK','RECOVERING','RESOLVED'
                       )),
  brief              text,
  origin             text,
  destination        text,
  arrive_by          text,
  depart             text,
  trip_budget        numeric(12,2) not null default 0,
  recovery_allowance numeric(12,2) not null default 0,
  funded_amount      numeric(12,2),
  funding_status     text not null default 'unfunded'
                       check (funding_status in ('unfunded','processing','funded')),
  cabin              text,
  baggage            text,
  seat               text,
  selected_option_id text,
  currency           text not null default 'GBP',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists trips_user_id_idx on public.trips (user_id);
create index if not exists trips_status_idx on public.trips (status);

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function set_updated_at();

-- Row Level Security: on, deny-by-default (no policies yet). Service-role bypasses.
alter table public.users enable row level security;
alter table public.trips enable row level security;

-- Temporary development identity (NOT authentication). All dev trips are owned
-- by this fixed user until WebAuthn is implemented.
insert into public.users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'dev@spacezero.local')
on conflict (id) do nothing;
