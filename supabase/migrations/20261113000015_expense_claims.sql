-- =====================================================================
-- amoka.retail ERP & POS  |  15 - Salesman expense claims with receipt photos
--  Salesman: submit claims (date, category, amount, receipt photo); edit/delete while SUBMITTED.
--  Accounts (expense_approve): approve / reject / mark paid; month-end report.
-- Run once in Supabase SQL Editor.
-- =====================================================================

create table if not exists expense_claims (
  id            bigint generated always as identity primary key,
  claim_no      text not null unique,
  user_id       uuid not null references profiles(id) default auth.uid(),
  claim_date    date not null default current_date,
  category      text not null,      -- TOPUP | FUEL | PARKING | STATIONERY | MEALS | PHONE | OTHER
  description   text,
  amount        numeric(14,2) not null check (amount > 0),
  paid_by       text not null default 'CASH',   -- how the salesman paid: CASH | CARD | NETS | PAYNOW
  receipt_path  text,               -- path inside the private "expense-receipts" bucket
  status        text not null default 'SUBMITTED' check (status in ('SUBMITTED','APPROVED','REJECTED','PAID')),
  review_note   text,               -- reject reason / accounts remark
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  paid_ref      text,               -- refund reference (bank transfer / cash voucher no.)
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists expense_claims_user_date_idx on expense_claims (user_id, claim_date desc);

insert into doc_sequences (key, prefix) values ('CLAIM', 'EC') on conflict (key) do nothing;
insert into role_permissions (area, role) values
  ('expense_approve', 'ADMIN'), ('expense_approve', 'ACCOUNTS'), ('expense_approve', 'MANAGER')
on conflict do nothing;

-- Claim number on insert (EC26-00001)
create or replace function trg_expense_claim_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.claim_no is null or new.claim_no = '' then new.claim_no := next_doc_no('CLAIM'); end if;
  new.user_id := coalesce(new.user_id, auth.uid());
  new.status := 'SUBMITTED';
  return new;
end $$;
drop trigger if exists expense_claim_no on expense_claims;
create trigger expense_claim_no before insert on expense_claims for each row execute function trg_expense_claim_no();

-- Owners may only change their own claim while it is SUBMITTED (and cannot change status / review fields).
create or replace function trg_expense_claim_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('amoka.claim_review', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if old.status <> 'SUBMITTED' then raise exception 'This claim is already %, it cannot be changed', lower(old.status); end if;
  new.status := old.status; new.review_note := old.review_note; new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at; new.paid_ref := old.paid_ref; new.paid_at := old.paid_at;
  new.user_id := old.user_id; new.claim_no := old.claim_no;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists expense_claim_guard on expense_claims;
create trigger expense_claim_guard before update on expense_claims for each row execute function trg_expense_claim_guard();

alter table expense_claims enable row level security;
drop policy if exists "claims_read" on expense_claims;
drop policy if exists "claims_insert" on expense_claims;
drop policy if exists "claims_update" on expense_claims;
drop policy if exists "claims_delete" on expense_claims;
create policy "claims_read" on expense_claims for select to authenticated
  using (is_active_user() and (user_id = auth.uid() or can('expense_approve')));
create policy "claims_insert" on expense_claims for insert to authenticated
  with check (is_active_user() and user_id = auth.uid());
create policy "claims_update" on expense_claims for update to authenticated
  using (user_id = auth.uid() and status = 'SUBMITTED') with check (user_id = auth.uid());
create policy "claims_delete" on expense_claims for delete to authenticated
  using (user_id = auth.uid() and status = 'SUBMITTED');
grant select, insert, update, delete on expense_claims to authenticated;

/** Accounts: approve / reject / mark paid one or many claims. p_status: APPROVED | REJECTED | PAID */
create or replace function review_expense_claims(p_ids bigint[], p_status text, p_note text default null, p_ref text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  perform assert_can('expense_approve');
  if p_status not in ('APPROVED','REJECTED','PAID') then raise exception 'Invalid status'; end if;
  if p_status = 'REJECTED' and coalesce(trim(p_note), '') = '' then raise exception 'Enter the reason for rejecting'; end if;
  perform set_config('amoka.claim_review', 'on', true);
  update expense_claims set
    status = p_status,
    review_note = coalesce(p_note, review_note),
    reviewed_by = case when p_status in ('APPROVED','REJECTED') then auth.uid() else coalesce(reviewed_by, auth.uid()) end,
    reviewed_at = case when p_status in ('APPROVED','REJECTED') then now() else coalesce(reviewed_at, now()) end,
    paid_ref = case when p_status = 'PAID' then p_ref else paid_ref end,
    paid_at = case when p_status = 'PAID' then now() else paid_at end
  where id = any(p_ids)
    and (p_status <> 'PAID' or status in ('SUBMITTED','APPROVED'))   -- cannot pay a rejected claim
    and status <> 'PAID';
  get diagnostics v_count = row_count;
  perform set_config('amoka.claim_review', 'off', true);
  return v_count;
end $$;
revoke execute on function review_expense_claims(bigint[], text, text, text) from public, anon;
grant execute on function review_expense_claims(bigint[], text, text, text) to authenticated;
revoke execute on function trg_expense_claim_no() from public, anon, authenticated;
revoke execute on function trg_expense_claim_guard() from public, anon, authenticated;

-- ---------- Private storage for receipt photos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 8388608, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false;

-- Files are stored as <user id>/<file>. Owner + accounts can view; owner uploads into own folder.
drop policy if exists "expense receipts: read" on storage.objects;
create policy "expense receipts: read" on storage.objects for select to authenticated
  using (bucket_id = 'expense-receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.can('expense_approve')));
drop policy if exists "expense receipts: upload" on storage.objects;
create policy "expense receipts: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-receipts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "expense receipts: delete own" on storage.objects;
create policy "expense receipts: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'expense-receipts' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
