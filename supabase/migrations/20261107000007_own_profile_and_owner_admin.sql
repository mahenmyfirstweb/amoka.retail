-- =====================================================================
-- amoka.retail ERP & POS  |  07 - Users can always read their own profile; make the owner ADMIN
-- Run once in Supabase SQL Editor.
-- =====================================================================

-- Users must be able to read their own profile even before activation
-- (so the app can show "waiting for activation" instead of "no profile").
drop policy if exists "read_own" on profiles;
create policy "read_own" on profiles for select to authenticated using (id = auth.uid());

-- Make sure every login has a profile.
insert into profiles (id, username, full_name, role, is_active, location_id)
select u.id, lower(split_part(u.email, '@', 1)) || '-' || left(u.id::text, 4), split_part(u.email, '@', 1),
       'SALESMAN', false, (select min(id) from locations)
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

-- The owner account is an active ADMIN.
update profiles p set role = 'ADMIN', is_active = true,
       full_name = case when p.full_name = '' then 'Mahendran' else p.full_name end
from auth.users u
where u.id = p.id and lower(u.email) = 'mahenmyfirstweb@gmail.com';

-- Check: your email must show ADMIN / true
select u.email, p.username, p.full_name, p.role, p.is_active
from auth.users u left join profiles p on p.id = u.id
order by u.created_at;
