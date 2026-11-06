-- =====================================================================
-- amoka.retail ERP & POS  |  22 - Stock intake "Receive from" (origin, e.g. Madurai / Singapore)
-- Run once in Supabase SQL Editor (after files 19 and 21).
-- =====================================================================

alter table stock_intakes add column if not exists origin text;

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
    update stock_intakes set ready_date = coalesce((p->>'ready_date')::date, ready_date), shipment_ref = p->>'shipment_ref', origin = nullif(trim(p->>'origin'), ''),
           notes = p->>'notes', status = 'DRAFT', updated_at = now()
     where id = v.id returning * into v;
    delete from stock_intake_lines where intake_id = v.id;
  else
    insert into stock_intakes (intake_no, ready_date, shipment_ref, notes, origin)
    values (next_doc_no('INTAKE'), coalesce((p->>'ready_date')::date, current_date), p->>'shipment_ref', p->>'notes', nullif(trim(p->>'origin'), ''))
    returning * into v;
  end if;
  insert into stock_intake_lines (intake_id, line_no, product_id, qty, remarks, pcs_per_carton)
  select v.id, row_number() over (), (x->>'product_id')::bigint, (x->>'qty')::numeric, x->>'remarks', nullif((x->>'pcs_per_carton')::numeric, 0)
  from jsonb_array_elements(p->'lines') x
  where coalesce((x->>'qty')::numeric, 0) > 0;
  if not exists (select 1 from stock_intake_lines where intake_id = v.id) then raise exception 'Enter a quantity for at least one product'; end if;
  return v;
end $$;

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
         origin = coalesce(nullif(trim(p->>'origin'), ''), origin),
         arrival_date = (p->>'arrival_date')::date, lot_no = nullif(trim(p->>'lot_no'), ''),
         review_note = p->>'review_note', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

notify pgrst, 'reload schema';
