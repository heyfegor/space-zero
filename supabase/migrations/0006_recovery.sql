-- Space Zero — recoveries: the outcome of an autonomous disruption recovery.
--
-- Append-only audit written ONLY by the server-side recovery service (the booking
-- choke point). Every decision — which alternative, whether it is within authority
-- and funding — is made DETERMINISTICALLY by backend code, never the model. A row
-- is RECOVERED only when a real provider order was confirmed; otherwise ESCALATED
-- (needs the traveler). RLS on, deny-by-default (service-role bypasses).

create table if not exists public.recoveries (
  id                     uuid primary key default gen_random_uuid(),
  trip_id                uuid not null references public.trips (id) on delete cascade,
  disruption_id          uuid references public.disruptions (id) on delete set null,
  status                 text not null,
  origin                 text,
  destination            text,
  currency               text not null default 'GBP',
  additional_cost        numeric(12,2) not null default 0,
  total_amount           numeric(12,2) not null default 0,
  new_arrival            timestamptz,
  new_arrival_label      text,
  previous_arrival_label text,
  booking_reference      text,
  duffel_order_id        text,
  final_cost             numeric(12,2),
  escalation_reason      text,
  over_by                numeric(12,2),
  reason                 text,
  created_at             timestamptz not null default now(),
  constraint recoveries_status_check
    check (status in ('RECOVERED', 'ESCALATED')),
  constraint recoveries_escalation_reason_check
    check (
      escalation_reason is null
      or escalation_reason in (
        'OVER_ALLOWANCE', 'INSUFFICIENT_FUNDING', 'OVER_BUDGET',
        'AUTO_RECOVERY_DISABLED', 'NO_ELIGIBLE_OPTION'
      )
    )
);

create index if not exists recoveries_trip_id_idx on public.recoveries (trip_id);
create index if not exists recoveries_trip_created_idx on public.recoveries (trip_id, created_at desc);

alter table public.recoveries enable row level security;
