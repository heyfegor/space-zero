-- Space Zero — payments: the audit of every charge attempt (sandbox).
--
-- Written ONLY by the server-side payment service, which is the money-movement
-- boundary. A payment is created only AFTER the deterministic authority + funding
-- gate passes, and is reconciled to the provider's honest outcome — a row is
-- SUCCEEDED only when the provider CONFIRMED the charge; otherwise PENDING,
-- DECLINED, or FAILED. The provider's raw response is never stored (only its id
-- and a sanitized status/reason). RLS on, deny-by-default (service-role bypasses).
--
-- idempotency_key is UNIQUE: it is what makes a repeat of the same logical charge
-- a no-op, preventing duplicate charges even under a race.

create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references public.trips (id) on delete cascade,
  kind                  text not null,
  status                text not null default 'PENDING',
  amount                numeric(12,2) not null default 0,
  currency              text not null default 'GBP',
  idempotency_key       text not null unique,
  provider              text not null default 'airwallex',
  provider_payment_id   text,
  provider_status       text,
  failure_reason        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint payments_kind_check
    check (kind in ('FUNDING', 'RECOVERY')),
  constraint payments_status_check
    check (status in ('PENDING', 'SUCCEEDED', 'FAILED', 'DECLINED'))
);

create index if not exists payments_trip_id_idx on public.payments (trip_id);
create index if not exists payments_trip_created_idx on public.payments (trip_id, created_at desc);

alter table public.payments enable row level security;
