-- =====================================================================
-- amoka.retail ERP & POS  |  21 - Stock intake: carton size (pcs per carton) per line
-- Run once in Supabase SQL Editor (after file 19).
-- =====================================================================

alter table stock_intake_lines add column if not exists pcs_per_carton numeric(14,3);

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
  insert into stock_intake_lines (intake_id, line_no, product_id, qty, remarks, pcs_per_carton)
  select v.id, row_number() over (), (x->>'product_id')::bigint, (x->>'qty')::numeric, x->>'remarks', nullif((x->>'pcs_per_carton')::numeric, 0)
  from jsonb_array_elements(p->'lines') x
  where coalesce((x->>'qty')::numeric, 0) > 0;
  if not exists (select 1 from stock_intake_lines where intake_id = v.id) then raise exception 'Enter a quantity for at least one product'; end if;
  return v;
end $$;

notify pgrst, 'reload schema';
