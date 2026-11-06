-- =====================================================================
-- amoka.retail ERP & POS  |  19 - Export stock intake (exporter team -> Singapore warehouse)
--  EXPORTER role: logs in to the portal, sees ONLY stock intake (+ products to pick).
--  Flow: DRAFT -> SUBMITTED (exporter) -> APPROVED (admin: container, date, lot, deductions) -> stock added.
-- Run once in Supabase SQL Editor.
-- =====================================================================

-- ---------- EXPORTER role ----------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('ADMIN','ACCOUNTS','MANAGER','CASHIER','SALESMAN','STOREKEEPER','EXPORTER'));

insert into role_permissions (area, role) values
  ('web_portal', 'EXPORTER'),
  ('stock_intake', 'EXPORTER'), ('stock_intake', 'ADMIN'), ('stock_intake', 'MANAGER'), ('stock_intake', 'STOREKEEPER'),
  ('stock_intake_approve', 'ADMIN'), ('stock_intake_approve', 'MANAGER')
on conflict do nothing;

-- Exporters are NOT "active users" for the rest of the system (no sales, customers, reports, dashboards).
create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active and role <> 'EXPORTER')
$$;

-- ...but they can read what the intake screen needs.
do $$
declare t text;
begin
  foreach t in array array['products','categories','uoms','brands','locations','settings','role_permissions'] loop
    execute format('drop policy if exists "exporter_read" on %I', t);
    execute format('create policy "exporter_read" on %I for select to authenticated using (app_role() = ''EXPORTER'')', t);
  end loop;
end $$;

-- ---------- Intake documents ----------
create table if not exists stock_intakes (
  id            bigint generated always as identity primary key,
  intake_no     text not null unique,
  status        text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  location_id   bigint references locations(id),     -- receiving warehouse (set on approval)
  ready_date    date not null default current_date,  -- goods ready at exporter
  shipment_ref  text,                                -- exporter's own reference / invoice no.
  container_no  text,
  arrival_date  date,
  lot_no        text,
  notes         text,
  review_note   text,
  created_by    uuid references profiles(id) default auth.uid(),
  submitted_at  timestamptz,
  approved_by   uuid references profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists stock_intake_lines (
  id             bigint generated always as identity primary key,
  intake_id      bigint not null references stock_intakes(id) on delete cascade,
  line_no        int not null default 0,
  product_id     bigint not null references products(id),
  qty            numeric(14,3) not null default 0 check (qty >= 0),   -- shipped (exporter)
  received_qty   numeric(14,3),                                      -- counted on arrival (admin)
  deduct_qty     numeric(14,3) not null default 0 check (deduct_qty >= 0),
  deduct_reason  text,                                               -- e.g. Customs sample, Damaged, Short
  remarks        text,
  added_qty      numeric(14,3)                                       -- final qty put into stock
);
create index if not exists stock_intake_lines_intake_idx on stock_intake_lines (intake_id);

insert into doc_sequences (key, prefix) values ('INTAKE', 'SI') on conflict (key) do nothing;

alter table stock_intakes enable row level security;
alter table stock_intake_lines enable row level security;
drop policy if exists "intake_read" on stock_intakes;
drop policy if exists "intake_lines_read" on stock_intake_lines;
create policy "intake_read" on stock_intakes for select to authenticated using (can('stock_intake') or is_active_user());
create policy "intake_lines_read" on stock_intake_lines for select to authenticated
  using (exists (select 1 from stock_intakes i where i.id = intake_id));
grant select on stock_intakes, stock_intake_lines to authenticated;

/**
 * Create / update a DRAFT (or REJECTED) intake. p: {id?, ready_date, shipment_ref, notes, lines:[{product_id, qty, remarks}]}
 * Returns the intake row. Use submit_stock_intake to send it for approval.
 */
create or replace function save_stock_intake(p jsonb) returns stock_intakes
language plpgsql security definer set search_path = public as $$
declare v stock_intakes%rowtype;
begin
  perform assert_can('stock_intake');
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Add at least one product'; end if;
  if p->>'id' is not null then
    select * into v from stock_intakes where id = (p->>'id')::bigint for update;
    if not found then raise exception 'Intake not found'; end if;
    if v.status not in ('DRAFT','REJECTED') then raise exception 'This intake is % and cannot be changed', lower(v.status); end if;
    update stock_intakes set ready_date = coalesce((p->>'ready_date')::date, ready_date), shipment_ref = p->>'shipment_ref',
           notes = p->>'notes', status = 'DRAFT', updated_at = now()
     where id = v.id returning * into v;
    delete from stock_intake_lines where intake_id = v.id;
  else
    insert into stock_intakes (intake_no, ready_date, shipment_ref, notes)
    values (next_doc_no('INTAKE'), coalesce((p->>'ready_date')::date, current_date), p->>'shipment_ref', p->>'notes')
    returning * into v;
  end if;
  insert into stock_intake_lines (intake_id, line_no, product_id, qty, remarks)
  select v.id, row_number() over (), (x->>'product_id')::bigint, (x->>'qty')::numeric, x->>'remarks'
  from jsonb_array_elements(p->'lines') x
  where coalesce((x->>'qty')::numeric, 0) > 0;
  if not exists (select 1 from stock_intake_lines where intake_id = v.id) then raise exception 'Enter a quantity for at least one product'; end if;
  return v;
end $$;

create or replace function submit_stock_intake(p_id bigint) returns stock_intakes
language plpgsql security definer set search_path = public as $$
declare v stock_intakes%rowtype;
begin
  perform assert_can('stock_intake');
  update stock_intakes set status = 'SUBMITTED', submitted_at = now(), updated_at = now()
   where id = p_id and status in ('DRAFT','REJECTED') returning * into v;
  if not found then raise exception 'Only draft intakes can be submitted'; end if;
  return v;
end $$;

/**
 * Admin approval (one click). p: {location_id, container_no, arrival_date, lot_no, review_note?,
 *   lines:[{id?, product_id, qty?, received_qty, deduct_qty, deduct_reason}]}   (lines without id = extra deduction for a product)
 * Stock added = received_qty - deduct_qty per line (moved into location as INTAKE).
 */
create or replace function approve_stock_intake(p_id bigint, p jsonb) returns stock_intakes
language plpgsql security definer set search_path = public as $$
declare
  v stock_intakes%rowtype; l jsonb; r stock_intake_lines%rowtype; v_loc bigint; v_add numeric;
begin
  perform assert_can('stock_intake_approve');
  select * into v from stock_intakes where id = p_id for update;
  if not found then raise exception 'Intake not found'; end if;
  if v.status <> 'SUBMITTED' then raise exception 'Only submitted intakes can be approved (this one is %)', lower(v.status); end if;
  v_loc := coalesce((p->>'location_id')::bigint, app_location(), (select min(id) from locations));
  if coalesce(trim(p->>'container_no'), '') = '' then raise exception 'Enter the container number'; end if;
  if p->>'arrival_date' is null then raise exception 'Enter the arrival date'; end if;

  -- Apply admin's counts / deductions; extra lines = deductions for products not on the list.
  for l in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    if l->>'id' is not null then
      update stock_intake_lines set
        received_qty = coalesce((l->>'received_qty')::numeric, qty),
        deduct_qty = coalesce((l->>'deduct_qty')::numeric, 0),
        deduct_reason = nullif(trim(l->>'deduct_reason'), '')
      where id = (l->>'id')::bigint and intake_id = p_id;
    else
      insert into stock_intake_lines (intake_id, line_no, product_id, qty, received_qty, deduct_qty, deduct_reason, remarks)
      values (p_id, 999, (l->>'product_id')::bigint, 0, 0, coalesce((l->>'deduct_qty')::numeric, 0),
              coalesce(nullif(trim(l->>'deduct_reason'), ''), 'Customs sample'), 'Added at approval');
    end if;
  end loop;

  for r in select * from stock_intake_lines where intake_id = p_id order by line_no, id loop
    v_add := coalesce(r.received_qty, r.qty) - r.deduct_qty;
    update stock_intake_lines set added_qty = v_add where id = r.id;
    if v_add <> 0 then
      perform move_stock(r.product_id, v_loc, v_add, 'INTAKE', v.intake_no,
        concat_ws(' · ', 'Container ' || (p->>'container_no'), 'Lot ' || nullif(p->>'lot_no', ''),
                  case when r.deduct_qty > 0 then format('less %s %s', r.deduct_qty, coalesce(r.deduct_reason, 'deducted')) end));
    end if;
  end loop;

  update stock_intakes set status = 'APPROVED', location_id = v_loc, container_no = trim(p->>'container_no'),
         arrival_date = (p->>'arrival_date')::date, lot_no = nullif(trim(p->>'lot_no'), ''),
         review_note = p->>'review_note', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

create or replace function reject_stock_intake(p_id bigint, p_reason text) returns stock_intakes
language plpgsql security definer set search_path = public as $$
declare v stock_intakes%rowtype;
begin
  perform assert_can('stock_intake_approve');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Enter the reason'; end if;
  update stock_intakes set status = 'REJECTED', review_note = p_reason, updated_at = now()
   where id = p_id and status = 'SUBMITTED' returning * into v;
  if not found then raise exception 'Only submitted intakes can be rejected'; end if;
  return v;
end $$;

do $$
declare f text;
begin
  foreach f in array array['save_stock_intake(jsonb)','submit_stock_intake(bigint)','approve_stock_intake(bigint, jsonb)','reject_stock_intake(bigint, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
