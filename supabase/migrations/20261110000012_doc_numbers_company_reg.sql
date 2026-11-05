-- =====================================================================
-- amoka.retail ERP & POS  |  12 - Document numbers like IN26-03867 / RE26-02390 / SR26-00206,
--                                  company registration no. on printouts
-- Run once in Supabase SQL Editor.
-- =====================================================================

-- Company registration (UEN / CO REG NO) shown on every invoice & receipt header.
alter table settings add column if not exists reg_no text;

-- Your details as printed on the current receipts (edit any time in Portal -> Master -> Company).
update settings set
  company_name = 'AMOKA TRADING PTE LTD',
  address      = coalesce(nullif(address, 'Singapore'), '11 Tuas Bay Close, West Star #08-01/06'),
  phone        = coalesce(phone, '86003499'),
  reg_no       = coalesce(reg_no, '202300910D')
where id = 1;

-- Prefixes in the same style as your old system.
update doc_sequences set prefix = 'IN'  where key = 'INVOICE';
update doc_sequences set prefix = 'RE'  where key = 'RECEIPT';
update doc_sequences set prefix = 'SR'  where key = 'RETURN';
update doc_sequences set prefix = 'SO'  where key = 'ORDER';
update doc_sequences set prefix = 'SQ'  where key = 'QUOTE';
update doc_sequences set prefix = 'DO'  where key = 'DELIVERY';

/** Number format: PREFIX + 2-digit year + '-' + 5 digits, e.g. IN26-03867. */
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
  return v_prefix || to_char(now() at time zone 'Asia/Singapore', 'YY') || '-' || lpad(v_no::text, 5, '0');
end $$;
revoke execute on function next_doc_no(text) from public, anon, authenticated;

-- To continue numbering from your old system, set the next number, e.g.:
--   update doc_sequences set next_no = 3868 where key = 'INVOICE';   -- next invoice IN26-03868
--   update doc_sequences set next_no = 2391 where key = 'RECEIPT';   -- next receipt RE26-02391
--   update doc_sequences set next_no = 207  where key = 'RETURN';    -- next return  SR26-00207

notify pgrst, 'reload schema';
