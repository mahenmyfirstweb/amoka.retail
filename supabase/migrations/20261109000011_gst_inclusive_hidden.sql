-- =====================================================================
-- amoka.retail ERP & POS  |  11 - Prices include GST; GST not shown on documents
-- Run once in Supabase SQL Editor.
-- =====================================================================

-- show_tax = false: invoices / receipts / screens show only the Total (no GST line, title "INVOICE").
alter table settings add column if not exists show_tax boolean not null default false;
update settings set tax_inclusive = true, show_tax = false where id = 1;

-- When prices include GST, purchase documents are treated the same way (supplier prices include GST too).
-- calc_doc now uses the company setting if it says prices are tax-inclusive.
create or replace function calc_doc(p_lines jsonb, p_discount numeric, p_tax_inclusive boolean)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rate numeric := (select tax_rate from settings where id = 1);
  v_incl boolean := coalesce(p_tax_inclusive, false) or coalesce((select tax_inclusive from settings where id = 1), false);
  v_lines jsonb := '[]'::jsonb;
  v_gross numeric := 0; v_disc numeric; v_ratio numeric; v_tax numeric := 0; v_net numeric;
  l jsonb; p products%rowtype; v_lt numeric; v_lr numeric; i int := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one product';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into p from products where id = (l->>'product_id')::bigint;
    if not found then raise exception 'Product % not found', l->>'product_id'; end if;
    if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'Qty must be more than 0 for %', p.name; end if;
    if coalesce((l->>'price')::numeric, 0) < 0 then raise exception 'Price cannot be negative for %', p.name; end if;
    i := i + 1;
    v_lt := round((l->>'qty')::numeric * (l->>'price')::numeric - coalesce((l->>'discount')::numeric, 0), 2);
    v_lr := case when p.taxable then v_rate else 0 end;
    v_gross := v_gross + v_lt;
    v_lines := v_lines || jsonb_build_object(
      'line_no', i, 'product_id', p.id,
      'description', coalesce(nullif(l->>'description', ''), p.name),
      'qty', (l->>'qty')::numeric, 'price', (l->>'price')::numeric,
      'discount', round(coalesce((l->>'discount')::numeric, 0), 2),
      'tax_rate', v_lr, 'line_total', v_lt, 'cost', p.cost_price);
  end loop;

  v_disc := round(least(greatest(coalesce(p_discount, 0), 0), greatest(v_gross, 0)), 2);
  v_ratio := case when v_gross = 0 then 1 else (v_gross - v_disc) / v_gross end;
  select coalesce(sum(case when v_incl
           then (x->>'line_total')::numeric * v_ratio * (x->>'tax_rate')::numeric / (100 + (x->>'tax_rate')::numeric)
           else (x->>'line_total')::numeric * v_ratio * (x->>'tax_rate')::numeric / 100 end), 0)
    into v_tax from jsonb_array_elements(v_lines) x;
  v_tax := round(v_tax, 2);
  v_net := round(v_gross - v_disc, 2);
  return jsonb_build_object(
    'lines', v_lines, 'discount', v_disc, 'tax', v_tax,
    'subtotal', case when v_incl then v_net - v_tax else v_net end,
    'total', case when v_incl then v_net else v_net + v_tax end);
end $$;

-- Sales report amounts: with GST-inclusive pricing show the full amount customers paid.
-- (GST is still stored per document in sales_docs.tax for your accountant.)

notify pgrst, 'reload schema';
