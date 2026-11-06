-- =====================================================================
-- amoka.retail ERP & POS  |  17 - Fuel amount optional: average $/L only from top-ups with an amount
-- Run once in Supabase SQL Editor (after file 16).
-- =====================================================================

create or replace function report_fuel(p_from date, p_to date)
returns table (vehicle_id bigint, vehicle text, name text, fills bigint, litres numeric, amount numeric,
               avg_price numeric, km numeric, km_per_litre numeric)
language sql stable security definer set search_path = public as $$
  with f as (
    select l.*, lag(l.odometer) over (partition by l.vehicle_id order by l.filled_at) as prev_odo
    from fuel_logs l
  )
  select v.id, v.code, v.name, count(f.id), coalesce(sum(f.litres), 0), coalesce(sum(f.amount), 0),
         case when sum(f.litres) filter (where f.amount > 0) > 0
              then round(sum(f.amount) filter (where f.amount > 0) / sum(f.litres) filter (where f.amount > 0), 3) end,
         sum(case when f.odometer is not null and f.prev_odo is not null and f.odometer > f.prev_odo then f.odometer - f.prev_odo end),
         case when sum(case when f.prev_odo is not null and f.odometer > f.prev_odo then f.litres end) > 0
              then round(sum(case when f.odometer is not null and f.prev_odo is not null and f.odometer > f.prev_odo then f.odometer - f.prev_odo end)
                         / sum(case when f.prev_odo is not null and f.odometer > f.prev_odo then f.litres end), 2) end
  from vehicles v
  join f on f.vehicle_id = v.id and (f.filled_at at time zone 'Asia/Singapore')::date between p_from and p_to
  where is_active_user() and (can('expense_approve') or f.user_id = auth.uid())
  group by v.id, v.code, v.name
  order by sum(f.litres) desc
$$;

notify pgrst, 'reload schema';
