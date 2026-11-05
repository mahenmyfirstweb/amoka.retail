import { ExportButtons } from '../components/ExportButtons';
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { rpc, supabase } from '../lib/supabase';
import { useLookup, useSettings, type Row } from '../lib/data';
import { dateFmt, isoDate, money, qtyFmt } from '../lib/format';
import { Empty, ErrorBox, Field, Loading, PageHeader, Tabs } from '../components/ui';
import { PartyPicker } from '../components/Pickers';
import { CompanyHeader } from './docs/DocView';
import { InvoiceRegister } from './Reports2';

function monthStart() {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function SalesReport({ profit }: { profit?: boolean }) {
  const { data: locations } = useLookup('locations');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDate());
  const [group, setGroup] = useState(profit ? 'product' : 'day');
  const [loc, setLoc] = useState('');
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['report-sales', from, to, group, loc],
    enabled: group !== 'invoices',
    queryFn: () => rpc<Row[]>('report_sales', { p_from: from, p_to: to, p_group: group, p_location: loc ? Number(loc) : null }),
  });
  const tot = data.reduce((t, r) => ({ qty: t.qty + Number(r.qty), amount: t.amount + Number(r.amount), cost: t.cost + Number(r.cost), profit: t.profit + Number(r.profit), invoices: t.invoices + Number(r.invoices) }), { qty: 0, amount: 0, cost: 0, profit: 0, invoices: 0 });

  return (
    <div>
      <PageHeader title={profit ? 'Profit Analysis' : 'Sales Report'} subtitle="Net of returns, excluding tax" actions={<ExportButtons title={`${profit ? "Profit Analysis" : "Sales Report"} - ${group}`} subtitle={`${from} to ${to}`} />} />
      <div className="no-print">
        <Tabs
          tabs={[...(profit ? [] : [{ key: 'invoices', label: 'Invoice list' }]), { key: 'day', label: 'By day' }, { key: 'product', label: 'By product' }, { key: 'category', label: 'By category' }, { key: 'customer', label: 'By customer' }, { key: 'salesman', label: 'By salesman' }]}
          value={group}
          onChange={setGroup}
        />
      </div>
      <div className="card overflow-hidden" data-report>
        <div className="no-print flex flex-wrap items-end gap-3 border-b border-ink-100 p-3">
          <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Location">
            <select className="input w-48" value={loc} onChange={(e) => setLoc(e.target.value)}>
              <option value="">All locations</option>
              {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="hidden p-4 text-sm print:block">{profit ? 'Profit Analysis' : 'Sales Report'} · {dateFmt(from)} – {dateFmt(to)}</div>
        {group === 'invoices' ? <InvoiceRegister from={from} to={to} location={loc} /> : isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data.length ? <Empty>No sales in this period</Empty> : (
          <table className="table">
            <thead>
              <tr>
                <th>{group === 'day' ? 'Date' : group.charAt(0).toUpperCase() + group.slice(1)}</th>
                {group !== 'product' && <th className="num">Invoices</th>}
                <th className="num">Qty</th>
                <th className="num">Sales</th>
                {profit && <><th className="num">Cost</th><th className="num">Profit</th><th className="num">Margin</th></>}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.key}>
                  <td>{group === 'day' ? dateFmt(r.label) : r.label}</td>
                  {group !== 'product' && <td className="num">{r.invoices}</td>}
                  <td className="num">{qtyFmt(r.qty)}</td>
                  <td className="num font-medium">{money(r.amount)}</td>
                  {profit && (
                    <>
                      <td className="num">{money(r.cost)}</td>
                      <td className={`num font-medium ${r.profit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{money(r.profit)}</td>
                      <td className="num">{Number(r.amount) ? `${((Number(r.profit) / Number(r.amount)) * 100).toFixed(1)}%` : '—'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-3 py-2.5">Total</td>
                {group !== 'product' && <td className="num px-3">{tot.invoices}</td>}
                <td className="num px-3">{qtyFmt(tot.qty)}</td>
                <td className="num px-3">{money(tot.amount)}</td>
                {profit && <><td className="num px-3">{money(tot.cost)}</td><td className="num px-3">{money(tot.profit)}</td><td className="num px-3">{tot.amount ? `${((tot.profit / tot.amount) * 100).toFixed(1)}%` : '—'}</td></>}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

export function AgingReport({ kind }: { kind: 'CUSTOMER' | 'SUPPLIER' }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['aging', kind],
    queryFn: () => rpc<Row[]>('report_aging', { p_kind: kind }),
  });
  const cols = [['current_amt', 'Current'], ['d30', '1–30'], ['d60', '31–60'], ['d90', '61–90'], ['over90', '90+'], ['total', 'Total']] as const;
  const sum = (k: string) => data.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return (
    <div>
      <PageHeader title={kind === 'CUSTOMER' ? 'Account Receivable' : 'Account Payable'} subtitle="Outstanding by age (days past due date)" actions={<ExportButtons title={kind === "CUSTOMER" ? "Account Receivable Aging" : "Account Payable Aging"} subtitle={`As of ${new Date().toLocaleDateString()}`} />} />
      <div className="card overflow-hidden" data-report>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data.length ? <Empty>Nothing outstanding 🎉</Empty> : (
          <table className="table">
            <thead><tr><th>{kind === 'CUSTOMER' ? 'Customer' : 'Supplier'}</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="no-print" /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.party_id}>
                  <td className="font-medium">{r.name}</td>
                  {cols.map(([k]) => <td key={k} className={`num ${k === 'total' ? 'font-semibold' : ''} ${['d60', 'd90', 'over90'].includes(k) && Number(r[k]) ? 'text-rose-600' : ''}`}>{r[k] ? money(r[k]) : ''}</td>)}
                  <td className="no-print">
                    {kind === 'CUSTOMER'
                      ? <Link className="text-xs font-medium text-gold-600" to={`/statement?customer=${r.party_id}`}>Statement</Link>
                      : <Link className="text-xs font-medium text-gold-600" to={`/payments/new?supplier=${r.party_id}`}>Pay</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="font-semibold"><td className="px-3 py-2.5">Total</td>{cols.map(([k]) => <td key={k} className="num px-3">{money(sum(k))}</td>)}<td /></tr></tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

export function CustomerStatement() {
  const { data: settings } = useSettings();
  const params = new URLSearchParams(location.search);
  const [customer, setCustomer] = useState<Row | null>(params.get('customer') ? { id: Number(params.get('customer')), name: '…' } : null);
  const [from, setFrom] = useState(isoDate(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(isoDate());
  const { data: cust } = useQuery({
    queryKey: ['cust', customer?.id],
    enabled: !!customer,
    queryFn: async () => (await supabase.from('customers').select('*').eq('id', customer!.id).single()).data,
  });
  const { data = [], isLoading } = useQuery({
    queryKey: ['statement', customer?.id, from, to],
    enabled: !!customer,
    queryFn: () => rpc<Row[]>('customer_statement', { p_customer: customer!.id, p_from: from, p_to: to }),
  });
  const closing = data.length ? Number(data[data.length - 1].balance) : 0;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Customer Statement" actions={customer && <ExportButtons title={`Statement - ${cust?.name ?? ""}`} subtitle={`${from} to ${to}`} landscape={false} />} />
      <div className="card no-print mb-4 grid gap-3 p-4 md:grid-cols-4">
        <Field label="Customer" className="md:col-span-2"><PartyPicker table="customers" value={cust ?? customer} onChange={setCustomer} /></Field>
        <Field label="From"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {customer && (
        <div className="card print-area p-8" data-report>
          <CompanyHeader settings={settings} title="STATEMENT" />
          <div className="mt-5 flex justify-between text-sm">
            <div><div className="font-semibold text-ink-900">{cust?.name}</div><div className="whitespace-pre-line text-ink-500">{cust?.address}</div></div>
            <div className="text-right text-ink-500">{dateFmt(from)} – {dateFmt(to)}</div>
          </div>
          {isLoading ? <Loading /> : (
            <table className="mt-6 w-full text-sm">
              <thead><tr className="border-y border-ink-200 text-[11px] uppercase tracking-wider text-ink-500"><th className="py-2 text-left">Date</th><th className="py-2 text-left">Document</th><th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th><th className="py-2 text-right">Balance</th></tr></thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={i} className="border-b border-ink-100">
                    <td className="py-2">{r.tx_date ? dateFmt(r.tx_date) : ''}</td>
                    <td className="py-2">{r.kind === 'OPENING' ? <i>Opening balance</i> : <>{r.doc_no} <span className="text-xs text-ink-400">{r.kind.toLowerCase()}</span></>}</td>
                    <td className="py-2 text-right tabular-nums">{r.debit ? money(r.debit) : ''}</td>
                    <td className="py-2 text-right tabular-nums">{r.credit ? money(r.credit) : ''}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-6 flex justify-end"><div className="rounded-xl bg-ink-900 px-6 py-3 text-right text-white"><div className="text-[11px] uppercase tracking-wider text-gold-300">Balance due</div><div className="text-2xl font-semibold tabular-nums">{settings?.currency} {money(closing)}</div></div></div>
        </div>
      )}
    </div>
  );
}
