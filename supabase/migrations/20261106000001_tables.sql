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
