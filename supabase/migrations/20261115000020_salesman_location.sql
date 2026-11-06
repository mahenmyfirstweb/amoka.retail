-- =====================================================================
-- amoka.retail ERP & POS  |  20 - Salesman / vehicle live location (while the salesman app is open)
-- Run once in Supabase SQL Editor.
-- =====================================================================

alter table settings add column if not exists track_location boolean not null default true;

create table if not exists device_locations (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references profiles(id) default auth.uid(),
  lat          double precision not null,
  lng          double precision not null,
  accuracy     real,           -- metres
  speed        real,           -- metres / second (if the phone reports it)
  heading      real,
  event        text,           -- PING | ORDER | INVOICE | RECEIPT | FUEL ...
  vehicle_id   bigint references vehicles(id),
  recorded_at  timestamptz not null default now()
);
create index if not exists device_locations_user_time_idx on device_locations (user_id, recorded_at desc);

insert into role_permissions (area, role) values ('track_staff', 'ADMIN'), ('track_staff', 'MANAGER')
on conflict do nothing;

alter table device_locations enable row level security;
drop policy if exists "loc_insert" on device_locations;
drop policy if exists "loc_read" on device_locations;
create policy "loc_insert" on device_locations for insert to authenticated
  with check (is_active_user() and user_id = auth.uid());
create policy "loc_read" on device_locations for select to authenticated
  using (user_id = auth.uid() or can('track_staff'));
grant select, insert on device_locations to authenticated;

/** Latest position of every staff member (admin live map). */
create or replace function latest_locations() returns table (
  user_id uuid, full_name text, role text, lat double precision, lng double precision, accuracy real, speed real,
  event text, recorded_at timestamptz, vehicle text
)
language sql stable security definer set search_path = public as $$
  select distinct on (d.user_id) d.user_id, p.full_name, p.role, d.lat, d.lng, d.accuracy, d.speed, d.event, d.recorded_at,
         coalesce(v.code, (select v2.code from vehicles v2 where v2.assigned_to = d.user_id and v2.is_active limit 1))
  from device_locations d
  join profiles p on p.id = d.user_id
  left join vehicles v on v.id = d.vehicle_id
  where can('track_staff') and d.recorded_at > now() - interval '7 days'
  order by d.user_id, d.recorded_at desc
$$;
revoke execute on function latest_locations() from public, anon;
grant execute on function latest_locations() to authenticated;

-- Keep 90 days of history (run occasionally, or schedule with pg_cron):
--   delete from device_locations where recorded_at < now() - interval '90 days';

notify pgrst, 'reload schema';
