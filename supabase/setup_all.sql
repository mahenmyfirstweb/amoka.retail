-- =====================================================================
-- amoka.retail ERP & POS - COMPLETE SUPABASE SETUP (generated from supabase/migrations)
-- Paste this whole file into Supabase SQL Editor and click Run.
-- =====================================================================

-- =====================================================================
-- amoka.retail ERP & POS  |  01 - TABLES
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Order: 01_tables -> 02_functions -> 03_security -> 04_seed
-- =====================================================================

-- ---------- Company & security ----------

create table if not exists settings (
  id              int primary key default 1 check (id = 1),
  company_name    text not null,
  address         text,
  phone           text,
  email           text,
  website         text,
  tax_reg_no      text,
  currency        text not null default 'SGD',
  tax_name        text not null default 'GST',
  tax_rate        numeric(5,2) not null default 9,
  tax_inclusive   boolean not null default false,
  receipt_footer  text,
  invoice_terms   text,
  logo_url        text,
  updated_at      timestamptz not null default now()
);

create table if not exists locations (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  address     text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Roles: ADMIN | ACCOUNTS | MANAGER | CASHIER | SALESMAN | STOREKEEPER
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique,
  full_name    text not null default '',
  phone        text,
  role         text not null default 'SALESMAN'
               check (role in ('ADMIN','ACCOUNTS','MANAGER','CASHIER','SALESMAN','STOREKEEPER')),
  location_id  bigint references locations(id),
  is_active    boolean not null default false,   -- an admin must activate new users
  created_at   timestamptz not null default now()
);

-- Editable permission matrix (like "User Roles"): which role may write in which area.
create table if not exists role_permissions (
  area  text not null,
  role  text not null,
  primary key (area, role)
);

create table if not exists doc_sequences (
  key      text primary key,
  prefix   text not null,
  next_no  bigint not null default 1
);

-- ---------- General masters ----------

create table if not exists currencies (
  code       text primary key,
  name       text not null,
  rate       numeric(14,6) not null default 1,
  is_active  boolean not null default true
);

create table if not exists taxes (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  rate       numeric(5,2) not null default 0,
  is_active  boolean not null default true
);

create table if not exists terms (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  days       int not null default 0,
  is_active  boolean not null default true
);

create table if not exists areas (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true
);

create table if not exists banks (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  account_no  text,
  branch      text,
  is_active   boolean not null default true
);

create table if not exists paymodes (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  is_cash     boolean not null default false,
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

create table if not exists customer_groups (
  id            bigint generated always as identity primary key,
  code          text not null unique,
  name          text not null,
  discount_pct  numeric(5,2) not null default 0,
  is_active     boolean not null default true
);

-- ---------- Products ----------

create table if not exists categories (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  parent_id  bigint references categories(id),   -- set = sub category
  is_active  boolean not null default true
);

create table if not exists brands (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true
);

create table if not exists uoms (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true
);

create table if not exists products (
  id               bigint generated always as identity primary key,
  code             text not null unique,
  barcode          text unique,
  name             text not null,
  description      text,
  category_id      bigint references categories(id),
  brand_id         bigint references brands(id),
  uom_id           bigint references uoms(id),
  pcs_per_carton   numeric(14,3) not null default 1,
  cost_price       numeric(14,2) not null default 0,
  sell_price       numeric(14,2) not null default 0,
  wholesale_price  numeric(14,2) not null default 0,
  min_stock        numeric(14,3) not null default 0,
  taxable          boolean not null default true,
  track_stock      boolean not null default true,
  image_url        text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists products_name_idx on products (name);

create table if not exists product_images (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products(id) on delete cascade,
  url         text not null,
  sort_order  int not null default 0
);

create table if not exists price_changes (
  id              bigint generated always as identity primary key,
  product_id      bigint not null references products(id),
  old_sell_price  numeric(14,2) not null,
  new_sell_price  numeric(14,2) not null,
  old_cost_price  numeric(14,2) not null,
  new_cost_price  numeric(14,2) not null,
  user_id         uuid,
  created_at      timestamptz not null default now()
);

create table if not exists bins (
  id           bigint generated always as identity primary key,
  location_id  bigint not null references locations(id),
  code         text not null,
  name         text,
  is_active    boolean not null default true,
  unique (location_id, code)
);

-- ---------- Customers & suppliers ----------

create table if not exists customers (
  id                bigint generated always as identity primary key,
  code              text not null unique,
  name              text not null,
  contact_person    text,
  phone             text,
  email             text,
  address           text,
  delivery_address  text,
  tax_reg_no        text,
  group_id          bigint references customer_groups(id),
  area_id           bigint references areas(id),
  salesman_id       uuid references profiles(id),
  currency_code     text references currencies(code),
  terms_days        int not null default 0,
  credit_limit      numeric(14,2) not null default 0,
  latitude          numeric(10,7),
  longitude         numeric(10,7),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists customers_name_idx on customers (name);

create table if not exists suppliers (
  id              bigint generated always as identity primary key,
  code            text not null unique,
  name            text not null,
  contact_person  text,
  phone           text,
  email           text,
  address         text,
  tax_reg_no      text,
  currency_code   text references currencies(code),
  terms_days      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists customer_prices (
  id           bigint generated always as identity primary key,
  customer_id  bigint not null references customers(id) on delete cascade,
  product_id   bigint not null references products(id) on delete cascade,
  price        numeric(14,2) not null,
  unique (customer_id, product_id)
);

create table if not exists supplier_prices (
  id           bigint generated always as identity primary key,
  supplier_id  bigint not null references suppliers(id) on delete cascade,
  product_id   bigint not null references products(id) on delete cascade,
  price        numeric(14,2) not null,
  unique (supplier_id, product_id)
);

-- ---------- Stock ----------

create table if not exists stocks (
  product_id   bigint not null references products(id),
  location_id  bigint not null references locations(id),
  qty          numeric(14,3) not null default 0,
  primary key (product_id, location_id)
);

-- type: SALE | SALE_RETURN | GRN | PURCHASE_RETURN | TRANSFER_IN | TRANSFER_OUT | ADJUST | STOCKTAKE | VOID
create table if not exists stock_movements (
  id           bigint generated always as identity primary key,
  product_id   bigint not null references products(id),
  location_id  bigint not null references locations(id),
  qty          numeric(14,3) not null,
  balance      numeric(14,3) not null,
  type         text not null,
  ref_no       text,
  note         text,
  user_id      uuid,
  created_at   timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on stock_movements (product_id, location_id);

-- status: OPEN | APPROVED | TRANSFERRED | REJECTED
create table if not exists stock_requests (
  id                bigint generated always as identity primary key,
  doc_no            text not null unique,
  doc_date          timestamptz not null default now(),
  from_location_id  bigint not null references locations(id),  -- location that will send stock
  to_location_id    bigint not null references locations(id),  -- location that needs stock
  status            text not null default 'OPEN',
  notes             text,
  user_id           uuid,
  transfer_id       bigint,
  created_at        timestamptz not null default now()
);

create table if not exists stock_request_lines (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references stock_requests(id) on delete cascade,
  product_id  bigint not null references products(id),
  qty         numeric(14,3) not null check (qty > 0)
);

create table if not exists stock_transfers (
  id                bigint generated always as identity primary key,
  doc_no            text not null unique,
  doc_date          timestamptz not null default now(),
  from_location_id  bigint not null references locations(id),
  to_location_id    bigint not null references locations(id),
  status            text not null default 'COMPLETED',
  request_id        bigint references stock_requests(id),
  notes             text,
  user_id           uuid,
  created_at        timestamptz not null default now()
);

create table if not exists stock_transfer_lines (
  id           bigint generated always as identity primary key,
  transfer_id  bigint not null references stock_transfers(id) on delete cascade,
  product_id   bigint not null references products(id),
  qty          numeric(14,3) not null check (qty > 0)
);

-- type: ADJUST (enter +/- qty) | STOCKTAKE (enter counted qty)
create table if not exists stock_adjustments (
  id           bigint generated always as identity primary key,
  doc_no       text not null unique,
  type         text not null check (type in ('ADJUST','STOCKTAKE')),
  doc_date     timestamptz not null default now(),
  location_id  bigint not null references locations(id),
  reason       text,
  notes        text,
  status       text not null default 'COMPLETED',
  user_id      uuid,
  created_at   timestamptz not null default now()
);

create table if not exists stock_adjustment_lines (
  id             bigint generated always as identity primary key,
  adjustment_id  bigint not null references stock_adjustments(id) on delete cascade,
  product_id     bigint not null references products(id),
  system_qty     numeric(14,3) not null,
  counted_qty    numeric(14,3),
  qty            numeric(14,3) not null
);

-- ---------- Sales ----------

-- type: QUOTE | ORDER | INVOICE | DELIVERY | RETURN
-- status: OPEN | CONVERTED | VOID   (invoice payment state = total - paid - credited)
create table if not exists sales_docs (
  id             bigint generated always as identity primary key,
  doc_no         text not null unique,
  type           text not null check (type in ('QUOTE','ORDER','INVOICE','DELIVERY','RETURN')),
  status         text not null default 'OPEN',
  doc_date       timestamptz not null default now(),
  due_date       date,
  customer_id    bigint references customers(id),
  location_id    bigint not null references locations(id),
  user_id        uuid not null references profiles(id),
  source_id      bigint references sales_docs(id),
  ref_no         text,
  notes          text,
  subtotal       numeric(14,2) not null default 0,
  discount       numeric(14,2) not null default 0,
  tax            numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  paid           numeric(14,2) not null default 0,
  credited       numeric(14,2) not null default 0,
  is_pos         boolean not null default false,
  signature_url  text,
  void_reason    text,
  client_ref     text unique,   -- idempotency key from the mobile app (offline sync)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sales_docs_type_date_idx on sales_docs (type, doc_date desc);
create index if not exists sales_docs_customer_idx on sales_docs (customer_id);
create index if not exists sales_docs_user_idx on sales_docs (user_id);

create table if not exists sales_lines (
  id           bigint generated always as identity primary key,
  doc_id       bigint not null references sales_docs(id) on delete cascade,
  line_no      int not null default 0,
  product_id   bigint not null references products(id),
  description  text not null,
  qty          numeric(14,3) not null,
  price        numeric(14,2) not null,
  discount     numeric(14,2) not null default 0,
  tax_rate     numeric(5,2) not null default 0,
  line_total   numeric(14,2) not null,
  cost         numeric(14,2) not null default 0
);
create index if not exists sales_lines_doc_idx on sales_lines (doc_id);

-- ---------- POS ----------

create table if not exists cash_sessions (
  id             bigint generated always as identity primary key,
  location_id    bigint not null references locations(id),
  user_id        uuid not null references profiles(id),
  status         text not null default 'OPEN',
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  opening_float  numeric(14,2) not null default 0,
  expected_cash  numeric(14,2),
  counted_cash   numeric(14,2),
  notes          text
);

create table if not exists cash_movements (
  id          bigint generated always as identity primary key,
  session_id  bigint not null references cash_sessions(id),
  type        text not null check (type in ('IN','OUT')),
  amount      numeric(14,2) not null check (amount > 0),
  reason      text not null,
  user_id     uuid,
  created_at  timestamptz not null default now()
);

create table if not exists held_carts (
  id           bigint generated always as identity primary key,
  location_id  bigint not null references locations(id),
  user_id      uuid not null references profiles(id),
  label        text not null,
  customer_id  bigint references customers(id),
  data         jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- ---------- Receipts (customer payments) ----------

create table if not exists receipts (
  id           bigint generated always as identity primary key,
  receipt_no   text not null unique,
  receipt_date timestamptz not null default now(),
  customer_id  bigint references customers(id),
  location_id  bigint not null references locations(id),
  user_id      uuid not null references profiles(id),
  paymode_id   bigint not null references paymodes(id),
  bank_id      bigint references banks(id),
  amount       numeric(14,2) not null check (amount > 0),
  reference    text,
  cheque_no    text,
  cheque_date  date,
  notes        text,
  status       text not null default 'ACTIVE',
  session_id   bigint references cash_sessions(id),
  created_at   timestamptz not null default now()
);

create table if not exists receipt_allocations (
  id          bigint generated always as identity primary key,
  receipt_id  bigint not null references receipts(id) on delete cascade,
  doc_id      bigint not null references sales_docs(id),
  amount      numeric(14,2) not null check (amount > 0)
);

-- ---------- Purchase ----------

-- type: QUOTE | ORDER | GRN | RETURN
create table if not exists purchase_docs (
  id           bigint generated always as identity primary key,
  doc_no       text not null unique,
  type         text not null check (type in ('QUOTE','ORDER','GRN','RETURN')),
  status       text not null default 'OPEN',
  doc_date     timestamptz not null default now(),
  due_date     date,
  supplier_id  bigint not null references suppliers(id),
  location_id  bigint not null references locations(id),
  user_id      uuid not null references profiles(id),
  source_id    bigint references purchase_docs(id),
  ref_no       text,       -- supplier invoice / DO number
  notes        text,
  subtotal     numeric(14,2) not null default 0,
  discount     numeric(14,2) not null default 0,
  tax          numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  paid         numeric(14,2) not null default 0,
  credited     numeric(14,2) not null default 0,
  void_reason  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists purchase_docs_type_date_idx on purchase_docs (type, doc_date desc);

create table if not exists purchase_lines (
  id           bigint generated always as identity primary key,
  doc_id       bigint not null references purchase_docs(id) on delete cascade,
  line_no      int not null default 0,
  product_id   bigint not null references products(id),
  description  text not null,
  qty          numeric(14,3) not null,
  price        numeric(14,2) not null,
  discount     numeric(14,2) not null default 0,
  tax_rate     numeric(5,2) not null default 0,
  line_total   numeric(14,2) not null,
  cost         numeric(14,2) not null default 0
);
create index if not exists purchase_lines_doc_idx on purchase_lines (doc_id);

create table if not exists supplier_payments (
  id            bigint generated always as identity primary key,
  payment_no    text not null unique,
  payment_date  timestamptz not null default now(),
  supplier_id   bigint not null references suppliers(id),
  paymode_id    bigint not null references paymodes(id),
  bank_id       bigint references banks(id),
  amount        numeric(14,2) not null check (amount > 0),
  reference     text,
  cheque_no     text,
  cheque_date   date,
  notes         text,
  status        text not null default 'ACTIVE',
  user_id       uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);

create table if not exists payment_allocations (
  id          bigint generated always as identity primary key,
  payment_id  bigint not null references supplier_payments(id) on delete cascade,
  doc_id      bigint not null references purchase_docs(id),
  amount      numeric(14,2) not null check (amount > 0)
);

-- ---------- Accounting ----------

-- type: ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
create table if not exists accounts (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  type       text not null check (type in ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  parent_id  bigint references accounts(id),
  is_active  boolean not null default true
);

-- type: PAYMENT | RECEIPT | EXPENSE
create table if not exists vouchers (
  id            bigint generated always as identity primary key,
  voucher_no    text not null unique,
  type          text not null check (type in ('PAYMENT','RECEIPT','EXPENSE')),
  voucher_date  timestamptz not null default now(),
  paymode_id    bigint references paymodes(id),
  bank_id       bigint references banks(id),
  party_name    text,
  reference     text,
  cheque_no     text,
  notes         text,
  amount        numeric(14,2) not null default 0,
  status        text not null default 'ACTIVE',
  user_id       uuid references profiles(id),
  created_at    timestamptz not null default now()
);

create table if not exists voucher_lines (
  id           bigint generated always as identity primary key,
  voucher_id   bigint not null references vouchers(id) on delete cascade,
  account_id   bigint not null references accounts(id),
  description  text,
  amount       numeric(14,2) not null check (amount > 0)
);

-- ---------- Opening balances (customer / supplier) ----------

create table if not exists opening_balances (
  id           bigint generated always as identity primary key,
  party_type   text not null check (party_type in ('CUSTOMER','SUPPLIER')),
  party_id     bigint not null,
  amount       numeric(14,2) not null,
  as_of        date not null default current_date,
  doc_id       bigint,   -- invoice / GRN created to carry the balance
  user_id      uuid,
  created_at   timestamptz not null default now()
);

-- =====================================================================
-- amoka.retail ERP & POS  |  02 - BUSINESS FUNCTIONS
-- All stock / money changes happen inside these functions (one DB transaction each).
-- The apps call them with supabase.rpc('function_name', { p: {...} }).
-- =====================================================================

-- ---------- Helpers ----------

create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function app_location() returns bigint
language sql stable security definer set search_path = public as $$
  select location_id from profiles where id = auth.uid() and is_active
$$;

create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active)
$$;

/** true when the current user's role may write in the given area. */
create or replace function can(p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from role_permissions rp
    where rp.area = p_area and rp.role = app_role()
  )
$$;

create or replace function assert_can(p_area text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not can(p_area) then
    raise exception 'You do not have permission for this action (%)', p_area using errcode = '42501';
  end if;
end $$;

create or replace function my_permissions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(area order by area), '{}') from role_permissions where role = app_role()
$$;

create or replace function next_doc_no(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_no bigint;
begin
  update doc_sequences set next_no = next_no + 1 where key = p_key
    returning prefix, next_no - 1 into v_prefix, v_no;
  if v_prefix is null then
    insert into doc_sequences (key, prefix, next_no) values (p_key, p_key, 2)
      on conflict (key) do update set next_no = doc_sequences.next_no + 1
      returning prefix, next_no - 1 into v_prefix, v_no;
  end if;
  return v_prefix || '-' || lpad(v_no::text, 6, '0');
end $$;

/** Changes stock for a product at a location and writes a movement row. */
create or replace function move_stock(
  p_product bigint, p_location bigint, p_qty numeric, p_type text,
  p_ref text default null, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_balance numeric;
begin
  if p_qty = 0 then return; end if;
  if not exists (select 1 from products where id = p_product and track_stock) then return; end if;
  insert into stocks (product_id, location_id, qty) values (p_product, p_location, p_qty)
    on conflict (product_id, location_id) do update set qty = stocks.qty + excluded.qty
    returning qty into v_balance;
  insert into stock_movements (product_id, location_id, qty, balance, type, ref_no, note, user_id)
    values (p_product, p_location, p_qty, v_balance, p_type, p_ref, p_note, auth.uid());
end $$;

create or replace function stock_qty(p_product bigint, p_location bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select qty from stocks where product_id = p_product and location_id = p_location), 0)
$$;

/**
 * Prices lines and computes document totals.
 * p_lines: [{product_id, description?, qty, price, discount?}]
 * Returns {lines:[...enriched], subtotal, discount, tax, total}
 * Doc discount is spread proportionally before tax.
 */
create or replace function calc_doc(p_lines jsonb, p_discount numeric, p_tax_inclusive boolean)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rate numeric := (select tax_rate from settings where id = 1);
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
      'line_no', i,
      'product_id', p.id,
      'description', coalesce(nullif(l->>'description', ''), p.name),
      'qty', (l->>'qty')::numeric,
      'price', (l->>'price')::numeric,
      'discount', round(coalesce((l->>'discount')::numeric, 0), 2),
      'tax_rate', v_lr,
      'line_total', v_lt,
      'cost', p.cost_price);
  end loop;

  v_disc := round(least(greatest(coalesce(p_discount, 0), 0), greatest(v_gross, 0)), 2);
  v_ratio := case when v_gross = 0 then 1 else (v_gross - v_disc) / v_gross end;
  select coalesce(sum(case when p_tax_inclusive
           then (x->>'line_total')::numeric * v_ratio * (x->>'tax_rate')::numeric / (100 + (x->>'tax_rate')::numeric)
           else (x->>'line_total')::numeric * v_ratio * (x->>'tax_rate')::numeric / 100 end), 0)
    into v_tax from jsonb_array_elements(v_lines) x;
  v_tax := round(v_tax, 2);
  v_net := round(v_gross - v_disc, 2);
  return jsonb_build_object(
    'lines', v_lines,
    'discount', v_disc,
    'tax', v_tax,
    'subtotal', case when p_tax_inclusive then v_net - v_tax else v_net end,
    'total', case when p_tax_inclusive then v_net else v_net + v_tax end);
end $$;

/** Selling price for a customer: customer special price, else group discount, else sell price. */
create or replace function get_price(p_product bigint, p_customer bigint default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select cp.price from customer_prices cp where cp.customer_id = p_customer and cp.product_id = p_product),
    (select round(p.sell_price * (1 - coalesce(g.discount_pct, 0) / 100), 2)
       from products p
       left join customers c on c.id = p_customer
       left join customer_groups g on g.id = c.group_id
      where p.id = p_product))
$$;

-- =====================================================================
-- SALES
-- =====================================================================

create or replace function sales_area(p_type text) returns text
language sql immutable as $$
  select case p_type
    when 'QUOTE' then 'sales_quote' when 'ORDER' then 'sales_order'
    when 'INVOICE' then 'sales_invoice' when 'DELIVERY' then 'sales_delivery'
    when 'RETURN' then 'sales_return' end
$$;

create or replace function sales_can_convert(p_from text, p_to text) returns boolean
language sql immutable as $$
  select (p_from, p_to) in (('QUOTE','ORDER'),('QUOTE','INVOICE'),('ORDER','INVOICE'),('ORDER','DELIVERY'),
                            ('INVOICE','DELIVERY'),('INVOICE','RETURN'))
$$;

/**
 * Creates a sales document.
 * p: {type, customer_id, location_id?, doc_date?, due_date?, ref_no?, notes?, discount?, source_id?,
 *     client_ref?, signature_url?, lines:[...], payments?:[{paymode_id, amount, reference?}]}
 * internal: p_pos=true + p_session for POS checkout.
 */
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

/** Edit an OPEN quote or order (invoices are never edited: void and re-issue). */
create or replace function update_sales_doc(p_id bigint, p jsonb) returns sales_docs
language plpgsql security definer set search_path = public as $$
declare v_doc sales_docs%rowtype; v_calc jsonb;
begin
  select * into v_doc from sales_docs where id = p_id for update;
  if not found then raise exception 'Document not found'; end if;
  perform assert_can(sales_area(v_doc.type));
  if v_doc.type not in ('QUOTE','ORDER') or v_doc.status <> 'OPEN' then
    raise exception 'Only open quotes and orders can be edited';
  end if;
  if app_role() = 'SALESMAN' and v_doc.user_id <> auth.uid() then raise exception 'Not your document'; end if;
  v_calc := calc_doc(p->'lines', (p->>'discount')::numeric, (select tax_inclusive from settings where id = 1));
  delete from sales_lines where doc_id = p_id;
  insert into sales_lines (doc_id, line_no, product_id, description, qty, price, discount, tax_rate, line_total, cost)
  select p_id, x.line_no, x.product_id, x.description, x.qty, x.price, x.discount, x.tax_rate, x.line_total, x.cost
  from jsonb_to_recordset(v_calc->'lines') as x(line_no int, product_id bigint, description text, qty numeric,
       price numeric, discount numeric, tax_rate numeric, line_total numeric, cost numeric);
  update sales_docs set
    customer_id = coalesce((p->>'customer_id')::bigint, customer_id),
    doc_date = coalesce((p->>'doc_date')::timestamptz, doc_date),
    due_date = case when p ? 'due_date' then (p->>'due_date')::date else due_date end,
    ref_no = p->>'ref_no', notes = p->>'notes',
    subtotal = (v_calc->>'subtotal')::numeric, discount = (v_calc->>'discount')::numeric,
    tax = (v_calc->>'tax')::numeric, total = (v_calc->>'total')::numeric, updated_at = now()
  where id = p_id returning * into v_doc;
  return v_doc;
end $$;

/** Quick convert: copies all lines into a new document of p_type. */
create or replace function convert_sales_doc(p_id bigint, p_type text) returns sales_docs
language plpgsql security definer set search_path = public as $$
declare v_src sales_docs%rowtype;
begin
  select * into v_src from sales_docs where id = p_id;
  if not found then raise exception 'Document not found'; end if;
  return create_sales_doc(jsonb_build_object(
    'type', p_type, 'customer_id', v_src.customer_id, 'location_id', v_src.location_id,
    'source_id', v_src.id, 'ref_no', v_src.ref_no, 'notes', v_src.notes, 'discount', v_src.discount,
    'lines', (select jsonb_agg(jsonb_build_object('product_id', product_id, 'description', description,
               'qty', qty, 'price', price, 'discount', discount) order by line_no)
              from sales_lines where doc_id = p_id)));
end $$;

create or replace function void_sales_doc(p_id bigint, p_reason text default null) returns sales_docs
language plpgsql security definer set search_path = public as $$
declare v_doc sales_docs%rowtype; v_src sales_docs%rowtype; v_children text; v_sign int; l record;
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

  v_sign := case v_doc.type when 'INVOICE' then 1 when 'RETURN' then -1 else 0 end;
  if v_sign <> 0 then
    for l in select product_id, qty from sales_lines where doc_id = p_id loop
      perform move_stock(l.product_id, v_doc.location_id, v_sign * l.qty, 'VOID', v_doc.doc_no, p_reason);
    end loop;
  end if;

  if v_doc.source_id is not null then
    select * into v_src from sales_docs where id = v_doc.source_id for update;
    if v_src.status = 'CONVERTED' then update sales_docs set status = 'OPEN' where id = v_src.id; end if;
    if v_doc.type = 'RETURN' and v_src.type = 'INVOICE' then
      update sales_docs set credited = greatest(credited - v_doc.total, 0) where id = v_src.id;
    end if;
  end if;

  update sales_docs set status = 'VOID', void_reason = p_reason, updated_at = now() where id = p_id returning * into v_doc;
  return v_doc;
end $$;

-- ---------- Receipts ----------

/** p: {customer_id, location_id?, paymode_id, amount, receipt_date?, bank_id?, reference?, cheque_no?, cheque_date?,
 *      notes?, session_id?, allocations:[{doc_id, amount}]} */
create or replace function create_receipt(p jsonb) returns receipts
language plpgsql security definer set search_path = public as $$
declare
  v_loc bigint := coalesce((p->>'location_id')::bigint, app_location());
  v_cust bigint := (p->>'customer_id')::bigint;
  v_amount numeric := round((p->>'amount')::numeric, 2);
  v_alloc numeric; a jsonb; v_inv sales_docs%rowtype; v_r receipts%rowtype;
begin
  if not (can('receipts') or can('pos')) then perform assert_can('receipts'); end if;
  if v_loc is null then raise exception 'Select a location'; end if;
  if coalesce(v_amount, 0) <= 0 then raise exception 'Amount must be more than 0'; end if;
  select coalesce(sum((x->>'amount')::numeric), 0) into v_alloc from jsonb_array_elements(coalesce(p->'allocations','[]')) x;
  if v_alloc - v_amount > 0.004 then raise exception 'Allocated amount is more than the receipt amount'; end if;

  for a in select * from jsonb_array_elements(coalesce(p->'allocations','[]')) loop
    select * into v_inv from sales_docs where id = (a->>'doc_id')::bigint for update;
    if not found or v_inv.type <> 'INVOICE' or v_inv.status = 'VOID' then raise exception 'Can only allocate to active invoices'; end if;
    if v_inv.customer_id is distinct from v_cust then raise exception '% belongs to another customer', v_inv.doc_no; end if;
    if (a->>'amount')::numeric - (v_inv.total - v_inv.paid - v_inv.credited) > 0.004 then
      raise exception '% outstanding is only %', v_inv.doc_no, v_inv.total - v_inv.paid - v_inv.credited;
    end if;
    update sales_docs set paid = paid + round((a->>'amount')::numeric, 2), updated_at = now() where id = v_inv.id;
  end loop;

  insert into receipts (receipt_no, receipt_date, customer_id, location_id, user_id, paymode_id, bank_id, amount,
                        reference, cheque_no, cheque_date, notes, session_id)
  values (next_doc_no('RECEIPT'), coalesce((p->>'receipt_date')::timestamptz, now()), v_cust, v_loc, auth.uid(),
          (p->>'paymode_id')::bigint, (p->>'bank_id')::bigint, v_amount, p->>'reference', p->>'cheque_no',
          (p->>'cheque_date')::date, p->>'notes', (p->>'session_id')::bigint)
  returning * into v_r;

  insert into receipt_allocations (receipt_id, doc_id, amount)
  select v_r.id, (x->>'doc_id')::bigint, round((x->>'amount')::numeric, 2)
  from jsonb_array_elements(coalesce(p->'allocations','[]')) x;
  return v_r;
end $$;

create or replace function void_receipt(p_id bigint) returns receipts
language plpgsql security definer set search_path = public as $$
declare v_r receipts%rowtype; a record;
begin
  perform assert_can('void_docs');
  select * into v_r from receipts where id = p_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  if v_r.status = 'VOID' then raise exception 'Already void'; end if;
  for a in select doc_id, amount from receipt_allocations where receipt_id = p_id loop
    update sales_docs set paid = greatest(paid - a.amount, 0), updated_at = now() where id = a.doc_id;
  end loop;
  update receipts set status = 'VOID' where id = p_id returning * into v_r;
  return v_r;
end $$;

-- =====================================================================
-- PURCHASE
-- =====================================================================

create or replace function purchase_can_convert(p_from text, p_to text) returns boolean
language sql immutable as $$
  select (p_from, p_to) in (('QUOTE','ORDER'),('ORDER','GRN'),('GRN','RETURN'))
$$;

/** p: {type, supplier_id, location_id?, doc_date?, due_date?, ref_no?, notes?, discount?, source_id?,
 *      update_cost? (default true), lines:[...]}   Purchase prices are always tax-exclusive. */
create or replace function create_purchase_doc(p jsonb) returns purchase_docs
language plpgsql security definer set search_path = public as $$
declare
  v_type text := p->>'type';
  v_loc bigint := coalesce((p->>'location_id')::bigint, app_location());
  v_sup suppliers%rowtype; v_src purchase_docs%rowtype; v_doc purchase_docs%rowtype;
  v_calc jsonb; v_no text; l jsonb; v_credit numeric;
  v_date timestamptz := coalesce((p->>'doc_date')::timestamptz, now());
  v_due date := (p->>'due_date')::date;
begin
  perform assert_can('purchase');
  if v_type not in ('QUOTE','ORDER','GRN','RETURN') then raise exception 'Invalid document type'; end if;
  if v_loc is null then raise exception 'Select a location'; end if;
  select * into v_sup from suppliers where id = (p->>'supplier_id')::bigint;
  if not found then raise exception 'Select a supplier'; end if;

  if p->>'source_id' is not null then
    select * into v_src from purchase_docs where id = (p->>'source_id')::bigint for update;
    if not found then raise exception 'Source document not found'; end if;
    if v_src.status <> 'OPEN' then raise exception '% is %', v_src.doc_no, lower(v_src.status); end if;
    if not purchase_can_convert(v_src.type, v_type) then raise exception 'Cannot create % from %', v_type, v_src.type; end if;
    if v_src.supplier_id <> v_sup.id then raise exception 'Supplier must match the source document'; end if;
  end if;

  v_calc := calc_doc(p->'lines', (p->>'discount')::numeric, false);
  if v_due is null and v_type = 'GRN' and v_sup.terms_days > 0 then
    v_due := (v_date + make_interval(days => v_sup.terms_days))::date;
  end if;

  v_no := next_doc_no('P_' || v_type);
  insert into purchase_docs (doc_no, type, doc_date, due_date, supplier_id, location_id, user_id, source_id,
                             ref_no, notes, subtotal, discount, tax, total)
  values (v_no, v_type, v_date, v_due, v_sup.id, v_loc, auth.uid(), v_src.id, p->>'ref_no', p->>'notes',
          (v_calc->>'subtotal')::numeric, (v_calc->>'discount')::numeric, (v_calc->>'tax')::numeric,
          (v_calc->>'total')::numeric)
  returning * into v_doc;

  insert into purchase_lines (doc_id, line_no, product_id, description, qty, price, discount, tax_rate, line_total, cost)
  select v_doc.id, x.line_no, x.product_id, x.description, x.qty, x.price, x.discount, x.tax_rate, x.line_total,
         round(x.line_total / x.qty, 2)
  from jsonb_to_recordset(v_calc->'lines') as x(line_no int, product_id bigint, description text, qty numeric,
       price numeric, discount numeric, tax_rate numeric, line_total numeric);

  if v_type in ('GRN','RETURN') then
    for l in select * from jsonb_array_elements(v_calc->'lines') loop
      perform move_stock((l->>'product_id')::bigint, v_loc,
                         case when v_type = 'GRN' then 1 else -1 end * (l->>'qty')::numeric,
                         case when v_type = 'GRN' then 'GRN' else 'PURCHASE_RETURN' end, v_no);
      if v_type = 'GRN' and coalesce((p->>'update_cost')::boolean, true) then
        update products set cost_price = round((l->>'line_total')::numeric / (l->>'qty')::numeric, 2), updated_at = now()
        where id = (l->>'product_id')::bigint;
      end if;
    end loop;
  end if;

  if v_src.id is not null then
    if v_src.type in ('QUOTE','ORDER') then update purchase_docs set status = 'CONVERTED' where id = v_src.id; end if;
    if v_src.type = 'GRN' and v_type = 'RETURN' then
      v_credit := least(v_doc.total, greatest(v_src.total - v_src.paid - v_src.credited, 0));
      if v_credit > 0 then update purchase_docs set credited = credited + v_credit where id = v_src.id; end if;
    end if;
  end if;
  return v_doc;
end $$;

create or replace function update_purchase_doc(p_id bigint, p jsonb) returns purchase_docs
language plpgsql security definer set search_path = public as $$
declare v_doc purchase_docs%rowtype; v_calc jsonb;
begin
  perform assert_can('purchase');
  select * into v_doc from purchase_docs where id = p_id for update;
  if not found then raise exception 'Document not found'; end if;
  if v_doc.type not in ('QUOTE','ORDER') or v_doc.status <> 'OPEN' then raise exception 'Only open quotes / orders can be edited'; end if;
  v_calc := calc_doc(p->'lines', (p->>'discount')::numeric, false);
  delete from purchase_lines where doc_id = p_id;
  insert into purchase_lines (doc_id, line_no, product_id, description, qty, price, discount, tax_rate, line_total, cost)
  select p_id, x.line_no, x.product_id, x.description, x.qty, x.price, x.discount, x.tax_rate, x.line_total,
         round(x.line_total / x.qty, 2)
  from jsonb_to_recordset(v_calc->'lines') as x(line_no int, product_id bigint, description text, qty numeric,
       price numeric, discount numeric, tax_rate numeric, line_total numeric);
  update purchase_docs set
    supplier_id = coalesce((p->>'supplier_id')::bigint, supplier_id),
    doc_date = coalesce((p->>'doc_date')::timestamptz, doc_date),
    ref_no = p->>'ref_no', notes = p->>'notes',
    subtotal = (v_calc->>'subtotal')::numeric, discount = (v_calc->>'discount')::numeric,
    tax = (v_calc->>'tax')::numeric, total = (v_calc->>'total')::numeric, updated_at = now()
  where id = p_id returning * into v_doc;
  return v_doc;
end $$;

create or replace function convert_purchase_doc(p_id bigint, p_type text) returns purchase_docs
language plpgsql security definer set search_path = public as $$
declare v_src purchase_docs%rowtype;
begin
  select * into v_src from purchase_docs where id = p_id;
  if not found then raise exception 'Document not found'; end if;
  return create_purchase_doc(jsonb_build_object(
    'type', p_type, 'supplier_id', v_src.supplier_id, 'location_id', v_src.location_id, 'source_id', v_src.id,
    'ref_no', v_src.ref_no, 'discount', v_src.discount,
    'lines', (select jsonb_agg(jsonb_build_object('product_id', product_id, 'description', description,
               'qty', qty, 'price', price, 'discount', discount) order by line_no)
              from purchase_lines where doc_id = p_id)));
end $$;

create or replace function void_purchase_doc(p_id bigint, p_reason text default null) returns purchase_docs
language plpgsql security definer set search_path = public as $$
declare v_doc purchase_docs%rowtype; v_src purchase_docs%rowtype; v_children text; l record;
begin
  perform assert_can('void_docs');
  select * into v_doc from purchase_docs where id = p_id for update;
  if not found then raise exception 'Document not found'; end if;
  if v_doc.status = 'VOID' then raise exception 'Already void'; end if;
  select string_agg(doc_no, ', ') into v_children from purchase_docs where source_id = p_id and status <> 'VOID';
  if v_children is not null then raise exception 'Void the linked documents first: %', v_children; end if;
  if v_doc.paid > 0 or v_doc.credited > 0 then raise exception 'This GRN has payments or returns. Void those first.'; end if;
  if v_doc.type in ('GRN','RETURN') then
    for l in select product_id, qty from purchase_lines where doc_id = p_id loop
      perform move_stock(l.product_id, v_doc.location_id,
                         case when v_doc.type = 'GRN' then -1 else 1 end * l.qty, 'VOID', v_doc.doc_no, p_reason);
    end loop;
  end if;
  if v_doc.source_id is not null then
    select * into v_src from purchase_docs where id = v_doc.source_id for update;
    if v_src.status = 'CONVERTED' then update purchase_docs set status = 'OPEN' where id = v_src.id; end if;
    if v_doc.type = 'RETURN' and v_src.type = 'GRN' then
      update purchase_docs set credited = greatest(credited - v_doc.total, 0) where id = v_src.id;
    end if;
  end if;
  update purchase_docs set status = 'VOID', void_reason = p_reason, updated_at = now() where id = p_id returning * into v_doc;
  return v_doc;
end $$;

/** p: {supplier_id, paymode_id, amount, payment_date?, bank_id?, reference?, cheque_no?, cheque_date?, notes?,
 *      allocations:[{doc_id, amount}]} */
create or replace function create_supplier_payment(p jsonb) returns supplier_payments
language plpgsql security definer set search_path = public as $$
declare
  v_sup bigint := (p->>'supplier_id')::bigint;
  v_amount numeric := round((p->>'amount')::numeric, 2);
  v_alloc numeric; a jsonb; v_grn purchase_docs%rowtype; v_pay supplier_payments%rowtype;
begin
  perform assert_can('payments');
  if coalesce(v_amount, 0) <= 0 then raise exception 'Amount must be more than 0'; end if;
  select coalesce(sum((x->>'amount')::numeric), 0) into v_alloc from jsonb_array_elements(coalesce(p->'allocations','[]')) x;
  if v_alloc - v_amount > 0.004 then raise exception 'Allocated amount is more than the payment amount'; end if;
  for a in select * from jsonb_array_elements(coalesce(p->'allocations','[]')) loop
    select * into v_grn from purchase_docs where id = (a->>'doc_id')::bigint for update;
    if not found or v_grn.type <> 'GRN' or v_grn.status = 'VOID' then raise exception 'Can only allocate to active GRNs'; end if;
    if v_grn.supplier_id <> v_sup then raise exception '% belongs to another supplier', v_grn.doc_no; end if;
    if (a->>'amount')::numeric - (v_grn.total - v_grn.paid - v_grn.credited) > 0.004 then
      raise exception '% outstanding is only %', v_grn.doc_no, v_grn.total - v_grn.paid - v_grn.credited;
    end if;
    update purchase_docs set paid = paid + round((a->>'amount')::numeric, 2), updated_at = now() where id = v_grn.id;
  end loop;
  insert into supplier_payments (payment_no, payment_date, supplier_id, paymode_id, bank_id, amount, reference,
                                 cheque_no, cheque_date, notes, user_id)
  values (next_doc_no('PAYMENT'), coalesce((p->>'payment_date')::timestamptz, now()), v_sup, (p->>'paymode_id')::bigint,
          (p->>'bank_id')::bigint, v_amount, p->>'reference', p->>'cheque_no', (p->>'cheque_date')::date,
          p->>'notes', auth.uid())
  returning * into v_pay;
  insert into payment_allocations (payment_id, doc_id, amount)
  select v_pay.id, (x->>'doc_id')::bigint, round((x->>'amount')::numeric, 2)
  from jsonb_array_elements(coalesce(p->'allocations','[]')) x;
  return v_pay;
end $$;

create or replace function void_supplier_payment(p_id bigint) returns supplier_payments
language plpgsql security definer set search_path = public as $$
declare v_pay supplier_payments%rowtype; a record;
begin
  perform assert_can('void_docs');
  select * into v_pay from supplier_payments where id = p_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_pay.status = 'VOID' then raise exception 'Already void'; end if;
  for a in select doc_id, amount from payment_allocations where payment_id = p_id loop
    update purchase_docs set paid = greatest(paid - a.amount, 0) where id = a.doc_id;
  end loop;
  update supplier_payments set status = 'VOID' where id = p_id returning * into v_pay;
  return v_pay;
end $$;

-- =====================================================================
-- STOCK
-- =====================================================================

/** p: {type: ADJUST|STOCKTAKE, location_id?, doc_date?, reason?, notes?,
 *      lines:[{product_id, qty?}  (ADJUST: +/- change) | {product_id, counted_qty} (STOCKTAKE)]} */
create or replace function create_stock_adjustment(p jsonb) returns stock_adjustments
language plpgsql security definer set search_path = public as $$
declare
  v_type text := p->>'type';
  v_loc bigint := coalesce((p->>'location_id')::bigint, app_location());
  v_doc stock_adjustments%rowtype; v_no text; l jsonb; v_sys numeric; v_change numeric;
begin
  perform assert_can('stock');
  if v_type not in ('ADJUST','STOCKTAKE') then raise exception 'Invalid adjustment type'; end if;
  if v_loc is null then raise exception 'Select a location'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Add at least one product'; end if;
  v_no := next_doc_no(v_type);
  insert into stock_adjustments (doc_no, type, doc_date, location_id, reason, notes, user_id)
  values (v_no, v_type, coalesce((p->>'doc_date')::timestamptz, now()), v_loc, p->>'reason', p->>'notes', auth.uid())
  returning * into v_doc;
  for l in select * from jsonb_array_elements(p->'lines') loop
    v_sys := stock_qty((l->>'product_id')::bigint, v_loc);
    if v_type = 'STOCKTAKE' then
      if l->>'counted_qty' is null then raise exception 'Counted qty is required for every stock take line'; end if;
      v_change := (l->>'counted_qty')::numeric - v_sys;
    else
      v_change := coalesce((l->>'qty')::numeric, 0);
      if v_change = 0 then raise exception 'Adjustment qty cannot be zero'; end if;
    end if;
    insert into stock_adjustment_lines (adjustment_id, product_id, system_qty, counted_qty, qty)
    values (v_doc.id, (l->>'product_id')::bigint, v_sys, (l->>'counted_qty')::numeric, v_change);
    perform move_stock((l->>'product_id')::bigint, v_loc, v_change, v_type, v_no, p->>'reason');
  end loop;
  return v_doc;
end $$;

/** p: {from_location_id, to_location_id, doc_date?, notes?, request_id?, lines:[{product_id, qty}]} */
create or replace function create_stock_transfer(p jsonb) returns stock_transfers
language plpgsql security definer set search_path = public as $$
declare
  v_from bigint := (p->>'from_location_id')::bigint;
  v_to bigint := (p->>'to_location_id')::bigint;
  v_doc stock_transfers%rowtype; v_no text; l jsonb;
begin
  perform assert_can('stock');
  if v_from is null or v_to is null or v_from = v_to then raise exception 'From and To location must be different'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Add at least one product'; end if;
  v_no := next_doc_no('TRANSFER');
  insert into stock_transfers (doc_no, doc_date, from_location_id, to_location_id, request_id, notes, user_id)
  values (v_no, coalesce((p->>'doc_date')::timestamptz, now()), v_from, v_to, (p->>'request_id')::bigint, p->>'notes', auth.uid())
  returning * into v_doc;
  for l in select * from jsonb_array_elements(p->'lines') loop
    if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'Transfer qty must be more than 0'; end if;
    insert into stock_transfer_lines (transfer_id, product_id, qty) values (v_doc.id, (l->>'product_id')::bigint, (l->>'qty')::numeric);
    perform move_stock((l->>'product_id')::bigint, v_from, -(l->>'qty')::numeric, 'TRANSFER_OUT', v_no);
    perform move_stock((l->>'product_id')::bigint, v_to, (l->>'qty')::numeric, 'TRANSFER_IN', v_no);
  end loop;
  if p->>'request_id' is not null then
    update stock_requests set status = 'TRANSFERRED', transfer_id = v_doc.id where id = (p->>'request_id')::bigint;
  end if;
  return v_doc;
end $$;

/** p: {from_location_id, to_location_id, notes?, lines:[{product_id, qty}]} - any staff may request stock. */
create or replace function create_stock_request(p jsonb) returns stock_requests
language plpgsql security definer set search_path = public as $$
declare v_doc stock_requests%rowtype;
begin
  if not is_active_user() then raise exception 'Not allowed'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Add at least one product'; end if;
  insert into stock_requests (doc_no, from_location_id, to_location_id, notes, user_id)
  values (next_doc_no('STOCK_REQ'), (p->>'from_location_id')::bigint,
          coalesce((p->>'to_location_id')::bigint, app_location()), p->>'notes', auth.uid())
  returning * into v_doc;
  insert into stock_request_lines (request_id, product_id, qty)
  select v_doc.id, (x->>'product_id')::bigint, (x->>'qty')::numeric from jsonb_array_elements(p->'lines') x;
  return v_doc;
end $$;

-- =====================================================================
-- POS
-- =====================================================================

create or replace function pos_open_session(p_location bigint default null, p_float numeric default 0)
returns cash_sessions
language plpgsql security definer set search_path = public as $$
declare v_loc bigint := coalesce(p_location, app_location()); v_s cash_sessions%rowtype;
begin
  perform assert_can('pos');
  if v_loc is null then raise exception 'Select a location'; end if;
  select * into v_s from cash_sessions where user_id = auth.uid() and location_id = v_loc and status = 'OPEN';
  if found then return v_s; end if;
  insert into cash_sessions (location_id, user_id, opening_float) values (v_loc, auth.uid(), round(coalesce(p_float,0), 2))
  returning * into v_s;
  return v_s;
end $$;

create or replace function pos_cash_movement(p_session bigint, p_type text, p_amount numeric, p_reason text)
returns cash_movements
language plpgsql security definer set search_path = public as $$
declare v_m cash_movements%rowtype;
begin
  perform assert_can('pos');
  if not exists (select 1 from cash_sessions where id = p_session and status = 'OPEN') then raise exception 'Session is not open'; end if;
  insert into cash_movements (session_id, type, amount, reason, user_id)
  values (p_session, p_type, round(p_amount, 2), p_reason, auth.uid()) returning * into v_m;
  return v_m;
end $$;

create or replace function pos_session_summary(p_session bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s cash_sessions%rowtype; v_cash numeric; v_in numeric; v_out numeric;
begin
  select * into v_s from cash_sessions where id = p_session;
  if not found then raise exception 'Session not found'; end if;
  select coalesce(sum(r.amount), 0) into v_cash
    from receipts r join paymodes pm on pm.id = r.paymode_id
   where r.session_id = p_session and r.status = 'ACTIVE' and pm.is_cash;
  select coalesce(sum(amount) filter (where type = 'IN'), 0), coalesce(sum(amount) filter (where type = 'OUT'), 0)
    into v_in, v_out from cash_movements where session_id = p_session;
  return jsonb_build_object(
    'session', to_jsonb(v_s),
    'invoice_count', (select count(distinct ra.doc_id) from receipt_allocations ra join receipts r on r.id = ra.receipt_id
                       where r.session_id = p_session and r.status = 'ACTIVE'),
    'total_collected', (select coalesce(sum(amount), 0) from receipts where session_id = p_session and status = 'ACTIVE'),
    'by_paymode', (select coalesce(jsonb_agg(x), '[]') from (
                     select pm.code, pm.name, pm.is_cash, sum(r.amount) as amount, count(*) as count
                     from receipts r join paymodes pm on pm.id = r.paymode_id
                     where r.session_id = p_session and r.status = 'ACTIVE'
                     group by pm.code, pm.name, pm.is_cash order by pm.code) x),
    'movements', (select coalesce(jsonb_agg(m order by m.id), '[]') from cash_movements m where m.session_id = p_session),
    'cash_sales', v_cash, 'cash_in', v_in, 'cash_out', v_out,
    'expected_cash', v_s.opening_float + v_cash + v_in - v_out);
end $$;

create or replace function pos_close_session(p_session bigint, p_counted numeric, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sum jsonb;
begin
  perform assert_can('pos');
  if not exists (select 1 from cash_sessions where id = p_session and status = 'OPEN') then raise exception 'Session already closed'; end if;
  v_sum := pos_session_summary(p_session);
  update cash_sessions set status = 'CLOSED', closed_at = now(), expected_cash = (v_sum->>'expected_cash')::numeric,
         counted_cash = round(p_counted, 2), notes = p_notes
   where id = p_session;
  return pos_session_summary(p_session);
end $$;

/** p: {customer_id?, location_id?, discount?, notes?, lines:[...], payments:[{paymode_id, amount, reference?}], held_cart_id?}
 *  Returns {invoice, tendered, change}. Non-cash payments are applied first so cash absorbs the change. */
create or replace function pos_checkout(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_loc bigint := coalesce((p->>'location_id')::bigint, app_location());
  v_session bigint; v_payments jsonb; v_noncash numeric; v_tendered numeric; v_inv sales_docs%rowtype;
begin
  perform assert_can('pos');
  select id into v_session from cash_sessions where user_id = auth.uid() and location_id = v_loc and status = 'OPEN';
  if v_session is null then raise exception 'Open the cash register first'; end if;

  select coalesce(jsonb_agg(x.pay order by x.is_cash), '[]'),
         coalesce(sum((x.pay->>'amount')::numeric) filter (where not x.is_cash), 0),
         coalesce(sum((x.pay->>'amount')::numeric), 0)
    into v_payments, v_noncash, v_tendered
    from (select e as pay, coalesce(pm.is_cash, false) as is_cash
            from jsonb_array_elements(coalesce(p->'payments','[]')) e
            left join paymodes pm on pm.id = (e->>'paymode_id')::bigint) x;

  v_inv := create_sales_doc(
    jsonb_set(jsonb_set(p - 'held_cart_id', '{type}', '"INVOICE"'), '{payments}', v_payments)
      || jsonb_build_object('location_id', v_loc),
    true, v_session);

  if v_noncash - v_inv.total > 0.004 then raise exception 'Card/other payments cannot be more than the bill total'; end if;
  if v_tendered + 0.004 < v_inv.total and v_inv.customer_id is null then
    raise exception 'Payment is less than the total. Select a customer to put the balance on credit.';
  end if;
  if p->>'held_cart_id' is not null then delete from held_carts where id = (p->>'held_cart_id')::bigint; end if;
  return jsonb_build_object('invoice', to_jsonb(v_inv), 'tendered', v_tendered,
                            'change', greatest(v_tendered - v_inv.total, 0));
end $$;

-- =====================================================================
-- ACCOUNTING VOUCHERS & OPENING BALANCES
-- =====================================================================

/** p: {type: PAYMENT|RECEIPT|EXPENSE, voucher_date?, paymode_id?, bank_id?, party_name?, reference?, cheque_no?, notes?,
 *      lines:[{account_id, description?, amount}]} */
create or replace function create_voucher(p jsonb) returns vouchers
language plpgsql security definer set search_path = public as $$
declare v vouchers%rowtype; v_total numeric;
begin
  perform assert_can('vouchers');
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then raise exception 'Add at least one account line'; end if;
  select round(sum((x->>'amount')::numeric), 2) into v_total from jsonb_array_elements(p->'lines') x;
  if v_total <= 0 then raise exception 'Total must be more than 0'; end if;
  insert into vouchers (voucher_no, type, voucher_date, paymode_id, bank_id, party_name, reference, cheque_no, notes, amount, user_id)
  values (next_doc_no('V_' || (p->>'type')), p->>'type', coalesce((p->>'voucher_date')::timestamptz, now()),
          (p->>'paymode_id')::bigint, (p->>'bank_id')::bigint, p->>'party_name', p->>'reference', p->>'cheque_no',
          p->>'notes', v_total, auth.uid())
  returning * into v;
  insert into voucher_lines (voucher_id, account_id, description, amount)
  select v.id, (x->>'account_id')::bigint, x->>'description', round((x->>'amount')::numeric, 2)
  from jsonb_array_elements(p->'lines') x;
  return v;
end $$;

create or replace function void_voucher(p_id bigint) returns vouchers
language plpgsql security definer set search_path = public as $$
declare v vouchers%rowtype;
begin
  perform assert_can('void_docs');
  update vouchers set status = 'VOID' where id = p_id and status = 'ACTIVE' returning * into v;
  if not found then raise exception 'Voucher not found or already void'; end if;
  return v;
end $$;

/** Carries a customer/supplier balance from the old system as an invoice/GRN without lines. */
create or replace function create_opening_balance(p_party_type text, p_party_id bigint, p_amount numeric, p_as_of date)
returns opening_balances
language plpgsql security definer set search_path = public as $$
declare v_doc_id bigint; v_ob opening_balances%rowtype; v_loc bigint := coalesce(app_location(), (select min(id) from locations));
begin
  perform assert_can('opening_balance');
  if p_amount <= 0 then raise exception 'Amount must be more than 0'; end if;
  if p_party_type = 'CUSTOMER' then
    insert into sales_docs (doc_no, type, doc_date, due_date, customer_id, location_id, user_id, notes, subtotal, total)
    values (next_doc_no('INVOICE'), 'INVOICE', p_as_of, p_as_of, p_party_id, v_loc, auth.uid(), 'Opening balance', p_amount, p_amount)
    returning id into v_doc_id;
  else
    insert into purchase_docs (doc_no, type, doc_date, due_date, supplier_id, location_id, user_id, notes, subtotal, total)
    values (next_doc_no('P_GRN'), 'GRN', p_as_of, p_as_of, p_party_id, v_loc, auth.uid(), 'Opening balance', p_amount, p_amount)
    returning id into v_doc_id;
  end if;
  insert into opening_balances (party_type, party_id, amount, as_of, doc_id, user_id)
  values (p_party_type, p_party_id, p_amount, p_as_of, v_doc_id, auth.uid()) returning * into v_ob;
  return v_ob;
end $$;

-- =====================================================================
-- DASHBOARD & REPORTS
-- =====================================================================

create or replace function dashboard_summary(p_location bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := current_date;
  v_week date := date_trunc('week', current_date)::date;
  v_month date := date_trunc('month', current_date)::date;
begin
  if not is_active_user() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'sales', (select jsonb_build_object(
        'today', coalesce(sum(case when type='INVOICE' then total else -total end) filter (where doc_date >= v_today), 0),
        'week',  coalesce(sum(case when type='INVOICE' then total else -total end) filter (where doc_date >= v_week), 0),
        'month', coalesce(sum(case when type='INVOICE' then total else -total end) filter (where doc_date >= v_month), 0),
        'today_count', count(*) filter (where doc_date >= v_today and type = 'INVOICE'),
        'month_count', count(*) filter (where doc_date >= v_month and type = 'INVOICE'))
      from sales_docs where type in ('INVOICE','RETURN') and status <> 'VOID' and doc_date >= least(v_week, v_month)
        and (p_location is null or location_id = p_location)),
    'purchase_month', (select coalesce(sum(total), 0) from purchase_docs
        where type = 'GRN' and status <> 'VOID' and doc_date >= v_month and (p_location is null or location_id = p_location)),
    'receivable', (select jsonb_build_object(
        'total', coalesce(sum(total - paid - credited), 0),
        'overdue', coalesce(sum(total - paid - credited) filter (where due_date < v_today), 0))
      from sales_docs where type = 'INVOICE' and status <> 'VOID' and total - paid - credited > 0
        and (p_location is null or location_id = p_location)),
    'payable', (select coalesce(sum(total - paid - credited), 0) from purchase_docs
        where type = 'GRN' and status <> 'VOID' and total - paid - credited > 0),
    'open_orders', (select count(*) from sales_docs where type = 'ORDER' and status = 'OPEN'
        and (p_location is null or location_id = p_location)),
    'low_stock', (select coalesce(jsonb_agg(x), '[]') from (
        select p.id, p.code, p.name, p.min_stock, coalesce(sum(s.qty), 0) as qty
        from products p left join stocks s on s.product_id = p.id and (p_location is null or s.location_id = p_location)
        where p.is_active and p.track_stock
        group by p.id having coalesce(sum(s.qty), 0) <= p.min_stock
        order by coalesce(sum(s.qty), 0) - p.min_stock limit 10) x),
    'sales_by_day', (select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'total', coalesce(t.total, 0)) order by d), '[]')
        from generate_series(v_today - 29, v_today, interval '1 day') d
        left join (select doc_date::date as day, sum(total) as total from sales_docs
                    where type = 'INVOICE' and status <> 'VOID' and doc_date >= v_today - 29
                      and (p_location is null or location_id = p_location)
                    group by 1) t on t.day = d::date),
    'top_products', (select coalesce(jsonb_agg(x), '[]') from (
        select l.product_id, max(l.description) as name, sum(l.qty) as qty, sum(l.line_total) as amount
        from sales_lines l join sales_docs d on d.id = l.doc_id
        where d.type = 'INVOICE' and d.status <> 'VOID' and d.doc_date >= v_month
          and (p_location is null or d.location_id = p_location)
        group by l.product_id order by sum(l.line_total) desc limit 8) x),
    'top_salesmen', (select coalesce(jsonb_agg(x), '[]') from (
        select pr.full_name as name, count(*) as count, sum(d.total) as amount
        from sales_docs d join profiles pr on pr.id = d.user_id
        where d.type = 'INVOICE' and d.status <> 'VOID' and d.doc_date >= v_month
        group by pr.full_name order by sum(d.total) desc limit 8) x)
  );
end $$;

/** Sales / profit report. p_group: day | product | customer | salesman | category. Net of returns, excl. tax. */
create or replace function report_sales(p_from date, p_to date, p_group text default 'day', p_location bigint default null)
returns table (key text, label text, qty numeric, amount numeric, cost numeric, profit numeric, invoices bigint)
language sql stable security definer set search_path = public as $$
  with lines as (
    select d.id as doc_id, d.type, d.doc_date, d.customer_id, d.user_id, l.product_id,
           case when d.type = 'RETURN' then -1 else 1 end as s,
           l.qty, l.cost,
           -- line amount after doc discount, excluding tax
           l.line_total * case when d.subtotal + d.discount = 0 then 1
                               else (d.total - d.tax) / nullif((select sum(line_total) from sales_lines where doc_id = d.id), 0) end as amt
    from sales_docs d join sales_lines l on l.doc_id = d.id
    where is_active_user() and d.type in ('INVOICE','RETURN') and d.status <> 'VOID'
      and d.doc_date::date between p_from and p_to and (p_location is null or d.location_id = p_location)
  )
  select k.key, k.label, round(sum(s * qty), 3), round(sum(s * amt), 2), round(sum(s * qty * cost), 2),
         round(sum(s * amt) - sum(s * qty * cost), 2),
         count(distinct doc_id) filter (where type = 'INVOICE')
  from lines
  cross join lateral (
    select case p_group
             when 'product'  then product_id::text
             when 'customer' then coalesce(customer_id::text, '0')
             when 'salesman' then user_id::text
             when 'category' then coalesce((select category_id::text from products where id = product_id), '0')
             else to_char(doc_date, 'YYYY-MM-DD') end as key,
           case p_group
             when 'product'  then (select code || ' - ' || name from products where id = product_id)
             when 'customer' then coalesce((select name from customers where id = customer_id), 'Walk-in')
             when 'salesman' then (select full_name from profiles where id = user_id)
             when 'category' then coalesce((select c.name from products p join categories c on c.id = p.category_id where p.id = product_id), 'Uncategorised')
             else to_char(doc_date, 'YYYY-MM-DD') end as label
  ) k
  group by k.key, k.label
  order by case when p_group = 'day' then k.key end, sum(s * amt) desc
$$;

/** Receivable (CUSTOMER) or payable (SUPPLIER) aging by due date. */
create or replace function report_aging(p_kind text default 'CUSTOMER')
returns table (party_id bigint, name text, current_amt numeric, d30 numeric, d60 numeric, d90 numeric, over90 numeric, total numeric)
language sql stable security definer set search_path = public as $$
  with open_docs as (
    select d.customer_id as pid, c.name, coalesce(d.due_date, d.doc_date::date) as due, d.total - d.paid - d.credited as amt
    from sales_docs d join customers c on c.id = d.customer_id
    where p_kind = 'CUSTOMER' and d.type = 'INVOICE' and d.status <> 'VOID' and d.total - d.paid - d.credited > 0.004
    union all
    select d.supplier_id, s.name, coalesce(d.due_date, d.doc_date::date), d.total - d.paid - d.credited
    from purchase_docs d join suppliers s on s.id = d.supplier_id
    where p_kind = 'SUPPLIER' and d.type = 'GRN' and d.status <> 'VOID' and d.total - d.paid - d.credited > 0.004
  )
  select pid, name,
         sum(amt) filter (where current_date - due <= 0),
         sum(amt) filter (where current_date - due between 1 and 30),
         sum(amt) filter (where current_date - due between 31 and 60),
         sum(amt) filter (where current_date - due between 61 and 90),
         sum(amt) filter (where current_date - due > 90),
         sum(amt)
  from open_docs where is_active_user()
  group by pid, name order by sum(amt) desc
$$;

/** Customer statement: invoices, returns and receipts with running balance. */
create or replace function customer_statement(p_customer bigint, p_from date, p_to date)
returns table (tx_date timestamptz, doc_no text, kind text, debit numeric, credit numeric, balance numeric)
language sql stable security definer set search_path = public as $$
  with opening as (
    select coalesce(sum(case when type = 'INVOICE' then total else -total end), 0)
         - coalesce((select sum(amount) from receipts where customer_id = p_customer and status = 'ACTIVE' and receipt_date::date < p_from), 0) as bal
    from sales_docs where customer_id = p_customer and type in ('INVOICE','RETURN') and status <> 'VOID' and doc_date::date < p_from
  ), tx as (
    select doc_date as tx_date, doc_no, type as kind,
           case when type = 'INVOICE' then total else 0 end as debit,
           case when type = 'RETURN' then total else 0 end as credit
    from sales_docs where customer_id = p_customer and type in ('INVOICE','RETURN') and status <> 'VOID'
      and doc_date::date between p_from and p_to
    union all
    select receipt_date, receipt_no, 'RECEIPT', 0, amount from receipts
    where customer_id = p_customer and status = 'ACTIVE' and receipt_date::date between p_from and p_to
  )
  select null::timestamptz, 'OPENING', 'OPENING', null::numeric, null::numeric, bal from opening where is_active_user()
  union all
  select tx_date, doc_no, kind, debit, credit,
         (select bal from opening) + sum(debit - credit) over (order by tx_date, doc_no)
  from tx where is_active_user()
$$;

-- ---------- Triggers ----------

create or replace function trg_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sell_price is distinct from old.sell_price or new.cost_price is distinct from old.cost_price then
    insert into price_changes (product_id, old_sell_price, new_sell_price, old_cost_price, new_cost_price, user_id)
    values (new.id, old.sell_price, new.sell_price, old.cost_price, new.cost_price, auth.uid());
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists products_price_change on products;
create trigger products_price_change before update on products for each row execute function trg_price_change();

/** New Supabase Auth user -> profile (inactive until an admin activates it). The very first user becomes ADMIN. */
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first boolean := not exists (select 1 from profiles);
  v_user text := lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
begin
  if exists (select 1 from profiles where username = v_user) then
    v_user := v_user || '-' || left(new.id::text, 4);
  end if;
  insert into profiles (id, username, full_name, role, is_active, location_id)
  values (new.id,
          v_user,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          case when v_first then 'ADMIN' else 'SALESMAN' end,
          v_first,
          (select min(id) from locations))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

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

-- =====================================================================
-- amoka.retail ERP & POS  |  04 - STARTER DATA
-- Safe to run more than once. Sample products/customers/suppliers are marked "(sample)" - edit or deactivate them.
-- =====================================================================

insert into settings (id, company_name, address, currency, tax_name, tax_rate, tax_inclusive, receipt_footer, invoice_terms)
values (1, 'AMOKA TRADING PTE LTD', 'Singapore', 'SGD', 'GST', 9, false,
        'Thank you for shopping with amoka.retail!',
        'Goods sold are not returnable after 7 days. Payment by cheque to "AMOKA TRADING PTE LTD".')
on conflict (id) do nothing;

insert into doc_sequences (key, prefix) values
  ('QUOTE','SQ'), ('ORDER','SO'), ('INVOICE','INV'), ('DELIVERY','DO'), ('RETURN','SR'), ('RECEIPT','RC'),
  ('P_QUOTE','PQ'), ('P_ORDER','PO'), ('P_GRN','GRN'), ('P_RETURN','PR'), ('PAYMENT','PV'),
  ('TRANSFER','TR'), ('STOCK_REQ','SRQ'), ('ADJUST','ADJ'), ('STOCKTAKE','STK'),
  ('V_PAYMENT','PAY'), ('V_RECEIPT','RV'), ('V_EXPENSE','EXP')
on conflict (key) do nothing;

insert into locations (code, name) values ('MAIN', 'Main Outlet'), ('WH', 'Warehouse')
on conflict (code) do nothing;

insert into currencies (code, name, rate) values
  ('SGD','Singapore Dollar',1), ('MYR','Malaysian Ringgit',0.29), ('USD','US Dollar',1.30), ('INR','Indian Rupee',0.016)
on conflict (code) do nothing;

insert into taxes (code, name, rate) values ('SR','Standard-rated GST',9), ('ZR','Zero-rated',0), ('ES','Exempt',0)
on conflict (code) do nothing;

insert into terms (code, name, days) values
  ('COD','Cash on delivery',0), ('7D','7 days',7), ('14D','14 days',14), ('30D','30 days',30), ('60D','60 days',60)
on conflict (code) do nothing;

insert into paymodes (code, name, is_cash, sort_order) values
  ('CASH','Cash',true,1), ('NETS','NETS',false,2), ('CARD','Credit / Debit Card',false,3),
  ('PAYNOW','PayNow',false,4), ('CHEQUE','Cheque',false,5), ('BANK','Bank Transfer',false,6)
on conflict (code) do nothing;

insert into customer_groups (code, name, discount_pct) values
  ('RETAIL','Retail',0), ('WHOLESALE','Wholesale',5), ('VIP','VIP',10)
on conflict (code) do nothing;

insert into areas (code, name) values ('NORTH','North'), ('SOUTH','South'), ('EAST','East'), ('WEST','West'), ('CENTRAL','Central')
on conflict (code) do nothing;

insert into uoms (code, name) values
  ('PCS','Pieces'), ('BOX','Box'), ('CTN','Carton'), ('KG','Kilogram'), ('BTL','Bottle'), ('PKT','Packet')
on conflict (code) do nothing;

insert into categories (code, name) values
  ('BEV','Beverages'), ('SNK','Snacks'), ('GRO','Groceries'), ('HH','Household'), ('PC','Personal Care')
on conflict (code) do nothing;

insert into brands (code, name) values ('GEN','Generic'), ('AMK','Amoka Select')
on conflict (code) do nothing;

-- Chart of accounts
insert into accounts (code, name, type) values
  ('1000','Cash in Hand','ASSET'), ('1010','Bank','ASSET'), ('1100','Accounts Receivable','ASSET'),
  ('1200','Inventory','ASSET'), ('2000','Accounts Payable','LIABILITY'), ('2100','GST Payable','LIABILITY'),
  ('3000','Owner''s Capital','EQUITY'), ('4000','Sales','INCOME'), ('4100','Other Income','INCOME'),
  ('5000','Cost of Goods Sold','EXPENSE'), ('6000','Rent','EXPENSE'), ('6100','Salaries','EXPENSE'),
  ('6200','Utilities','EXPENSE'), ('6300','Transport & Fuel','EXPENSE'), ('6400','Marketing','EXPENSE'),
  ('6900','Miscellaneous Expense','EXPENSE')
on conflict (code) do nothing;

-- Sample products
insert into products (code, barcode, name, category_id, uom_id, brand_id, cost_price, sell_price, wholesale_price, min_stock)
select v.code, v.barcode, v.name, c.id, u.id, b.id, v.cost, v.sell, v.wholesale, v.min_stock
from (values
  ('P0001','8888000000011','Mineral Water 500ml','BEV','BTL',0.35,0.80,0.65,48),
  ('P0002','8888000000028','Green Tea 500ml','BEV','BTL',0.90,1.80,1.50,24),
  ('P0003','8888000000035','Orange Juice 1L','BEV','BTL',2.10,3.50,3.00,12),
  ('P0004','8888000000042','Instant Coffee 3in1 (30s)','BEV','PKT',5.20,7.90,6.90,10),
  ('P0005','8888000000059','Potato Chips 150g','SNK','PKT',1.60,2.90,2.40,20),
  ('P0006','8888000000066','Chocolate Bar 50g','SNK','PCS',0.80,1.50,1.20,30),
  ('P0007','8888000000073','Cream Crackers 300g','SNK','PKT',1.90,3.20,2.70,15),
  ('P0008','8888000000080','Jasmine Rice 5kg','GRO','PKT',9.50,13.90,12.50,10),
  ('P0009','8888000000097','Cooking Oil 2L','GRO','BTL',5.40,7.95,7.10,10),
  ('P0010','8888000000103','White Sugar 1kg','GRO','PKT',1.40,2.20,1.90,15),
  ('P0011','8888000000110','Instant Noodles (5 pack)','GRO','PKT',2.30,3.60,3.10,20),
  ('P0012','8888000000127','Dishwashing Liquid 900ml','HH','BTL',2.20,3.90,3.30,10),
  ('P0013','8888000000134','Laundry Detergent 3kg','HH','PKT',9.80,14.50,12.90,6),
  ('P0014','8888000000141','Tissue Box (5 x 200)','HH','PKT',4.50,6.90,5.90,10),
  ('P0015','8888000000158','Shampoo 400ml','PC','BTL',4.20,7.50,6.40,8),
  ('P0016','8888000000165','Toothpaste 160g','PC','PCS',1.70,3.20,2.70,12)
) as v(code, barcode, name, cat, uom, cost, sell, wholesale, min_stock)
join categories c on c.code = v.cat
join uoms u on u.code = v.uom
join brands b on b.code = 'GEN'
order by v.code
on conflict (code) do nothing;

insert into customers (code, name, phone, address, terms_days, credit_limit, group_id, area_id)
select v.code, v.name, v.phone, v.address, v.terms, v.credit, g.id, a.id
from (values
  ('C0001','Sunrise Minimart (sample)','+65 6123 4567','12 Ang Mo Kio Ave 3',30,5000,'WHOLESALE','NORTH'),
  ('C0002','Lucky Provision Shop (sample)','+65 6234 5678','45 Tampines St 21',14,2000,'RETAIL','EAST'),
  ('C0003','Green Leaf Cafe (sample)','+65 6345 6789','8 Jurong West St 52',30,3000,'VIP','WEST')
) as v(code, name, phone, address, terms, credit, grp, area)
join customer_groups g on g.code = v.grp
join areas a on a.code = v.area
order by v.code
on conflict (code) do nothing;

insert into suppliers (code, name, phone, terms_days) values
  ('S0001','Prime Foods Distribution (sample)','+65 6456 7890',30),
  ('S0002','CleanHome Supplies (sample)','+65 6567 8901',45)
on conflict (code) do nothing;

-- Opening stock for sample products (only if no stock exists yet)
insert into stocks (product_id, location_id, qty)
select p.id, l.id, case when l.code = 'MAIN' then greatest(p.min_stock * 2, 20) else greatest(p.min_stock * 5, 50) end
from products p cross join locations l
where not exists (select 1 from stocks)
on conflict do nothing;

-- =====================================================================
-- AFTER RUNNING THIS FILE:
-- 1. Supabase Dashboard -> Authentication -> Users -> "Add user" -> create your admin login
--    (e.g. admin@amoka.retail). The FIRST user created becomes an active ADMIN automatically.
-- 2. Every later user starts as an inactive SALESMAN; activate them and set the role in Web Portal -> Users.
-- =====================================================================

-- =====================================================================
-- amoka.retail ERP & POS  |  05 - Stock request approve / reject
-- Run once in Supabase SQL Editor (after 01-04).
-- =====================================================================

create or replace function set_stock_request_status(p_id bigint, p_status text) returns stock_requests
language plpgsql security definer set search_path = public as $$
declare v stock_requests%rowtype;
begin
  perform assert_can('stock');
  if p_status not in ('APPROVED','REJECTED') then raise exception 'Invalid status'; end if;
  update stock_requests set status = p_status where id = p_id and status in ('OPEN','APPROVED') returning * into v;
  if not found then raise exception 'Request not found or already completed'; end if;
  return v;
end $$;
