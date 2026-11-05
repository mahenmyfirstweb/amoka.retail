// Supabase Edge Function: admin-users
// Lets an ADMIN create a login (email + password) for staff from the web portal.
// Deploy:  Supabase Dashboard -> Edge Functions -> Deploy a new function -> name "admin-users" -> paste this file
//      or: supabase functions deploy admin-users
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['ADMIN', 'ACCOUNTS', 'MANAGER', 'CASHIER', 'SALESMAN', 'STOREKEEPER'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // 1. The caller must be an active user with the "users" permission.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: allowed, error: permErr } = await asCaller.rpc('can', { p_area: 'users' });
  if (permErr || !allowed) return json({ error: 'Only administrators can create users' }, 403);

  // 2. Validate input.
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const fullName = String(body.full_name ?? '').trim();
  const role = String(body.role ?? 'SALESMAN');
  if (!email.includes('@')) return json({ error: 'Enter a valid email' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
  if (!fullName) return json({ error: 'Enter the full name' }, 400);
  if (!ROLES.includes(role)) return json({ error: 'Invalid role' }, 400);

  // 3. Create the auth user (the database trigger creates the profile), then set role & activate.
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username: email.split('@')[0] },
  });
  if (error || !created.user) return json({ error: error?.message ?? 'Could not create user' }, 400);

  const { error: upErr } = await admin
    .from('profiles')
    .update({
      full_name: fullName,
      role,
      phone: body.phone ?? null,
      location_id: body.location_id ?? null,
      is_active: true,
    })
    .eq('id', created.user.id);
  if (upErr) return json({ error: upErr.message }, 400);

  return json({ id: created.user.id, email });
});
