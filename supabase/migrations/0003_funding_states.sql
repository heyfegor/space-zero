-- Space Zero — funding states.
--
-- Adopts the app-wide UPPERCASE status convention (matching TripStatus) and adds
-- INSUFFICIENT. Funding stays SEPARATE from authority and the recovery allowance
-- (trip_budget / recovery_allowance are untouched). Money is still numeric(12,2).
-- No money moves here — this is funding state/persistence only; Airwallex is not
-- integrated. funded_amount stays nullable (null until an amount is set aside).

-- Drop the inline check from 0001 (auto-named <table>_<column>_check).
alter table public.trips drop constraint if exists trips_funding_status_check;

-- Migrate existing rows: legacy lowercase -> uppercase.
update public.trips set funding_status = upper(funding_status)
  where funding_status is not null;

-- Anything unrecognized (or null) falls back to the default.
update public.trips set funding_status = 'UNFUNDED'
  where funding_status is null
     or funding_status not in ('UNFUNDED', 'PROCESSING', 'FUNDED', 'INSUFFICIENT');

alter table public.trips alter column funding_status set default 'UNFUNDED';

alter table public.trips
  add constraint trips_funding_status_check
  check (funding_status in ('UNFUNDED', 'PROCESSING', 'FUNDED', 'INSUFFICIENT'));
