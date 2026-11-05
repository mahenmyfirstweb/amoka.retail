-- =====================================================================
-- amoka.retail ERP & POS  |  08 - Table privileges for signed-in users
-- Newer Supabase projects do not automatically grant table access to the API roles.
-- Signed-in users ("authenticated") get table access here; Row Level Security (file 03)
-- still decides exactly which rows each role may read or change. Anonymous visitors get nothing.
-- Run once in Supabase SQL Editor.
-- =====================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Keep internal helpers locked (see file 06).
revoke execute on function move_stock(bigint, bigint, numeric, text, text, text) from authenticated;
revoke execute on function next_doc_no(text) from authenticated;
revoke execute on function create_sales_doc(jsonb, boolean, bigint) from authenticated;
revoke execute on function handle_new_user() from authenticated;
revoke execute on function trg_price_change() from authenticated;

-- Tables created later get the same access.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- Make the API pick up the changes immediately.
notify pgrst, 'reload schema';

-- Check: every row must show true
select 'profiles readable' as check, has_table_privilege('authenticated', 'public.profiles', 'select') as ok
union all select 'settings readable', has_table_privilege('authenticated', 'public.settings', 'select')
union all select 'my_permissions callable', has_function_privilege('authenticated', 'public.my_permissions()', 'execute')
union all select 'owner is active ADMIN', exists (select 1 from profiles p join auth.users u on u.id = p.id
                                                  where lower(u.email) = 'mahenmyfirstweb@gmail.com' and p.role = 'ADMIN' and p.is_active);
