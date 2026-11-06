/** Accounts: salesman expense claims (approve / reject / mark refunded) and diesel / fuel report. */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, Wallet, XCircle } from 'lucide-react';
import { supabase, rpc } from '../lib/supabase';
import type { Row } from '../lib/data';
import { dateFmt, dateTimeFmt, isoDate, money } from '../lib/format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Tabs, useToast } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';

const CATS: Record<string, string> = {
  TOPUP: 'Transport card top-up', FUEL: 'Fuel', PARKING: 'Parking / ERP', STATIONERY: 'Stationery',
  MEALS: 'Meals', PHONE: 'Phone / data', OTHER: 'Other',
};
const STATUS_COLOR: Record<string, 'gold' | 'blue' | 'green' | 'red'> = { SUBMITTED: 'gold', APPROVED: 'blue', PAID: 'green', REJECTED: 'red' };

function monthRange(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${m}-01`, to: isoDate(new Date(y, mo, 0)) };
}

function useStaff() {
  return useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await supabase.from('profiles').select('id, full_name').order('full_name')).data ?? [],
  });
}

function ReceiptModal({ path, title, onClose }: { path: string | null; title: string; onClose: () => void }) {
  const { data: url, isLoading } = useQuery({
    queryKey: ['receipt-url', path],
    enabled: !!path,
    queryFn: async () => (await supabase.storage.from('expense-receipts').createSignedUrl(path!, 3600)).data?.signedUrl ?? null,
  });
  return (
    <Modal open={!!path} onClose={onClose} title={title} size="lg">
      {isLoading ? <Loading /> : !url ? <Empty>Receipt not found</Empty> : path?.endsWith('.pdf')
        ? <a className="btn-primary" href={url} target="_blank" rel="noreferrer">Open PDF</a>
        : <img src={url} alt="receipt" className="mx-auto max-h-[65vh] rounded-lg object-contain" />}
    </Modal>
  );
}

// =====================================================================
// Expense claims
// =====================================================================
export function ExpenseClaims() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: staff } = useStaff();
  const [month, setMonth] = useState(isoDate().slice(0, 7));
  const [user, setUser] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [action, setAction] = useState<null | 'REJECTED' | 'PAID'>(null);
  const [note, setNote] = useState('');

  const { data = [], isLoading, error } = useQuery({
    queryKey: ['claims', month, user, status],
    queryFn: async () => {
      const { from, to } = monthRange(month);
      let q = supabase.from('expense_claims').select('*, user:profiles!expense_claims_user_id_fkey(full_name)').gte('claim_date', from).lte('claim_date', to).order('claim_date');
      if (user) q = q.eq('user_id', user);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data as Row[];
    },
  });

  const bySalesman = useMemo(() => {
    const m = new Map<string, { name: string; submitted: number; approved: number; paid: number; rejected: number }>();
    for (const c of data) {
      const e = m.get(c.user_id) ?? { name: c.user?.full_name ?? '—', submitted: 0, approved: 0, paid: 0, rejected: 0 };
      if (c.status === 'SUBMITTED') e.submitted += Number(c.amount);
      if (c.status === 'APPROVED') e.approved += Number(c.amount);
      if (c.status === 'PAID') e.paid += Number(c.amount);
      if (c.status === 'REJECTED') e.rejected += Number(c.amount);
      m.set(c.user_id, e);
    }
    return [...m.values()];
  }, [data]);
  const toRefund = data.filter((c) => c.status === 'APPROVED').reduce((s, c) => s + Number(c.amount), 0);

  async function review(st: 'APPROVED' | 'REJECTED' | 'PAID', ids = [...sel], n?: string, ref?: string) {
    if (!ids.length) return toast('err', 'Select claims first');
    try {
      const count = await rpc<number>('review_expense_claims', { p_ids: ids, p_status: st, p_note: n ?? null, p_ref: ref ?? null });
      toast('ok', `${count} claim(s) ${st === 'PAID' ? 'marked refunded' : st.toLowerCase()}`);
      setSel(new Set());
      setAction(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['claims'] });
    } catch (e) {
      toast('err', (e as Error).message);
    }
  }
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div>
      <PageHeader title="Expense Claims" subtitle={`Approved, waiting for refund: SGD ${money(toRefund)}`} actions={<ExportButtons title="Expense Claims" subtitle={month} landscape />} />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3 no-print">
        <Field label="Month"><input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Salesman"><select className="input w-48" value={user} onChange={(e) => setUser(e.target.value)}><option value="">All</option>{staff?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
        <Field label="Status"><select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="SUBMITTED">Submitted</option><option value="APPROVED">Approved</option><option value="PAID">Refunded</option><option value="REJECTED">Rejected</option></select></Field>
        <div className="flex-1" />
        <button className="btn-secondary" disabled={!sel.size} onClick={() => review('APPROVED')}><CheckCircle2 size={15} className="text-sky-600" /> Approve ({sel.size})</button>
        <button className="btn-secondary" disabled={!sel.size} onClick={() => setAction('REJECTED')}><XCircle size={15} className="text-rose-600" /> Reject</button>
        <button className="btn-gold" disabled={!sel.size} onClick={() => setAction('PAID')}><Wallet size={15} /> Mark refunded</button>
      </div>

      {bySalesman.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 no-print">
          {bySalesman.map((s) => (
            <div key={s.name} className="card p-4">
              <div className="font-semibold text-ink-900">{s.name}</div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                <div><div className="text-ink-400">Waiting</div><div className="font-semibold tabular-nums">{money(s.submitted)}</div></div>
                <div><div className="text-ink-400">To refund</div><div className="font-semibold tabular-nums text-sky-700">{money(s.approved)}</div></div>
                <div><div className="text-ink-400">Refunded</div><div className="font-semibold tabular-nums text-emerald-700">{money(s.paid)}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden" data-report>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data.length ? <Empty>No claims for this month</Empty> : (
          <table className="table">
            <thead>
              <tr>
                <th className="no-print w-8"><input type="checkbox" checked={sel.size === data.length} onChange={(e) => setSel(e.target.checked ? new Set(data.map((c) => c.id)) : new Set())} /></th>
                <th>Claim</th><th>Date</th><th>Salesman</th><th>Type</th><th>Description</th><th>Paid by</th><th className="num">Amount</th><th>Status</th><th className="no-print">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="no-print"><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} disabled={c.status === 'PAID'} /></td>
                  <td className="font-medium">{c.claim_no}</td>
                  <td>{dateFmt(c.claim_date)}</td>
                  <td>{c.user?.full_name}</td>
                  <td>{CATS[c.category] ?? c.category}</td>
                  <td className="max-w-xs">{c.description}{c.review_note && <div className="text-xs text-ink-400">Note: {c.review_note}</div>}{c.paid_ref && <div className="text-xs text-emerald-700">Ref: {c.paid_ref}</div>}</td>
                  <td>{String(c.paid_by).toLowerCase()}</td>
                  <td className="num font-medium">{money(c.amount)}</td>
                  <td><Badge color={STATUS_COLOR[c.status]}>{c.status === 'PAID' ? 'Refunded' : c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge></td>
                  <td className="no-print">{c.receipt_path && <button className="btn-ghost btn-sm" onClick={() => setReceipt(c)}><Eye size={14} /> View</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold"><td className="no-print" /><td colSpan={6} className="px-3 py-2.5">Total ({data.length} claims, excluding rejected)</td>
                <td className="num px-3">{money(data.filter((c) => c.status !== 'REJECTED').reduce((s, c) => s + Number(c.amount), 0))}</td><td /><td className="no-print" /></tr>
            </tfoot>
          </table>
        )}
      </div>

      <ReceiptModal path={receipt?.receipt_path ?? null} title={`${receipt?.claim_no ?? ''} · ${receipt?.user?.full_name ?? ''} · SGD ${money(receipt?.amount)}`} onClose={() => setReceipt(null)} />
      <Modal open={!!action} onClose={() => setAction(null)} title={action === 'PAID' ? `Mark ${sel.size} claim(s) as refunded` : `Reject ${sel.size} claim(s)`} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setAction(null)}>Cancel</button><button className={action === 'PAID' ? 'btn-gold' : 'btn-danger'} onClick={() => review(action!, [...sel], action === 'REJECTED' ? note : undefined, action === 'PAID' ? note : undefined)}>Confirm</button></>}>
        <Field label={action === 'PAID' ? 'Refund reference (bank transfer / voucher no.)' : 'Reason for rejecting *'}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </div>
  );
}

// =====================================================================
// Diesel / fuel report
// =====================================================================
export function FuelReport() {
  const [month, setMonth] = useState(isoDate().slice(0, 7));
  const [tab, setTab] = useState('logs');
  const [receipt, setReceipt] = useState<Row | null>(null);
  const { from, to } = monthRange(month);
  const summary = useQuery({ queryKey: ['fuel-report', from, to], enabled: tab === 'vehicle', queryFn: () => rpc<Row[]>('report_fuel', { p_from: from, p_to: to }) });
  const logs = useQuery({ queryKey: ['fuel-logs', from, to], enabled: tab !== 'vehicle', queryFn: () => rpc<Row[]>('report_fuel_logs', { p_from: from, p_to: to }) });

  const bySalesman = useMemo(() => {
    const m = new Map<string, { name: string; fills: number; litres: number; amount: number; km: number; kmLitres: number }>();
    for (const l of logs.data ?? []) {
      const e = m.get(l.user_id) ?? { name: l.driver ?? '—', fills: 0, litres: 0, amount: 0, km: 0, kmLitres: 0 };
      e.fills += 1;
      e.litres += Number(l.litres);
      e.amount += Number(l.amount);
      if (l.km) {
        e.km += Number(l.km);
        e.kmLitres += Number(l.litres);
      }
      m.set(l.user_id, e);
    }
    return [...m.values()].sort((a, b) => b.km - a.km);
  }, [logs.data]);

  const s = summary.data ?? [];
  const L = logs.data ?? [];
  const tot = (rows: Row[]) =>
    rows.reduce(
      (a, r) => ({ fills: a.fills + Number(r.fills ?? 1), litres: a.litres + Number(r.litres), amount: a.amount + Number(r.amount), km: a.km + Number(r.km ?? 0) }),
      { fills: 0, litres: 0, amount: 0, km: 0 },
    );
  const tl = tot(L);
  const ts = tot(s);
  const days = (d: unknown) => (d === null || d === undefined ? '' : `${Number(d) % 1 === 0 ? Number(d) : Number(d).toFixed(1)} d`);
  const tabName = tab === 'logs' ? 'top-ups & km' : tab === 'salesman' ? 'by salesman' : 'by vehicle';

  return (
    <div>
      <PageHeader
        title="Diesel / Fuel Report"
        subtitle="Km driven between top-ups (from odometer readings), litres and proof"
        actions={<ExportButtons title={`Fuel report - ${tabName}`} subtitle={month} landscape />}
      />
      <div className="no-print flex flex-wrap items-end gap-3">
        <Tabs tabs={[{ key: 'logs', label: 'Top-ups & km driven' }, { key: 'salesman', label: 'By salesman' }, { key: 'vehicle', label: 'By vehicle' }]} value={tab} onChange={setTab} />
        <div className="mb-4"><input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      </div>
      <div className="card overflow-hidden" data-report>
        {tab === 'vehicle' ? (
          summary.isLoading ? <Loading /> : summary.error ? <div className="p-4"><ErrorBox error={summary.error} /></div> : !s.length ? <Empty>No top-ups this month</Empty> : (
            <table className="table">
              <thead><tr><th>Vehicle</th><th>Model</th><th className="num">Top-ups</th><th className="num">Litres</th><th className="num">Amount</th><th className="num">Avg $/L</th><th className="num">Km driven</th><th className="num">Km / L</th></tr></thead>
              <tbody>
                {s.map((r) => (
                  <tr key={r.vehicle_id}>
                    <td className="font-medium">{r.vehicle}</td>
                    <td>{r.name}</td>
                    <td className="num">{r.fills}</td>
                    <td className="num">{Number(r.litres).toFixed(2)}</td>
                    <td className="num font-medium">{money(r.amount)}</td>
                    <td className="num">{r.avg_price ? Number(r.avg_price).toFixed(3) : ''}</td>
                    <td className="num">{r.km ? Number(r.km).toLocaleString() : ''}</td>
                    <td className="num">{r.km_per_litre ?? ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={2} className="px-3 py-2.5">Total</td>
                  <td className="num px-3">{ts.fills}</td>
                  <td className="num px-3">{ts.litres.toFixed(2)}</td>
                  <td className="num px-3">{money(ts.amount)}</td>
                  <td />
                  <td className="num px-3">{ts.km.toLocaleString()}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )
        ) : logs.isLoading ? <Loading /> : logs.error ? <div className="p-4"><ErrorBox error={logs.error} /></div> : !L.length ? <Empty>No top-ups this month</Empty> : tab === 'salesman' ? (
          <table className="table">
            <thead><tr><th>Salesman</th><th className="num">Top-ups</th><th className="num">Litres</th><th className="num">Amount</th><th className="num">Km driven</th><th className="num">Avg km / L</th></tr></thead>
            <tbody>
              {bySalesman.map((r) => (
                <tr key={r.name}>
                  <td className="font-medium">{r.name}</td>
                  <td className="num">{r.fills}</td>
                  <td className="num">{r.litres.toFixed(2)}</td>
                  <td className="num">{money(r.amount)}</td>
                  <td className="num font-semibold">{r.km.toLocaleString()}</td>
                  <td className="num">{r.kmLitres ? (r.km / r.kmLitres).toFixed(2) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-3 py-2.5">Total</td>
                <td className="num px-3">{tl.fills}</td>
                <td className="num px-3">{tl.litres.toFixed(2)}</td>
                <td className="num px-3">{money(tl.amount)}</td>
                <td className="num px-3">{tl.km.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>No.</th><th>Date &amp; time</th><th>Vehicle</th><th>Salesman</th><th className="num">Litres</th><th className="num">Amount</th>
                <th className="num">Odometer</th><th>Previous top-up</th><th className="num">Prev. odometer</th><th className="num">Km driven</th>
                <th className="num">Days</th><th className="num">Km / L</th><th>Station</th><th className="no-print">Proof</th>
              </tr>
            </thead>
            <tbody>
              {L.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.log_no}</td>
                  <td className="whitespace-nowrap">{dateTimeFmt(l.filled_at)}</td>
                  <td>{l.vehicle}</td>
                  <td>{l.driver}</td>
                  <td className="num">{Number(l.litres).toFixed(2)}</td>
                  <td className="num">{Number(l.amount) > 0 ? money(l.amount) : '—'}</td>
                  <td className="num">{l.odometer ? Number(l.odometer).toLocaleString() : '—'}</td>
                  <td className="whitespace-nowrap">{l.prev_filled_at ? dateFmt(l.prev_filled_at) : 'first'}</td>
                  <td className="num">{l.prev_odometer ? Number(l.prev_odometer).toLocaleString() : ''}</td>
                  <td className={`num font-semibold ${l.km ? 'text-ink-900' : 'text-ink-300'}`}>{l.km ? Number(l.km).toLocaleString() : l.odometer ? '' : 'no reading'}</td>
                  <td className="num">{days(l.days)}</td>
                  <td className="num">{l.km_per_litre ?? ''}</td>
                  <td>{l.station}</td>
                  <td className="no-print">{l.receipt_path && <button className="btn-ghost btn-sm" onClick={() => setReceipt(l)}><Eye size={14} /> View</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={4} className="px-3 py-2.5">Total ({L.length} top-ups)</td>
                <td className="num px-3">{tl.litres.toFixed(2)}</td>
                <td className="num px-3">{money(tl.amount)}</td>
                <td colSpan={3} />
                <td className="num px-3">{tl.km.toLocaleString()}</td>
                <td colSpan={3} />
                <td className="no-print" />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="no-print mt-3 text-xs text-ink-400">
        Km driven = this odometer − the previous top-up of the same vehicle that has an odometer reading. Km / L = km driven ÷ litres filled this time.
      </p>
      <ReceiptModal
        path={receipt?.receipt_path ?? null}
        title={`${receipt?.log_no ?? ''} · ${receipt?.vehicle ?? ''} · ${receipt ? Number(receipt.litres).toFixed(2) : ''} L`}
        onClose={() => setReceipt(null)}
      />
    </div>
  );
}
