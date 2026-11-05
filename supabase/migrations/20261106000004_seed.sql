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
