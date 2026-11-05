-- =====================================================================
-- amoka.retail ERP & POS  |  06 - Profiles for existing logins + function privileges
-- Run once in Supabase SQL Editor.
-- =====================================================================

-- 1. Users created in Authentication BEFORE the scripts were run have no profile.
--    Create one for each of them. If there is still no active ADMIN, the oldest login becomes ADMIN.
insert into profiles (id, username, full_name, role, is_active, location_id)
select u.id,
       lower(split_part(u.email, '@', 1)) || case when exists (select 1 from profiles p where p.username = lower(split_part(u.email, '@', 1))) then '-' || left(u.id::text, 4) else '' end,
       split_part(u.email, '@', 1),
       'SALESMAN', false, (select min(id) from locations)
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

update profiles set role = 'ADMIN', is_active = true
where not exists (select 1 from profiles where role = 'ADMIN' and is_active)
  and id = (select id from auth.users order by created_at limit 1);

-- 2. Functions: callable only by signed-in users (Postgres grants EXECUTE to PUBLIC by default).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Internal helpers stay locked even for signed-in users.
revoke execute on function move_stock(bigint, bigint, numeric, text, text, text) from authenticated;
revoke execute on function next_doc_no(text) from authenticated;
revoke execute on function create_sales_doc(jsonb, boolean, bigint) from authenticated;
revoke execute on function handle_new_user() from authenticated;
revoke execute on function trg_price_change() from authenticated;
-- New functions created later follow the same rule.
alter default privileges in schema public revoke execute on functions from public, anon;

-- Check: you should see your login with role ADMIN and is_active = true
select u.email, p.username, p.role, p.is_active from auth.users u join profiles p on p.id = u.id order by u.created_at;
