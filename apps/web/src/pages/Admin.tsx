import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus, Printer, Trash2, Upload, UserPlus } from 'lucide-react';
import { supabase, rpc, errorMessage } from '../lib/supabase';
import { useLookup, usePaymodes, useBanks, useSettings, useTable, type Row } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateFmt, dateTimeFmt, isoDate, money } from '../lib/format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pager, useToast } from '../components/ui';
import { PartyPicker, ProductPicker } from '../components/Pickers';
import { CompanyHeader } from './docs/DocView';
import { SettlementReport } from './Pos';

const PAGE = 50;
const VOUCHER_LABEL: Record<string, string> = { PAYMENT: 'Payment Voucher', RECEIPT: 'Receipt Voucher', EXPENSE: 'Expense Voucher' };

// =====================================================================
// Vouchers
// =====================================================================
export function VoucherList() {
  const { type = 'PAYMENT' } = useParams();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const list = useTable('vouchers', {
    select: '*, paymode:paymodes(name)',
    key: [type, page],
    build: (q) => q.eq('type', type).order('id', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
  });
  return (
    <div>
      <PageHeader title={`${VOUCHER_LABEL[type]}s`} actions={<button className="btn-primary" onClick={() => nav(`/vouchers/new/${type}`)}><Plus size={16} /> New voucher</button>} />
      <div className="card overflow-hidden">
        {list.isLoading ? <Loading /> : !list.data?.items.length ? <Empty /> : (
          <table className="table">
            <thead><tr><th>No.</th><th>Date</th><th>Payee / payer</th><th>Paymode</th><th>Reference</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {list.data.items.map((v) => (
                <tr key={v.id}>
                  <td><Link to={`/vouchers/view/${v.id}`} className="font-medium hover:text-gold-600">{v.voucher_no}</Link></td>
                  <td>{dateFmt(v.voucher_date)}</td>
                  <td>{v.party_name}</td>
                  <td>{v.paymode?.name}</td>
                  <td>{v.reference}</td>
                  <td className="num font-medium">{money(v.amount)}</td>
                  <td>{v.status === 'VOID' ? <Badge color="red">Void</Badge> : <Badge color="green">Active</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={page} pageSize={PAGE} count={list.data?.count ?? 0} onPage={setPage} />
      </div>
    </div>
  );
}

export function VoucherNew() {
  const { type = 'PAYMENT' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: paymodes } = usePaymodes();
  const { data: banks } = useBanks();
  const { data: accounts } = useLookup('accounts', 'id, code, name, type');
  const [h, setH] = useState<Row>({ voucher_date: isoDate(), paymode_id: '', bank_id: '', party_name: '', reference: '', cheque_no: '', notes: '' });
  const [lines, setLines] = useState<Row[]>([{ account_id: '', description: '', amount: 0 }]);
  const [error, setError] = useState<string | null>(null);
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const acctFilter = type === 'RECEIPT' ? ['INCOME', 'LIABILITY', 'EQUITY', 'ASSET'] : ['EXPENSE', 'ASSET', 'LIABILITY'];

  async function save() {
    setError(null);
    try {
      const v = await rpc<Row>('create_voucher', {
        p: {
          type, ...h,
          voucher_date: new Date(`${h.voucher_date}T12:00:00`).toISOString(),
          paymode_id: h.paymode_id || null, bank_id: h.bank_id || null,
          lines: lines.filter((l) => l.account_id && l.amount > 0).map((l) => ({ account_id: Number(l.account_id), description: l.description, amount: Number(l.amount) })),
        },
      });
      qc.invalidateQueries();
      toast('ok', `${v.voucher_no} saved`);
      nav(`/vouchers/view/${v.id}`, { replace: true });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`New ${VOUCHER_LABEL[type]}`} back={`/vouchers/${type}`} actions={<button className="btn-primary" onClick={save}>Save voucher</button>} />
      <ErrorBox error={error} />
      <div className="card mt-4 grid gap-4 p-5 md:grid-cols-3">
        <Field label="Date"><input type="date" className="input" value={h.voucher_date} onChange={(e) => setH({ ...h, voucher_date: e.target.value })} /></Field>
        <Field label={type === 'RECEIPT' ? 'Received from' : 'Paid to'}><input className="input" value={h.party_name} onChange={(e) => setH({ ...h, party_name: e.target.value })} /></Field>
        <Field label="Paymode">
          <select className="input" value={h.paymode_id} onChange={(e) => setH({ ...h, paymode_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">—</option>{paymodes?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Bank">
          <select className="input" value={h.bank_id} onChange={(e) => setH({ ...h, bank_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">—</option>{banks?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Cheque no."><input className="input" value={h.cheque_no} onChange={(e) => setH({ ...h, cheque_no: e.target.value })} /></Field>
        <Field label="Reference"><input className="input" value={h.reference} onChange={(e) => setH({ ...h, reference: e.target.value })} /></Field>
        <Field label="Notes" className="md:col-span-3"><input className="input" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
      </div>
      <div className="card mt-4 overflow-hidden">
        <table className="table">
          <thead><tr><th>Account</th><th>Description</th><th className="w-40 num">Amount</th><th className="w-10" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select className="input" value={l.account_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, account_id: e.target.value } : x)))}>
                    <option value="">Select account…</option>
                    {accounts?.filter((a) => acctFilter.includes(a.type)).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                </td>
                <td><input className="input" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
                <td><input type="number" step="any" min="0" className="input num" value={l.amount || ''} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} /></td>
                <td>{lines.length > 1 && <button className="btn-ghost p-1.5 text-ink-300" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td><button className="btn-ghost btn-sm m-2" onClick={() => setLines([...lines, { account_id: '', description: '', amount: 0 }])}><Plus size={14} /> Add line</button></td><td className="px-3 text-right font-semibold">Total</td><td className="num px-3 font-semibold">{money(total)}</td><td /></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

export function VoucherView() {
  const { id } = useParams();
  const toast = useToast();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const { data: v, refetch } = useQuery({
    queryKey: ['voucher', id],
    queryFn: async () => (await supabase.from('vouchers').select('*, paymode:paymodes(name), bank:banks(name), user:profiles(full_name), lines:voucher_lines(*, account:accounts(code, name))').eq('id', Number(id)).single()).data as Row,
  });
  if (!v) return <Loading />;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-5 flex justify-between">
        <Link to={`/vouchers/${v.type}`} className="text-xs font-medium text-ink-400">← {VOUCHER_LABEL[v.type]}s</Link>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => window.print()}><Printer size={15} /> Print</button>
          {v.status !== 'VOID' && can('void_docs') && <button className="btn-ghost text-rose-600" onClick={async () => { try { await rpc('void_voucher', { p_id: v.id }); refetch(); } catch (e) { toast('err', (e as Error).message); } }}><Ban size={15} /> Void</button>}
        </div>
      </div>
      <div className="card print-area p-8">
        <CompanyHeader settings={settings} title={VOUCHER_LABEL[v.type].toUpperCase()} />
        {v.status === 'VOID' && <div className="mt-3"><Badge color="red">VOID</Badge></div>}
        <div className="mt-5 grid grid-cols-2 text-sm">
          <div><div className="text-ink-400">{v.type === 'RECEIPT' ? 'Received from' : 'Paid to'}</div><div className="font-semibold">{v.party_name}</div></div>
          <div className="text-right"><div><b>{v.voucher_no}</b></div><div>{dateFmt(v.voucher_date)}</div><div>{v.paymode?.name}{v.bank ? ` · ${v.bank.name}` : ''}{v.cheque_no ? ` · Chq ${v.cheque_no}` : ''}</div></div>
        </div>
        <table className="mt-6 w-full text-sm">
          <thead><tr className="border-y border-ink-200 text-[11px] uppercase text-ink-500"><th className="py-2 text-left">Account</th><th className="py-2 text-left">Description</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>{v.lines.map((l: Row) => <tr key={l.id} className="border-b border-ink-100"><td className="py-2">{l.account.code} · {l.account.name}</td><td className="py-2">{l.description}</td><td className="py-2 text-right tabular-nums">{money(l.amount)}</td></tr>)}</tbody>
        </table>
        <div className="mt-4 text-right text-lg font-semibold">Total {settings?.currency} {money(v.amount)}</div>
        <div className="mt-16 grid grid-cols-3 gap-10 text-xs text-ink-500">
          <div className="border-t border-ink-300 pt-2">Prepared by {v.user?.full_name}</div>
          <div className="border-t border-ink-300 pt-2">Approved by</div>
          <div className="border-t border-ink-300 pt-2">{v.type === 'RECEIPT' ? 'Paid by' : 'Received by'}</div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Users & roles
// =====================================================================
const ROLES = ['ADMIN', 'ACCOUNTS', 'MANAGER', 'CASHIER', 'SALESMAN', 'STOREKEEPER'];

export function Users() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: locations } = useLookup('locations');
  const { profile } = useAuth();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await supabase.from('profiles').select('*, location:locations(name)').order('full_name')).data ?? [],
  });
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveUser() {
    const { id, username, full_name, phone, role, location_id, is_active } = editing!;
    if (id === profile?.id && (!is_active || role !== 'ADMIN')) return toast('err', 'You cannot deactivate or demote yourself');
    const { error } = await supabase.from('profiles').update({ username, full_name, phone, role, location_id: location_id || null, is_active }).eq('id', id);
    if (error) return toast('err', errorMessage(error));
    toast('ok', 'User updated');
    setEditing(null);
    qc.invalidateQueries({ queryKey: ['users'] });
  }

  async function createUser() {
    setError(null);
    const { data, error } = await supabase.functions.invoke('admin-users', { body: adding ?? {} });
    if (error || data?.error) {
      setError(
        (data?.error ?? error?.message ?? 'Failed') +
          ' — If the "admin-users" Edge Function is not deployed yet, create the user in Supabase Dashboard → Authentication → Users, then activate them here.',
      );
      return;
    }
    toast('ok', 'User created');
    setAdding(null);
    qc.invalidateQueries({ queryKey: ['users'] });
  }

  return (
    <div>
      <PageHeader title="User Master" subtitle="New sign-ups are inactive until you activate them" actions={<button className="btn-primary" onClick={() => setAdding({ role: 'SALESMAN', location_id: locations?.[0]?.id })}><UserPlus size={16} /> New user</button>} />
      <div className="card overflow-hidden">
        {isLoading ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Location</th><th>Phone</th><th>Status</th></tr></thead>
            <tbody>
              {users.map((u: Row) => (
                <tr key={u.id} className="cursor-pointer" onClick={() => setEditing({ ...u })}>
                  <td className="font-medium text-ink-900">{u.full_name}</td>
                  <td>{u.username}</td>
                  <td><Badge color={u.role === 'ADMIN' ? 'gold' : u.role === 'SALESMAN' ? 'blue' : 'gray'}>{u.role}</Badge></td>
                  <td>{u.location?.name}</td>
                  <td>{u.phone}</td>
                  <td>{u.is_active ? <Badge color="green">Active</Badge> : <Badge color="amber">Pending / inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit user" footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" onClick={saveUser}>Save</button></>}>
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><input className="input" value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></Field>
            <Field label="Username"><input className="input" value={editing.username ?? ''} onChange={(e) => setEditing({ ...editing, username: e.target.value.toLowerCase() })} /></Field>
            <Field label="Phone"><input className="input" value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label="Role"><select className="input" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Default location"><select className="input" value={editing.location_id ?? ''} onChange={(e) => setEditing({ ...editing, location_id: Number(e.target.value) || null })}><option value="">—</option>{locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Active (can log in)</label>
          </div>
        )}
      </Modal>

      <Modal open={!!adding} onClose={() => setAdding(null)} title="New user" footer={<><button className="btn-secondary" onClick={() => setAdding(null)}>Cancel</button><button className="btn-primary" onClick={createUser}>Create user</button></>}>
        {adding && (
          <div className="space-y-4">
            <ErrorBox error={error} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name"><input className="input" value={adding.full_name ?? ''} onChange={(e) => setAdding({ ...adding, full_name: e.target.value })} /></Field>
              <Field label="Email (login)"><input className="input" type="email" value={adding.email ?? ''} onChange={(e) => setAdding({ ...adding, email: e.target.value })} /></Field>
              <Field label="Password (min 8)"><input className="input" type="text" value={adding.password ?? ''} onChange={(e) => setAdding({ ...adding, password: e.target.value })} /></Field>
              <Field label="Phone"><input className="input" value={adding.phone ?? ''} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} /></Field>
              <Field label="Role"><select className="input" value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
              <Field label="Location"><select className="input" value={adding.location_id ?? ''} onChange={(e) => setAdding({ ...adding, location_id: Number(e.target.value) })}>{locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const AREAS: [string, string][] = [
  ['web_portal', 'Can log in to web portal'], ['mobile_app', 'Can log in to salesman app'],
  ['settings', 'Company settings'], ['users', 'Users & roles'], ['masters', 'General masters'], ['products', 'Products'],
  ['prices', 'Customer / supplier prices'], ['customers', 'Customers'], ['suppliers', 'Suppliers'], ['stock', 'Stock adjust / take / transfer'],
  ['pos', 'Web POS'], ['sales_quote', 'Sales quote'], ['sales_order', 'Sales order'], ['sales_invoice', 'Sales invoice'],
  ['sales_delivery', 'Delivery order'], ['sales_return', 'Sales return'], ['receipts', 'Receipts'], ['purchase', 'Purchase'],
  ['payments', 'Supplier payments'], ['vouchers', 'Accounts & vouchers'], ['opening_balance', 'Opening balances'],
  ['void_docs', 'Void documents'], ['reports', 'Reports'],
];

export function Roles() {
  const toast = useToast();
  const { reload } = useAuth();
  const { data = [], refetch } = useQuery({
    queryKey: ['role_permissions'],
    queryFn: async () => (await supabase.from('role_permissions').select('*')).data ?? [],
  });
  const has = (area: string, role: string) => data.some((p: Row) => p.area === area && p.role === role);
  async function toggle(area: string, role: string) {
    if (role === 'ADMIN' && (area === 'users' || area === 'web_portal')) return toast('err', 'Admin must keep user management and portal access');
    const q = has(area, role)
      ? supabase.from('role_permissions').delete().eq('area', area).eq('role', role)
      : supabase.from('role_permissions').insert({ area, role });
    const { error } = await q;
    if (error) toast('err', errorMessage(error));
    refetch();
    reload();
  }
  return (
    <div>
      <PageHeader title="User Roles & Permissions" subtitle="Tick what each role may create / edit. Everyone signed in can view data (salesmen see only their own sales)." />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r} className="text-center">{r}</th>)}</tr></thead>
          <tbody>
            {AREAS.map(([a, label]) => (
              <tr key={a}>
                <td className="font-medium">{label}</td>
                {ROLES.map((r) => (
                  <td key={r} className="text-center"><input type="checkbox" className="h-4 w-4 cursor-pointer accent-ink-900" checked={has(a, r)} onChange={() => toggle(a, r)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
// Company settings & my account
// =====================================================================
export function Settings() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useSettings();
  const [s, setS] = useState<Row | null>(null);
  useEffect(() => { if (data) setS(data); }, [data]);
  if (!s) return <Loading />;
  const f = (k: string, label: string, type = 'text', cls = '') => (
    <Field label={label} className={cls}>
      {type === 'textarea'
        ? <textarea className="input" rows={3} value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
        : <input className="input" type={type} step="any" value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} />}
    </Field>
  );
  async function save() {
    const { id, updated_at, ...rest } = s!;
    void id; void updated_at;
    const { error } = await supabase.from('settings').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) return toast('err', errorMessage(error));
    toast('ok', 'Settings saved');
    qc.invalidateQueries();
  }
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Company Settings" actions={<button className="btn-primary" onClick={save}>Save</button>} />
      <div className="card grid gap-4 p-6 md:grid-cols-2">
        {f('company_name', 'Company name', 'text', 'md:col-span-2')}
        {f('address', 'Address', 'textarea', 'md:col-span-2')}
        {f('phone', 'Phone')}
        {f('email', 'Email')}
        {f('website', 'Website')}
        {f('tax_reg_no', 'GST registration no.')}
        {f('logo_url', 'Logo URL (shown on printouts)', 'text', 'md:col-span-2')}
        {f('currency', 'Base currency')}
        {f('tax_name', 'Tax name')}
        {f('tax_rate', 'Tax rate %', 'number')}
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={!!s.tax_inclusive} onChange={(e) => setS({ ...s, tax_inclusive: e.target.checked })} /> Selling prices include tax</label>
        {f('receipt_footer', 'POS receipt footer', 'textarea', 'md:col-span-2')}
        {f('invoice_terms', 'Invoice terms & conditions', 'textarea', 'md:col-span-2')}
      </div>
    </div>
  );
}

export function Account() {
  const toast = useToast();
  const { profile } = useAuth();
  const [pw, setPw] = useState('');
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="My account" subtitle={`${profile?.full_name} · ${profile?.role}`} />
      <div className="card space-y-4 p-6">
        <Field label="New password (min 8 characters)"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <button className="btn-primary" disabled={pw.length < 8} onClick={async () => {
          const { error } = await supabase.auth.updateUser({ password: pw });
          if (error) toast('err', error.message); else { toast('ok', 'Password changed'); setPw(''); }
        }}>Change password</button>
      </div>
    </div>
  );
}

// =====================================================================
// Customer / supplier price lists
// =====================================================================
export function PriceList({ kind }: { kind: 'customer' | 'supplier' }) {
  const toast = useToast();
  const table = kind === 'customer' ? 'customer_prices' : 'supplier_prices';
  const [party, setParty] = useState<Row | null>(null);
  const { data = [], refetch } = useQuery({
    queryKey: [table, party?.id],
    enabled: !!party,
    queryFn: async () => (await supabase.from(table).select('*, product:products(code, name, sell_price, cost_price)').eq(`${kind}_id`, party!.id).order('id')).data ?? [],
  });
  async function add(p: Row) {
    const { error } = await supabase.from(table).upsert({ [`${kind}_id`]: party!.id, product_id: p.id, price: kind === 'customer' ? p.sell_price : p.cost_price }, { onConflict: `${kind}_id,product_id` });
    if (error) toast('err', errorMessage(error));
    refetch();
  }
  async function setPrice(id: number, price: number) {
    const { error } = await supabase.from(table).update({ price }).eq('id', id);
    if (error) toast('err', errorMessage(error));
  }
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={kind === 'customer' ? 'Customer Price' : 'Supplier Price'} subtitle={kind === 'customer' ? 'Special selling prices per customer (used automatically on quotes, orders, invoices, POS and the salesman app)' : 'Agreed purchase prices per supplier (used automatically on purchase documents)'} />
      <div className="card mb-4 grid gap-3 p-4 md:grid-cols-2">
        <Field label={kind === 'customer' ? 'Customer' : 'Supplier'}><PartyPicker table={kind === 'customer' ? 'customers' : 'suppliers'} value={party} onChange={setParty} /></Field>
        {party && <Field label="Add product"><ProductPicker onPick={add} /></Field>}
      </div>
      {party && (
        <div className="card overflow-hidden">
          {!data.length ? <Empty>No special prices yet</Empty> : (
            <table className="table">
              <thead><tr><th>Product</th><th className="num">{kind === 'customer' ? 'List price' : 'Last cost'}</th><th className="w-40 num">Special price</th><th className="w-10" /></tr></thead>
              <tbody>
                {data.map((r: Row) => (
                  <tr key={r.id}>
                    <td>{r.product.code} · {r.product.name}</td>
                    <td className="num text-ink-400">{money(kind === 'customer' ? r.product.sell_price : r.product.cost_price)}</td>
                    <td><input type="number" step="any" min="0" className="input num py-1.5" defaultValue={r.price} onBlur={(e) => setPrice(r.id, Number(e.target.value))} /></td>
                    <td><button className="btn-ghost p-1.5 text-ink-300 hover:text-rose-600" onClick={async () => { await supabase.from(table).delete().eq('id', r.id); refetch(); }}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Data import (CSV)
// =====================================================================
const IMPORTS: Record<string, { label: string; table: string; columns: string[]; numeric: string[] }> = {
  products: { label: 'Products', table: 'products', columns: ['code', 'barcode', 'name', 'cost_price', 'sell_price', 'wholesale_price', 'min_stock'], numeric: ['cost_price', 'sell_price', 'wholesale_price', 'min_stock'] },
  customers: { label: 'Customers', table: 'customers', columns: ['code', 'name', 'contact_person', 'phone', 'email', 'address', 'terms_days', 'credit_limit'], numeric: ['terms_days', 'credit_limit'] },
  suppliers: { label: 'Suppliers', table: 'suppliers', columns: ['code', 'name', 'contact_person', 'phone', 'email', 'address', 'terms_days'], numeric: ['terms_days'] },
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function DataImport() {
  const toast = useToast();
  const [kind, setKind] = useState('products');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const cfg = IMPORTS[kind];

  function onFile(f: File) {
    f.text().then((t) => {
      const [header, ...data] = parseCsv(t);
      const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
      setRows(data.map((r) => {
        const o: Row = {};
        keys.forEach((k, i) => { if (cfg.columns.includes(k)) o[k] = cfg.numeric.includes(k) ? Number(r[i] || 0) : (r[i]?.trim() || null); });
        if (o.code) o.code = String(o.code).toUpperCase();
        return o;
      }).filter((o) => o.code && o.name));
    });
  }
  async function run() {
    setBusy(true);
    let done = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from(cfg.table).upsert(rows.slice(i, i + 200), { onConflict: 'code' });
      if (error) { toast('err', `Row ${i + 1}+: ${errorMessage(error)}`); break; }
      done += Math.min(200, rows.length - i);
    }
    toast('ok', `Imported ${done} ${cfg.label.toLowerCase()}`);
    setBusy(false);
    setRows([]);
  }
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(cfg.columns.join(',') + '\n')}`;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Data Import" subtitle="Bring products, customers or suppliers from Excel (save as CSV). Existing codes are updated." />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="Import"><select className="input w-48" value={kind} onChange={(e) => { setKind(e.target.value); setRows([]); }}>{Object.entries(IMPORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <a className="btn-secondary" href={template} download={`${kind}-template.csv`}>Download template</a>
        <label className="btn-primary cursor-pointer"><Upload size={15} /> Choose CSV<input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
        {rows.length > 0 && <button className="btn-gold" onClick={run} disabled={busy}>{busy ? 'Importing…' : `Import ${rows.length} rows`}</button>}
      </div>
      <p className="mb-3 text-xs text-ink-400">Columns: {cfg.columns.join(', ')}. Only <b>code</b> and <b>name</b> are required.</p>
      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table"><thead><tr>{cfg.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 100).map((r, i) => <tr key={i}>{cfg.columns.map((c) => <td key={c}>{r[c] ?? ''}</td>)}</tr>)}</tbody></table>
          {rows.length > 100 && <div className="p-3 text-xs text-ink-400">…and {rows.length - 100} more</div>}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Opening balances
// =====================================================================
export function OpeningBalances() {
  const toast = useToast();
  const qc = useQueryClient();
  const [type, setType] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  const [party, setParty] = useState<Row | null>(null);
  const [amount, setAmount] = useState(0);
  const [asOf, setAsOf] = useState(isoDate());
  const list = useTable('opening_balances', { build: (q) => q.order('id', { ascending: false }).limit(200) });
  const { data: names = {} } = useQuery({
    queryKey: ['ob-names', list.data?.items.length],
    queryFn: async () => {
      const [c, s] = await Promise.all([supabase.from('customers').select('id, name'), supabase.from('suppliers').select('id, name')]);
      return { CUSTOMER: Object.fromEntries((c.data ?? []).map((x) => [x.id, x.name])), SUPPLIER: Object.fromEntries((s.data ?? []).map((x) => [x.id, x.name])) } as Record<string, Record<number, string>>;
    },
  });
  async function save() {
    try {
      await rpc('create_opening_balance', { p_party_type: type, p_party_id: party!.id, p_amount: amount, p_as_of: asOf });
      toast('ok', 'Opening balance saved');
      setParty(null); setAmount(0);
      qc.invalidateQueries();
    } catch (e) { toast('err', (e as Error).message); }
  }
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Opening Balance" subtitle="Carry forward unpaid balances from your old system. Each entry becomes an invoice / GRN that can be paid normally." />
      <div className="card mb-4 grid items-end gap-3 p-4 md:grid-cols-5">
        <Field label="Type"><select className="input" value={type} onChange={(e) => { setType(e.target.value as 'CUSTOMER'); setParty(null); }}><option value="CUSTOMER">Customer</option><option value="SUPPLIER">Supplier</option></select></Field>
        <Field label={type === 'CUSTOMER' ? 'Customer' : 'Supplier'} className="md:col-span-2"><PartyPicker table={type === 'CUSTOMER' ? 'customers' : 'suppliers'} value={party} onChange={setParty} /></Field>
        <Field label="Amount"><input type="number" step="any" min="0" className="input num" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <Field label="As of"><input type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <button className="btn-primary md:col-start-5" disabled={!party || !(amount > 0)} onClick={save}>Add balance</button>
      </div>
      <div className="card overflow-hidden">
        {!list.data?.items.length ? <Empty>No opening balances</Empty> : (
          <table className="table"><thead><tr><th>Type</th><th>Party</th><th>As of</th><th className="num">Amount</th><th>Document</th></tr></thead>
            <tbody>{list.data.items.map((o) => (
              <tr key={o.id}><td>{o.party_type}</td><td>{names[o.party_type]?.[o.party_id]}</td><td>{dateFmt(o.as_of)}</td><td className="num">{money(o.amount)}</td>
                <td><Link className="text-gold-600" to={`${o.party_type === 'CUSTOMER' ? '/sales' : '/purchase'}/doc/${o.doc_id}`}>View</Link></td></tr>
            ))}</tbody></table>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// POS settlements
// =====================================================================
export function PosSessions() {
  const [view, setView] = useState<number | null>(null);
  const list = useTable('cash_sessions', {
    select: '*, user:profiles(full_name), location:locations(name)',
    build: (q) => q.order('id', { ascending: false }).limit(200),
  });
  const { data: sum } = useQuery({ queryKey: ['settle', view], enabled: !!view, queryFn: () => rpc<Row>('pos_session_summary', { p_session: view }) });
  return (
    <div>
      <PageHeader title="POS Settlements" subtitle="Cash register shifts with expected vs counted cash" />
      <div className="card overflow-hidden">
        {list.isLoading ? <Loading /> : !list.data?.items.length ? <Empty /> : (
          <table className="table">
            <thead><tr><th>#</th><th>Cashier</th><th>Location</th><th>Opened</th><th>Closed</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Diff</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((s) => {
                const diff = s.counted_cash != null ? s.counted_cash - s.expected_cash : null;
                return (
                  <tr key={s.id} className="cursor-pointer" onClick={() => setView(s.id)}>
                    <td>{s.id}</td><td>{s.user?.full_name}</td><td>{s.location?.name}</td>
                    <td>{dateTimeFmt(s.opened_at)}</td><td>{s.closed_at ? dateTimeFmt(s.closed_at) : <Badge color="green">Open</Badge>}</td>
                    <td className="num">{s.expected_cash != null ? money(s.expected_cash) : ''}</td>
                    <td className="num">{s.counted_cash != null ? money(s.counted_cash) : ''}</td>
                    <td className={`num font-medium ${diff && Math.abs(diff) > 0.004 ? 'text-rose-600' : ''}`}>{diff != null ? money(diff) : ''}</td>
                    <td className="text-xs text-gold-600">View</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={!!view} onClose={() => setView(null)} title={`Settlement #${view}`} footer={<button className="btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>}>
        {sum ? <SettlementReport sum={sum} /> : <Loading />}
      </Modal>
    </div>
  );
}
