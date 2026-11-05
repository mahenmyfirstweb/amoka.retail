import { ExportButtons } from '../components/ExportButtons';
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { rpc, supabase } from '../lib/supabase';
import { useLookup, usePaymodes, useSettings, type Row } from '../lib/data';
import { dateFmt, isoDate, money } from '../lib/format';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../components/ui';

function ReportTitle({ title, sub }: { title: string; sub: string }) {
  const { data: s } = useSettings();
  return (
    <div className="mb-3 hidden print:block">
      <div className="font-display text-xl font-bold">{s?.company_name}</div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-ink-500">{sub} · printed {new Date().toLocaleString()}</div>
    </div>
  );
}

function useSalesmen() {
  return useQuery({
    queryKey: ['salesmen-all'],
    queryFn: async () => (await supabase.from('profiles').select('id, full_name').order('full_name')).data ?? [],
  });
}

// =====================================================================
// 1. Customer outstanding
// =====================================================================
export function CustomerOutstandingReport() {
  const { data: areas } = useLookup('areas');
  const { data: salesmen } = useSalesmen();
  const [asOf, setAsOf] = useState(isoDate());
  const [salesman, setSalesman] = useState('');
  const [area, setArea] = useState('');
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['rep-cust-out', asOf, salesman, area],
    queryFn: () => rpc<Row[]>('report_customer_outstanding', { p_as_of: asOf, p_salesman: salesman || null, p_area: area ? Number(area) : null }),
  });
  const sum = (k: string) => data.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return (
    <div>
      <PageHeader title="Customer Outstanding Report" subtitle="Invoices − returns − receipts, per customer" actions={<ExportButtons title="Customer Outstanding Report" subtitle={`As of ${asOf}`} landscape />} />
      <div className="card overflow-hidden" data-report>
        <div className="no-print flex flex-wrap items-end gap-3 border-b border-ink-100 p-3">
          <Field label="As of"><input type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
          <Field label="Salesman">
            <select className="input w-48" value={salesman} onChange={(e) => setSalesman(e.target.value)}>
              <option value="">All</option>{salesmen?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </Field>
          <Field label="Area">
            <select className="input w-40" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">All</option>{areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="px-4 pt-3"><ReportTitle title="Customer Outstanding Report" sub={`As of ${dateFmt(asOf)}`} /></div>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data.length ? <Empty>No outstanding balances</Empty> : (
          <table className="table">
            <thead><tr><th>Customer</th><th>Area</th><th>Salesman</th><th className="num">Invoiced</th><th className="num">Returns</th><th className="num">Received</th><th className="num">Outstanding</th><th className="num">Overdue</th><th className="no-print" /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.customer_id}>
                  <td><div className="font-medium text-ink-900">{r.name}</div><div className="text-xs text-ink-400">{r.code}{r.phone ? ` · ${r.phone}` : ''}</div></td>
                  <td>{r.area}</td>
                  <td>{r.salesman}</td>
                  <td className="num">{money(r.invoiced)}</td>
                  <td className="num">{money(r.returned)}</td>
                  <td className="num">{money(r.received)}</td>
                  <td className="num font-semibold">{money(r.balance)}</td>
                  <td className={`num ${Number(r.overdue) > 0 ? 'font-medium text-rose-600' : ''}`}>{Number(r.overdue) ? money(r.overdue) : ''}</td>
                  <td className="no-print"><Link className="text-xs font-medium text-gold-600" to={`/statement?customer=${r.customer_id}`}>Statement</Link></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="font-semibold"><td className="px-3 py-2.5" colSpan={3}>Total ({data.length} customers)</td>
              <td className="num px-3">{money(sum('invoiced'))}</td><td className="num px-3">{money(sum('returned'))}</td><td className="num px-3">{money(sum('received'))}</td>
              <td className="num px-3">{money(sum('balance'))}</td><td className="num px-3">{money(sum('overdue'))}</td><td /></tr></tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// 3. Receipt report
// =====================================================================
export function ReceiptReport() {
  const { data: paymodes } = usePaymodes();
  const { data: salesmen } = useSalesmen();
  const [from, setFrom] = useState(isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(isoDate());
  const [paymode, setPaymode] = useState('');
  const [user, setUser] = useState('');
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['rep-receipts', from, to, paymode, user],
    queryFn: async () => {
      let q = supabase.from('receipts')
        .select('id, receipt_no, receipt_date, amount, reference, cheque_no, status, customer:customers(name), paymode:paymodes(name), user:profiles(full_name), allocations:receipt_allocations(amount, doc:sales_docs(doc_no))')
        .gte('receipt_date', `${from}T00:00:00`).lte('receipt_date', `${to}T23:59:59`).eq('status', 'ACTIVE').order('receipt_date');
      if (paymode) q = q.eq('paymode_id', Number(paymode));
      if (user) q = q.eq('user_id', user);
      const { data, error } = await q.limit(5000);
      if (error) throw new Error(error.message);
      return data as Row[];
    },
  });
  const total = data.reduce((s, r) => s + Number(r.amount), 0);
  const byPaymode = Object.entries(data.reduce<Record<string, number>>((m, r) => ({ ...m, [r.paymode?.name]: (m[r.paymode?.name] ?? 0) + Number(r.amount) }), {}));
  return (
    <div>
      <PageHeader title="Receipt Report" subtitle="Payments received from customers" actions={<ExportButtons title="Receipt Report" subtitle={`${from} to ${to}`} landscape />} />
      <div className="card overflow-hidden" data-report>
        <div className="no-print flex flex-wrap items-end gap-3 border-b border-ink-100 p-3">
          <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Paymode"><select className="input w-40" value={paymode} onChange={(e) => setPaymode(e.target.value)}><option value="">All</option>{paymodes?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Collected by"><select className="input w-48" value={user} onChange={(e) => setUser(e.target.value)}><option value="">All</option>{salesmen?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
        </div>
        <div className="px-4 pt-3"><ReportTitle title="Receipt Report" sub={`${dateFmt(from)} – ${dateFmt(to)}`} /></div>
        {byPaymode.length > 0 && (
          <div className="flex flex-wrap gap-3 border-b border-ink-100 p-3">
            {byPaymode.map(([n, a]) => <div key={n} className="rounded-xl bg-ink-50 px-4 py-2 text-sm"><span className="text-ink-500">{n}</span> <b className="tabular-nums">{money(a)}</b></div>)}
            <div className="rounded-xl bg-ink-900 px-4 py-2 text-sm text-white">Total <b className="tabular-nums">{money(total)}</b></div>
          </div>
        )}
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data.length ? <Empty>No receipts in this period</Empty> : (
          <table className="table">
            <thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Paymode</th><th>Reference</th><th>For invoices</th><th>By</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td><Link className="font-medium hover:text-gold-600" to={`/receipts/${r.id}`}>{r.receipt_no}</Link></td>
                  <td>{dateFmt(r.receipt_date)}</td>
                  <td>{r.customer?.name ?? 'Walk-in'}</td>
                  <td>{r.paymode?.name}</td>
                  <td>{[r.reference, r.cheque_no && `Chq ${r.cheque_no}`].filter(Boolean).join(' · ')}</td>
                  <td className="text-xs text-ink-500">{r.allocations.map((a: Row) => a.doc.doc_no).join(', ')}</td>
                  <td>{r.user?.full_name}</td>
                  <td className="num font-medium">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="font-semibold"><td colSpan={7} className="px-3 py-2.5">Total ({data.length} receipts)</td><td className="num px-3">{money(total)}</td></tr></tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// 2b. Invoice list (used as a tab of the Sales Report)
// =====================================================================
export function InvoiceRegister({ from, to, location }: { from: string; to: string; location: string }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['rep-invoices', from, to, location],
    queryFn: async () => {
      let q = supabase.from('sales_docs')
        .select('id, doc_no, type, doc_date, subtotal, tax, total, paid, credited, is_pos, customer:customers(name), user:profiles(full_name)')
        .in('type', ['INVOICE', 'RETURN']).neq('status', 'VOID')
        .gte('doc_date', `${from}T00:00:00`).lte('doc_date', `${to}T23:59:59`).order('doc_date');
      if (location) q = q.eq('location_id', Number(location));
      const { data, error } = await q.limit(5000);
      if (error) throw new Error(error.message);
      return data as Row[];
    },
  });
  const s = (k: string) => data.reduce((a, r) => a + (r.type === 'RETURN' ? -1 : 1) * Number(r[k]), 0);
  if (isLoading) return <Loading />;
  if (error) return <div className="p-4"><ErrorBox error={error} /></div>;
  if (!data.length) return <Empty>No invoices in this period</Empty>;
  return (
    <table className="table">
      <thead><tr><th>No.</th><th>Date</th><th>Customer</th><th>Salesperson</th><th className="num">Before tax</th><th className="num">Tax</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
      <tbody>
        {data.map((r) => {
          const sign = r.type === 'RETURN' ? -1 : 1;
          return (
            <tr key={r.id} className={r.type === 'RETURN' ? 'text-rose-700' : ''}>
              <td><Link className="font-medium hover:text-gold-600" to={`/sales/doc/${r.id}`}>{r.doc_no}</Link>{r.type === 'RETURN' && <span className="ml-1 text-[10px] font-semibold">RETURN</span>}{r.is_pos && <span className="ml-1 text-[10px] font-semibold text-gold-600">POS</span>}</td>
              <td>{dateFmt(r.doc_date)}</td>
              <td>{r.customer?.name ?? 'Walk-in'}</td>
              <td>{r.user?.full_name}</td>
              <td className="num">{money(sign * r.subtotal)}</td>
              <td className="num">{money(sign * r.tax)}</td>
              <td className="num font-medium">{money(sign * r.total)}</td>
              <td className="num">{r.type === 'INVOICE' ? money(r.total - r.paid - r.credited) : ''}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot><tr className="font-semibold"><td colSpan={4} className="px-3 py-2.5">Net total</td><td className="num px-3">{money(s('subtotal'))}</td><td className="num px-3">{money(s('tax'))}</td><td className="num px-3">{money(s('total'))}</td><td /></tr></tfoot>
    </table>
  );
}
