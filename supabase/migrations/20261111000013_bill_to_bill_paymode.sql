-- =====================================================================
-- amoka.retail ERP & POS  |  13 - "Bill to Bill" paymode, selected by default
-- The FIRST paymode (lowest sort order) is the default in the salesman app and on receipts.
-- Change the order any time in Portal -> Master -> Paymode.
-- Run once in Supabase SQL Editor.
-- =====================================================================

insert into paymodes (code, name, is_cash, sort_order)
values ('BTB', 'Bill to Bill', false, 0)
on conflict (code) do update set sort_order = 0, is_active = true;

notify pgrst, 'reload schema';
