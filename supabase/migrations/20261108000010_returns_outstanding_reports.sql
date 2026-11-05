-- =====================================================================
-- amoka.retail ERP & POS  |  10 - Sales returns (expired/damaged), customer outstanding, reports
-- Run once in Supabase SQL Editor.
-- =====================================================================

-- ---------- Return details ----------
alter table sales_docs add column if not exists restock boolean not null default true;   -- false = expired/damaged, written off
alter table sales_docs add column if not exists return_reason text;                       -- EXPIRED | DAMAGED | WRONG_ITEM | OTHER

-- Which invoices a return's credit was applied to (so a void can undo it exactly).
create table if not exists return_allocations (
  id         bigint generated always as identity primary key,
  return_id  bigint not null references sales_docs(id) on delete cascade,
  doc_id     bigint not null references sales_docs(id),
  amount     numeric(14,2) not null check (amount > 0)
);
alter table return_allocations enable row level security;
drop policy if exists "read_active" on return_allocations;
create policy "read_active" on return_allocations for select to authenticated
  using (exists (select 1 from sales_docs d where d.id = return_id));
grant select on return_allocations to authenticated;

-- ---------- Customer balance ----------
/** What the customer owes: invoices - returns - receipts (all active), optionally as of a date. */
create or replace function customer_outstanding(p_customer bigint, p_as_of date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select case when not is_active_user() then null else
    coalesce((select sum(case when type = 'INVOICE' then total else -total end) from sales_docs
               where customer_id = p_customer and type in ('INVOICE','RETURN') and status <> 'VOID'
                 and (p_as_of is null or doc_date::date <= p_as_of)), 0)
  - coalesce((select sum(amount) from receipts
               where customer_id = p_customer and status = 'ACTIVE'
                 and (p_as_of is null or receipt_date::date <= p_as_of)), 0)
  end
$$;

-- ---------- Sales return ----------
/**
 * p: {customer_id, location_id?, invoice_id?, return_reason, restock (default true), notes?, doc_date?, client_ref?,
 *     lines:[{product_id, qty, price, description?}]}
 * - restock=false (expired/damaged): stock is NOT put back (written off).
 * - The return value is credited to invoice_id first, then to the oldest unpaid invoices.
 *   Anything left stays as customer credit (reduces customer_outstanding).
 */
create or replace function create_sales_return(p jsonb) returns sales_docs
language plpgsql security definer set search_path = public as $$
declare
  v_doc sales_docs%rowtype; v_inv record; v_left numeric; v_apply numeric;
  v_restock boolean := coalesce((p->>'restock')::boolean, true);
  v_invoice bigint := (p->>'invoice_id')::bigint;
  l jsonb;
begin
  perform assert_can('sales_return');
  if p->>'customer_id' is null then raise exception 'Select a customer'; end if;
  if p->>'client_ref' is not null then
    select * into v_doc from sales_docs where client_ref = p->>'client_ref';
    if found then return v_doc; end if;
  end if;
  if v_invoice is not null and not exists (
       select 1 from sales_docs where id = v_invoice and type = 'INVOICE' and status <> 'VOID'
         and customer_id = (p->>'customer_id')::bigint) then
    raise exception 'The selected invoice does not belong to this customer';
  end if;

  v_doc := create_sales_doc(
    (p - 'invoice_id' - 'restock' - 'return_reason' - 'source_id' - 'payments') || jsonb_build_object('type', 'RETURN'),
    false, null);

  update sales_docs set restock = v_restock, return_reason = p->>'return_reason', source_id = v_invoice
   where id = v_doc.id returning * into v_doc;

  -- Expired / damaged: take the stock straight back out (written off).
  if not v_restock then
    for l in select jsonb_build_object('product_id', product_id, 'qty', qty) from sales_lines where doc_id = v_doc.id loop
      perform move_stock((l->>'product_id')::bigint, v_doc.location_id, -(l->>'qty')::numeric, 'WRITE_OFF', v_doc.doc_no,
                         coalesce(p->>'return_reason', 'Return not restocked'));
    end loop;
  end if;

  -- Apply the credit to invoices.
  v_left := v_doc.total;
  for v_inv in
    select id, total - paid - credited as bal from sales_docs
     where customer_id = v_doc.customer_id and type = 'INVOICE' and status <> 'VOID' and total - paid - credited > 0.004
     order by (id = v_invoice) desc, doc_date, id
     for update
  loop
    exit when v_left <= 0.004;
    v_apply := round(least(v_left, v_inv.bal), 2);
    update sales_docs set credited = credited + v_apply, updated_at = now() where id = v_inv.id;
    insert into return_allocations (return_id, doc_id, amount) values (v_doc.id, v_inv.id, v_apply);
    v_left := v_left - v_apply;
  end loop;

  return v_doc;
end $$;

-- Void now understands write-off returns and return allocations.
create or replace function void_sales_doc(p_id bigint, p_reason text default null) returns sales_docs
language plpgsql security definer set search_path = public as $$
declare v_doc sales_docs%rowtype; v_src sales_docs%rowtype; v_children text; v_sign int; l record; a record; v_has_alloc boolean;
begin
  perform assert_can('void_docs');
  select * into v_doc from sales_docs where id = p_id for update;
  if not found then raise exception 'Document not found'; end if;
  if v_doc.status = 'VOID' then raise exception 'Already void'; end if;
  select string_agg(doc_no, ', ') into v_children from sales_docs where source_id = p_id and status <> 'VOID';
  if v_children is not null then raise exception 'Void the linked documents first: %', v_children; end if;
  if v_doc.type = 'INVOICE' and (v_doc.paid > 0 or v_doc.credited > 0) then
    raise exception 'This invoice has payments or returns. Void those first.';
  end if;

  -- Stock: invoices put stock back; returns take it out again (unless it was written off).
  v_sign := case when v_doc.type = 'INVOICE' then 1
                 when v_doc.type = 'RETURN' and v_doc.restock then -1
                 else 0 end;
  if v_sign <> 0 then
    for l in select product_id, qty from sales_lines where doc_id = p_id loop
      perform move_stock(l.product_id, v_doc.location_id, v_sign * l.qty, 'VOID', v_doc.doc_no, p_reason);
    end loop;
  end if;

  v_has_alloc := exists (select 1 from return_allocations where return_id = p_id);
  if v_has_alloc then
    for a in select doc_id, amount from return_allocations where return_id = p_id loop
      update sales_docs set credited = greatest(credited - a.amount, 0), updated_at = now() where id = a.doc_id;
    end loop;
    delete from return_allocations where return_id = p_id;
  end if;

  if v_doc.source_id is not null then
    select * into v_src from sales_docs where id = v_doc.source_id for update;
    if v_src.status = 'CONVERTED' then update sales_docs set status = 'OPEN' where id = v_src.id; end if;
    if v_doc.type = 'RETURN' and v_src.type = 'INVOICE' and not v_has_alloc then   -- older returns (before file 10)
      update sales_docs set credited = greatest(credited - v_doc.total, 0) where id = v_src.id;
    end if;
  end if;

  update sales_docs set status = 'VOID', void_reason = p_reason, updated_at = now() where id = p_id returning * into v_doc;
  return v_doc;
end $$;

-- ---------- Reports ----------
/** Customer outstanding as of a date, optionally for one salesman / area. */
create or replace function report_customer_outstanding(p_as_of date default current_date, p_salesman uuid default null, p_area bigint default null)
returns table (customer_id bigint, code text, name text, phone text, area text, salesman text,
               invoiced numeric, returned numeric, received numeric, balance numeric, overdue numeric, oldest_due date)
language sql stable security definer set search_path = public as $$
  with inv as (
    select customer_id,
           sum(total) filter (where type = 'INVOICE') as invoiced,
           sum(total) filter (where type = 'RETURN') as returned
    from sales_docs
    where type in ('INVOICE','RETURN') and status <> 'VOID' and customer_id is not null and doc_date::date <= p_as_of
    group by customer_id
  ), rec as (
    select customer_id, sum(amount) as received from receipts
    where status = 'ACTIVE' and customer_id is not null and receipt_date::date <= p_as_of group by customer_id
  ), due as (
    select customer_id, sum(total - paid - credited) as overdue, min(due_date) as oldest_due
    from sales_docs
    where type = 'INVOICE' and status <> 'VOID' and total - paid - credited > 0.004 and due_date < p_as_of
    group by customer_id
  )
  select c.id, c.code, c.name, c.phone, a.name, pr.full_name,
         coalesce(inv.invoiced, 0), coalesce(inv.returned, 0), coalesce(rec.received, 0),
         coalesce(inv.invoiced, 0) - coalesce(inv.returned, 0) - coalesce(rec.received, 0),
         coalesce(due.overdue, 0), due.oldest_due
  from customers c
  left join inv on inv.customer_id = c.id
  left join rec on rec.customer_id = c.id
  left join due on due.customer_id = c.id
  left join areas a on a.id = c.area_id
  left join profiles pr on pr.id = c.salesman_id
  where is_active_user()
    and (p_salesman is null or c.salesman_id = p_salesman)
    and (p_area is null or c.area_id = p_area)
    and abs(coalesce(inv.invoiced, 0) - coalesce(inv.returned, 0) - coalesce(rec.received, 0)) > 0.004
  order by 10 desc
$$;

-- Privileges for the new functions.
revoke execute on function customer_outstanding(bigint, date) from public, anon;
revoke execute on function create_sales_return(jsonb) from public, anon;
revoke execute on function report_customer_outstanding(date, uuid, bigint) from public, anon;
grant execute on function customer_outstanding(bigint, date) to authenticated;
grant execute on function create_sales_return(jsonb) to authenticated;
grant execute on function report_customer_outstanding(date, uuid, bigint) to authenticated;
grant execute on function void_sales_doc(bigint, text) to authenticated;

notify pgrst, 'reload schema';
