# amoka.retail — ERP & POS

Retail ERP and point-of-sale system for **AMOKA TRADING PTE LTD**, built on **Supabase** (database, auth, security).

| Module | Who uses it | Tech |
|---|---|---|
| **Web Portal** (back office) — `apps/web` | Admin, Accounts, Manager, Cashier, Storekeeper | React + Vite + Tailwind, Supabase JS |
| **Salesman App** (phone / tablet) — `apps/sales` | Salesmen in the field: category catalog with photos, take orders & invoices at retail shops, collect payment, print on a Bluetooth printer, works offline | Installable web app (PWA), React + Supabase JS |
| **Database & business rules** — `supabase/` | Shared by both apps | PostgreSQL functions + Row Level Security |

## Feature map

- **Master**: company settings, locations, customers, customer groups, suppliers, terms, currency, bank, paymode, tax, area, bins
- **Products**: category / sub-category, UOM, brand, products (barcode, carton qty, retail & wholesale price), product stock, price change history, customer price, supplier price, product gallery
- **Purchase**: purchase quote, purchase order, goods receive (updates stock & cost), purchase return, supplier payments, payable aging
- **Sales**: sales quote, sales order, sales invoice, delivery order, sales return, receipts, accounts receivable, customer statement
- **Web POS**: barcode billing, split payments (cash / NETS / card / PayNow / cheque), change, hold & recall, reprint, cash in / out, settlement (Z-report)
- **Transfers**: stock request, product transfer between locations
- **Stock update**: stock adjustment, stock take
- **Security**: users, roles, editable role-permission matrix, separate web / mobile access
- **Accounting**: chart of accounts, payment / receipt / expense vouchers, opening balances
- **Reports & dashboard**: sales by day / product / customer / salesman / category with profit, aging, low stock, top products, top salesmen

Every stock and money change runs inside a database function (one transaction) — the apps cannot write
documents, stock or balances directly, so data stays consistent and tamper-proof.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste **`supabase/setup_all.sql`** and click **Run**.
   (Same content as the 4 files in `supabase/migrations/`, which you can also run one by one in order.)
3. **Authentication → Users → Add user** → create your admin login (e.g. `admin@amoka.retail`, tick *Auto Confirm*).
   The **first** user automatically becomes an active **ADMIN**. Users created later start inactive — activate them
   and choose their role in *Web Portal → Security → Users*.

## 2. Run the web portal

Requires Node.js 20+.

```bash
npm install
cp apps/web/.env.example apps/web/.env   # then fill in your Supabase URL + anon key
npm run dev                              # http://localhost:5173
```

## Project structure

```
apps/web/            Back-office web portal
apps/sales/          Salesman app (installable PWA)
supabase/migrations/ Database schema, functions, security, seed data
supabase/setup_all.sql  All migrations in one file (generated)
```

## 3. Run the salesman app

```bash
cp apps/sales/.env.example apps/sales/.env   # same Supabase URL + anon key as the web portal
npm run dev:sales                            # http://localhost:5174 (and http://<your-PC-IP>:5174 on the same Wi-Fi)
```

Install on a tablet/phone: open the app's **HTTPS** address in Chrome → menu → **Install app**
(iPhone/iPad: Safari → Share → **Add to Home Screen**). Installing and Bluetooth printing require HTTPS,
so for daily use deploy `apps/sales` to an HTTPS host (e.g. Vercel, Netlify or Cloudflare Pages).

Bluetooth printing works with BLE ESC/POS thermal printers (58 mm / 80 mm) from Chrome on Android.
Other devices use the normal print dialog.
