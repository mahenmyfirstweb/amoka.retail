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
