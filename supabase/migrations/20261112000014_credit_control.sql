-- =====================================================================
-- amoka.retail ERP & POS  |  14 - Credit control on invoices
--  * Credit term: a customer with an unpaid invoice past its due date cannot get a new credit invoice.
--    (Cash / 0-day customers: an unpaid invoice is due the same day, so it blocks from the next day.)
--  * Credit limit: outstanding + new credit invoice may not exceed customers.credit_limit (0 = no limit).
--  * Invoices fully paid on the spot, and sales orders, are always allowed.
--  * Roles with "credit_override" (Admin, Manager by default) may still invoice.
-- Run once in Supabase SQL Editor.
-- =====================================================================

insert into role_permissions (area, role) values ('credit_override', 'ADMIN'), ('credit_override', 'MANAGER')
on conflict do nothing;

/**
 * Credit position of a customer. p_new_amount = credit amount of the invoice about to be created.
 * Returns {outstanding, credit_limit, available, overdue_amount, overdue_count, oldest_due, terms_days,
 *          blocked, reason: OVERDUE | LIMIT | null, message}
 */
create or replace function customer_credit_status(p_customer bigint, p_new_amount numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c customers%rowtype;
  v_today date := (now() at time zone 'Asia/Singapore')::date;
  v_out numeric;
  v_over numeric; v_cnt int; v_oldest date;
  v_reason text; v_msg text;
begin
  if not is_active_user() then raise exception 'Not allowed'; end if;
  select * into c from customers where id = p_customer;
  if not found then raise exception 'Customer not found'; end if;

  v_out := coalesce(customer_outstanding(p_customer), 0);
  select coalesce(sum(total - paid - credited), 0), count(*), min(coalesce(due_date, doc_date::date))
    into v_over, v_cnt, v_oldest
    from sales_docs
   where customer_id = p_customer and type = 'INVOICE' and status <> 'VOID'
     and total - paid - credited > 0.004
     and coalesce(due_date, (doc_date at time zone 'Asia/Singapore')::date) < v_today;

  if v_over > 0.004 then
    v_reason := 'OVERDUE';
    v_msg := format('%s has %s overdue invoice(s) totalling $%s (oldest due %s). Credit term is over — collect the payment before creating a new invoice.',
                    c.name, v_cnt, to_char(v_over, 'FM999,999,990.00'), to_char(v_oldest, 'DD/MM/YYYY'));
  elsif c.credit_limit > 0 and v_out + coalesce(p_new_amount, 0) > c.credit_limit + 0.004 then
    v_reason := 'LIMIT';
    v_msg := format('%s has reached the credit limit. Outstanding $%s + this invoice $%s is more than the limit $%s. Collect the payment for further process.',
                    c.name, to_char(v_out, 'FM999,999,990.00'), to_char(coalesce(p_new_amount, 0), 'FM999,999,990.00'),
                    to_char(c.credit_limit, 'FM999,999,990.00'));
  end if;

  return jsonb_build_object(
    'outstanding', v_out,
    'credit_limit', c.credit_limit,
    'available', case when c.credit_limit > 0 then greatest(c.credit_limit - v_out, 0) end,
    'overdue_amount', v_over,
    'overdue_count', v_cnt,
    'oldest_due', v_oldest,
    'terms_days', c.terms_days,
    'blocked', v_reason is not null,
    'reason', v_reason,
    'message', v_msg);
end $$;
revoke execute on function customer_credit_status(bigint, numeric) from public, anon;
grant execute on function customer_credit_status(bigint, numeric) to authenticated;

-- create_sales_doc with the credit check (rest unchanged from file 02).
create or replace function create_sales_doc(p jsonb, p_pos boolean default false, p_session bigint default null)
returns sales_docs
language plpgsql security definer set search_path = public as $$
declare
  v_type text := p->>'type';
  v_loc bigint := coalesce((p->>'location_id')::bigint, app_location());
  v_cust bigint := (p->>'customer_id')::bigint;
  v_src sales_docs%rowtype;
  v_customer customers%rowtype;
  v_set settings%rowtype;
  v_calc jsonb; v_doc sales_docs%rowtype; v_no text;
  v_date timestamptz := coalesce((p->>'doc_date')::timestamptz, now());
  v_due date := (p->>'due_date')::date;
  v_sign int; v_mtype text; l jsonb; pay jsonb;
  v_remaining numeric; v_applied numeric; v_credit numeric;
  v_paying numeric; v_cs jsonb;
begin
  if v_type not in ('QUOTE','ORDER','INVOICE','DELIVERY','RETURN') then raise exception 'Invalid document type'; end if;
  perform assert_can(case when p_pos then 'pos' else sales_area(v_type) end);
  if v_loc is null then raise exception 'Select a location'; end if;
  if v_cust is null and not p_pos then raise exception 'Select a customer'; end if;

  -- Mobile offline sync: same client_ref = same document, never duplicated.
  if p->>'client_ref' is not null then
    select * into v_doc from sales_docs where client_ref = p->>'client_ref';
    if found then return v_doc; end if;
  end if;

  if v_cust is not null then
    select * into v_customer from customers where id = v_cust;
    if not found then raise exception 'Customer not found'; end if;
  end if;

  if p->>'source_id' is not null then
    select * into v_src from sales_docs where id = (p->>'source_id')::bigint for update;
    if not found then raise exception 'Source document not found'; end if;
    if v_src.status <> 'OPEN' then raise exception '% is % and cannot be converted', v_src.doc_no, lower(v_src.status); end if;
    if not sales_can_convert(v_src.type, v_type) then raise exception 'Cannot create % from %', v_type, v_src.type; end if;
    if v_src.customer_id is distinct from v_cust then raise exception 'Customer must match the source document'; end if;
  end if;

  select * into v_set from settings where id = 1;
  v_calc := calc_doc(p->'lines', (p->>'discount')::numeric, v_set.tax_inclusive);
  -- Credit control: only for invoices that are (partly) on credit.
  if v_type = 'INVOICE' and v_cust is not null and not can('credit_override') then
    select coalesce(sum((x->>'amount')::numeric), 0) into v_paying from jsonb_array_elements(coalesce(p->'payments', '[]')) x;
    if (v_calc->>'total')::numeric - v_paying > 0.004 then
      v_cs := customer_credit_status(v_cust, (v_calc->>'total')::numeric - least(v_paying, (v_calc->>'total')::numeric));
      if (v_cs->>'blocked')::boolean then
        raise exception 'CREDIT_BLOCK: %', v_cs->>'message' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if v_due is null and v_type = 'INVOICE' and coalesce(v_customer.terms_days, 0) > 0 then
    v_due := (v_date + make_interval(days => v_customer.terms_days))::date;
  end if;

  v_no := next_doc_no(v_type);
  insert into sales_docs (doc_no, type, doc_date, due_date, customer_id, location_id, user_id, source_id,
                          ref_no, notes, subtotal, discount, tax, total, is_pos, client_ref, signature_url)
  values (v_no, v_type, v_date, v_due, v_cust, v_loc, auth.uid(), v_src.id,
          p->>'ref_no', p->>'notes', (v_calc->>'subtotal')::numeric, (v_calc->>'discount')::numeric,
          (v_calc->>'tax')::numeric, (v_calc->>'total')::numeric, p_pos, p->>'client_ref', p->>'signature_url')
  returning * into v_doc;

  insert into sales_lines (doc_id, line_no, product_id, description, qty, price, discount, tax_rate, line_total, cost)
  select v_doc.id, x.line_no, x.product_id, x.description, x.qty, x.price, x.discount, x.tax_rate, x.line_total, x.cost
  from jsonb_to_recordset(v_calc->'lines') as x(line_no int, product_id bigint, description text, qty numeric,
       price numeric, discount numeric, tax_rate numeric, line_total numeric, cost numeric);

  -- Stock: invoices take stock out, returns put it back.
  v_sign := case v_type when 'INVOICE' then -1 when 'RETURN' then 1 else 0 end;
  v_mtype := case v_type when 'INVOICE' then 'SALE' else 'SALE_RETURN' end;
  if v_sign <> 0 then
    for l in select * from jsonb_array_elements(v_calc->'lines') loop
      perform move_stock((l->>'product_id')::bigint, v_loc, v_sign * (l->>'qty')::numeric, v_mtype, v_no);
    end loop;
  end if;

  if v_src.id is not null then
    if (v_src.type, v_type) in (('QUOTE','ORDER'),('QUOTE','INVOICE'),('ORDER','INVOICE')) then
      update sales_docs set status = 'CONVERTED', updated_at = now() where id = v_src.id;
    end if;
    if v_src.type = 'INVOICE' and v_type = 'RETURN' then
      v_credit := least(v_doc.total, greatest(v_src.total - v_src.paid - v_src.credited, 0));
      if v_credit > 0 then
        update sales_docs set credited = credited + v_credit, updated_at = now() where id = v_src.id;
      end if;
    end if;
  end if;

  if jsonb_array_length(coalesce(p->'payments', '[]')) > 0 then
    if v_type <> 'INVOICE' then raise exception 'Payments can only be taken on invoices'; end if;
    v_remaining := v_doc.total;
    for pay in select * from jsonb_array_elements(p->'payments') loop
      v_applied := round(least((pay->>'amount')::numeric, v_remaining), 2);
      continue when v_applied <= 0;
      v_remaining := v_remaining - v_applied;
      perform create_receipt(jsonb_build_object(
        'customer_id', v_cust, 'location_id', v_loc, 'paymode_id', pay->'paymode_id', 'amount', v_applied,
        'reference', pay->>'reference', 'cheque_no', pay->>'cheque_no', 'session_id', p_session,
        'allocations', jsonb_build_array(jsonb_build_object('doc_id', v_doc.id, 'amount', v_applied))));
    end loop;
  end if;

  select * into v_doc from sales_docs where id = v_doc.id;
  return v_doc;
end $$;

notify pgrst, 'reload schema';
