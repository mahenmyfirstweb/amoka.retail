-- =====================================================================
-- amoka.retail ERP & POS  |  18 - Fuel: km driven between top-ups (from odometer readings)
-- For every top-up: previous top-up with an odometer reading (same vehicle, any earlier date),
-- km driven since then, days between, and km per litre (km / litres of this fill).
-- Run once in Supabase SQL Editor (after files 16-17).
-- =====================================================================

create or replace function report_fuel_logs(p_from date, p_to date)
returns table (
  id bigint, log_no text, filled_at timestamptz, vehicle_id bigint, vehicle text, vehicle_name text,
  user_id uuid, driver text, litres numeric, amount numeric, odometer integer, station text, paid_by text,
  claim_id bigint, receipt_path text,
  prev_filled_at timestamptz, prev_odometer integer, km integer, days numeric, km_per_litre numeric
)
language sql stable security definer set search_path = public as $$
  select l.id, l.log_no, l.filled_at, l.vehicle_id, v.code, v.name,
         l.user_id, pr.full_name, l.litres, l.amount, l.odometer, l.station, l.paid_by,
         l.claim_id, l.receipt_path,
         p.filled_at, p.odometer,
         case when l.odometer is not null and p.odometer is not null and l.odometer > p.odometer then l.odometer - p.odometer end,
         case when p.filled_at is not null then round(extract(epoch from (l.filled_at - p.filled_at)) / 86400.0, 1) end,
         case when l.odometer is not null and p.odometer is not null and l.odometer > p.odometer and l.litres > 0
              then round((l.odometer - p.odometer)::numeric / l.litres, 2) end
  from fuel_logs l
  join vehicles v on v.id = l.vehicle_id
  left join profiles pr on pr.id = l.user_id
  left join lateral (
    select x.filled_at, x.odometer from fuel_logs x
    where x.vehicle_id = l.vehicle_id and x.filled_at < l.filled_at and x.odometer is not null
    order by x.filled_at desc limit 1
  ) p on true
  where is_active_user()
    and (can('expense_approve') or l.user_id = auth.uid())
    and (l.filled_at at time zone 'Asia/Singapore')::date between p_from and p_to
  order by v.code, l.filled_at
$$;
revoke execute on function report_fuel_logs(date, date) from public, anon;
grant execute on function report_fuel_logs(date, date) to authenticated;

notify pgrst, 'reload schema';
