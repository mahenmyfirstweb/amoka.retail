-- =====================================================================
-- amoka.retail ERP & POS  |  16 - Vehicles and diesel / fuel top-ups with proof
-- Run once in Supabase SQL Editor (after file 15).
-- =====================================================================

create table if not exists vehicles (
  id           bigint generated always as identity primary key,
  code         text not null unique,          -- vehicle number, e.g. GBA1234X
  name         text not null,                 -- model / description
  fuel_type    text not null default 'DIESEL',
  assigned_to  uuid references profiles(id),  -- usual driver / salesman
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table vehicles enable row level security;
drop policy if exists "read_active" on vehicles;
drop policy if exists "insert_perm" on vehicles;
drop policy if exists "update_perm" on vehicles;
create policy "read_active" on vehicles for select to authenticated using (is_active_user());
create policy "insert_perm" on vehicles for insert to authenticated with check (can('masters'));
create policy "update_perm" on vehicles for update to authenticated using (can('masters')) with check (can('masters'));
grant select, insert, update on vehicles to authenticated;

create table if not exists fuel_logs (
  id            bigint generated always as identity primary key,
  log_no        text not null unique,
  vehicle_id    bigint not null references vehicles(id),
  user_id       uuid not null references profiles(id) default auth.uid(),
  filled_at     timestamptz not null default now(),
  litres        numeric(10,2) not null check (litres > 0),
  amount        numeric(14,2) not null check (amount >= 0),
  odometer      integer,                       -- km reading at the pump (optional)
  station       text,
  paid_by       text not null default 'COMPANY_CARD',   -- COMPANY_CARD | CASH | CARD | NETS | PAYNOW
  receipt_path  text,                          -- proof photo in "expense-receipts" bucket
  notes         text,
  claim_id      bigint references expense_claims(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists fuel_logs_vehicle_idx on fuel_logs (vehicle_id, filled_at desc);

insert into doc_sequences (key, prefix) values ('FUEL', 'FL') on conflict (key) do nothing;

create or replace function trg_fuel_log_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.log_no is null or new.log_no = '' then new.log_no := next_doc_no('FUEL'); end if;
  new.user_id := coalesce(new.user_id, auth.uid());
  return new;
end $$;
drop trigger if exists fuel_log_no on fuel_logs;
create trigger fuel_log_no before insert on fuel_logs for each row execute function trg_fuel_log_no();
revoke execute on function trg_fuel_log_no() from public, anon, authenticated;

alter table fuel_logs enable row level security;
drop policy if exists "fuel_read" on fuel_logs;
drop policy if exists "fuel_insert" on fuel_logs;
drop policy if exists "fuel_update" on fuel_logs;
drop policy if exists "fuel_delete" on fuel_logs;
-- Own entries, or accounts / managers see everything.
create policy "fuel_read" on fuel_logs for select to authenticated
  using (is_active_user() and (user_id = auth.uid() or can('expense_approve')));
create policy "fuel_insert" on fuel_logs for insert to authenticated
  with check (is_active_user() and user_id = auth.uid());
-- Owner may correct / delete own entry within 3 days; accounts any time.
create policy "fuel_update" on fuel_logs for update to authenticated
  using ((user_id = auth.uid() and created_at > now() - interval '3 days') or can('expense_approve'));
create policy "fuel_delete" on fuel_logs for delete to authenticated
  using ((user_id = auth.uid() and created_at > now() - interval '3 days') or can('expense_approve'));
grant select, insert, update, delete on fuel_logs to authenticated;

/** Fuel report per vehicle for a date range: fills, litres, amount, avg price/L, km travelled, km per litre. */
create or replace function report_fuel(p_from date, p_to date)
returns table (vehicle_id bigint, vehicle text, name text, fills bigint, litres numeric, amount numeric,
               avg_price numeric, km numeric, km_per_litre numeric)
language sql stable security definer set search_path = public as $$
  with f as (
    select l.*, lag(l.odometer) over (partition by l.vehicle_id order by l.filled_at) as prev_odo
    from fuel_logs l
  )
  select v.id, v.code, v.name, count(f.id), coalesce(sum(f.litres), 0), coalesce(sum(f.amount), 0),
         case when sum(f.litres) > 0 then round(sum(f.amount) / sum(f.litres), 3) end,
         sum(case when f.odometer is not null and f.prev_odo is not null and f.odometer > f.prev_odo then f.odometer - f.prev_odo end),
         case when sum(case when f.prev_odo is not null and f.odometer > f.prev_odo then f.litres end) > 0
              then round(sum(case when f.odometer is not null and f.prev_odo is not null and f.odometer > f.prev_odo then f.odometer - f.prev_odo end)
                         / sum(case when f.prev_odo is not null and f.odometer > f.prev_odo then f.litres end), 2) end
  from vehicles v
  join f on f.vehicle_id = v.id and (f.filled_at at time zone 'Asia/Singapore')::date between p_from and p_to
  where is_active_user() and (can('expense_approve') or f.user_id = auth.uid())
  group by v.id, v.code, v.name
  order by sum(f.amount) desc
$$;
revoke execute on function report_fuel(date, date) from public, anon;
grant execute on function report_fuel(date, date) to authenticated;

notify pgrst, 'reload schema';
