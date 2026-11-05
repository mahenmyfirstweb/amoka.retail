-- =====================================================================
-- amoka.retail ERP & POS  |  03 - SECURITY (Row Level Security + permissions)
-- Rules:
--  * Only signed-in, ACTIVE users can read anything.
--  * Master data is edited directly (policies below check the role permission matrix).
--  * Documents, stock and money are NEVER written directly: only through the functions in 02.
--  * Salesmen only see their own sales documents and receipts.
-- =====================================================================

-- ---------- Default permission matrix (edit later from the Users > Roles screen) ----------
insert into role_permissions (area, role)
select a.area, r.role
from (values
  ('settings',        array['ADMIN']),
  ('users',           array['ADMIN']),
  ('masters',         array['ADMIN','ACCOUNTS','MANAGER']),
  ('products',        array['ADMIN','MANAGER','STOREKEEPER']),
  ('prices',          array['ADMIN','ACCOUNTS','MANAGER']),
  ('customers',       array['ADMIN','ACCOUNTS','MANAGER','CASHIER','SALESMAN']),
  ('suppliers',       array['ADMIN','ACCOUNTS','MANAGER','STOREKEEPER']),
  ('stock',           array['ADMIN','MANAGER','STOREKEEPER']),
  ('pos',             array['ADMIN','MANAGER','CASHIER']),
  ('sales_quote',     array['ADMIN','ACCOUNTS','MANAGER','SALESMAN']),
  ('sales_order',     array['ADMIN','ACCOUNTS','MANAGER','SALESMAN']),
  ('sales_invoice',   array['ADMIN','ACCOUNTS','MANAGER','CASHIER','SALESMAN']),
  ('sales_delivery',  array['ADMIN','ACCOUNTS','MANAGER','STOREKEEPER','SALESMAN']),
  ('sales_return',    array['ADMIN','ACCOUNTS','MANAGER','CASHIER','SALESMAN']),
  ('receipts',        array['ADMIN','ACCOUNTS','MANAGER','CASHIER','SALESMAN']),
  ('purchase',        array['ADMIN','ACCOUNTS','MANAGER','STOREKEEPER']),
  ('payments',        array['ADMIN','ACCOUNTS','MANAGER']),
  ('vouchers',        array['ADMIN','ACCOUNTS']),
  ('opening_balance', array['ADMIN','ACCOUNTS']),
  ('void_docs',       array['ADMIN','ACCOUNTS','MANAGER']),
  ('reports',         array['ADMIN','ACCOUNTS','MANAGER']),
  ('web_portal',      array['ADMIN','ACCOUNTS','MANAGER','CASHIER','STOREKEEPER']),
  ('mobile_app',      array['ADMIN','MANAGER','SALESMAN'])
) as a(area, roles)
cross join lateral unnest(a.roles) as r(role)
on conflict do nothing;

-- ---------- Enable RLS everywhere + read policy for active users ----------
do $$
declare t text;
begin
  foreach t in array array[
    'settings','locations','profiles','role_permissions','doc_sequences','currencies','taxes','terms','areas','banks',
    'paymodes','customer_groups','categories','brands','uoms','products','product_images','price_changes','bins',
    'customers','suppliers','customer_prices','supplier_prices','stocks','stock_movements','stock_requests',
    'stock_request_lines','stock_transfers','stock_transfer_lines','stock_adjustments','stock_adjustment_lines',
    'sales_docs','sales_lines','cash_sessions','cash_movements','held_carts','receipts','receipt_allocations',
    'purchase_docs','purchase_lines','supplier_payments','payment_allocations','accounts','vouchers','voucher_lines',
    'opening_balances']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "read_active" on %I', t);
  end loop;

  -- Plain read for everything except the salesman-restricted tables.
  foreach t in array array[
    'settings','locations','profiles','role_permissions','currencies','taxes','terms','areas','banks',
    'paymodes','customer_groups','categories','brands','uoms','products','product_images','bins',
    'customers','suppliers','customer_prices','stocks','stock_requests','stock_request_lines',
    'stock_transfers','stock_transfer_lines','held_carts']
  loop
    execute format('create policy "read_active" on %I for select to authenticated using (is_active_user())', t);
  end loop;

  -- Back-office only tables (not visible to salesmen / cashiers).
  foreach t in array array[
    'price_changes','supplier_prices','stock_movements','stock_adjustments','stock_adjustment_lines',
    'purchase_docs','purchase_lines','supplier_payments','payment_allocations','accounts','vouchers','voucher_lines',
    'opening_balances','cash_sessions','cash_movements','doc_sequences']
  loop
    execute format(
      'create policy "read_active" on %I for select to authenticated using (is_active_user() and app_role() not in (''SALESMAN''))', t);
  end loop;
end $$;

-- Cashiers see their own cash sessions; others with POS rights see all.
drop policy if exists "read_active" on cash_sessions;
create policy "read_active" on cash_sessions for select to authenticated
  using (is_active_user() and (app_role() in ('ADMIN','ACCOUNTS','MANAGER') or user_id = auth.uid()));

-- Sales documents: salesmen see only their own.
create policy "read_active" on sales_docs for select to authenticated
  using (is_active_user() and (app_role() <> 'SALESMAN' or user_id = auth.uid()));
create policy "read_active" on sales_lines for select to authenticated
  using (exists (select 1 from sales_docs d where d.id = doc_id));     -- inherits sales_docs policy
create policy "read_active" on receipts for select to authenticated
  using (is_active_user() and (app_role() <> 'SALESMAN' or user_id = auth.uid()));
create policy "read_active" on receipt_allocations for select to authenticated
  using (exists (select 1 from receipts r where r.id = receipt_id));

-- ---------- Write policies for master data ----------
do $$
declare
  rec record;
begin
  for rec in select * from (values
    ('locations','masters'), ('currencies','masters'), ('taxes','masters'), ('terms','masters'), ('areas','masters'),
    ('banks','masters'), ('paymodes','masters'), ('customer_groups','masters'), ('accounts','vouchers'),
    ('categories','products'), ('brands','products'), ('uoms','products'), ('products','products'),
    ('product_images','products'), ('bins','stock'),
    ('customers','customers'), ('suppliers','suppliers'),
    ('customer_prices','prices'), ('supplier_prices','prices')
  ) as x(tbl, area)
  loop
    execute format('drop policy if exists "insert_perm" on %I', rec.tbl);
    execute format('drop policy if exists "update_perm" on %I', rec.tbl);
    execute format('create policy "insert_perm" on %I for insert to authenticated with check (can(%L))', rec.tbl, rec.area);
    execute format('create policy "update_perm" on %I for update to authenticated using (can(%L)) with check (can(%L))',
                   rec.tbl, rec.area, rec.area);
  end loop;
  -- Price lists and images can also be deleted.
  for rec in select * from (values ('customer_prices','prices'), ('supplier_prices','prices'), ('product_images','products')) as x(tbl, area)
  loop
    execute format('drop policy if exists "delete_perm" on %I', rec.tbl);
    execute format('create policy "delete_perm" on %I for delete to authenticated using (can(%L))', rec.tbl, rec.area);
  end loop;
end $$;

-- Settings & users & role matrix: admin only.
drop policy if exists "update_perm" on settings;
create policy "update_perm" on settings for update to authenticated using (can('settings')) with check (can('settings'));

drop policy if exists "update_perm" on profiles;
create policy "update_perm" on profiles for update to authenticated using (can('users')) with check (can('users'));

drop policy if exists "insert_perm" on role_permissions;
drop policy if exists "delete_perm" on role_permissions;
create policy "insert_perm" on role_permissions for insert to authenticated with check (can('users'));
create policy "delete_perm" on role_permissions for delete to authenticated using (can('users'));

-- Held POS carts: cashier manages own carts.
drop policy if exists "insert_perm" on held_carts;
drop policy if exists "delete_perm" on held_carts;
create policy "insert_perm" on held_carts for insert to authenticated with check (can('pos') and user_id = auth.uid());
create policy "delete_perm" on held_carts for delete to authenticated using (can('pos'));

-- ---------- Function privileges ----------
-- Internal helpers must never be called directly from the apps.
revoke execute on function move_stock(bigint, bigint, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function next_doc_no(text) from public, anon, authenticated;
revoke execute on function create_sales_doc(jsonb, boolean, bigint) from public, anon;
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function trg_price_change() from public, anon, authenticated;

-- create_sales_doc: apps may only call the public 1-argument form (POS goes through pos_checkout).
create or replace function create_sales_document(p jsonb) returns sales_docs
language sql security definer set search_path = public as $$
  select create_sales_doc(p, false, null)
$$;
revoke execute on function create_sales_doc(jsonb, boolean, bigint) from authenticated;

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
