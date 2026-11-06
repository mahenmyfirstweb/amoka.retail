/** Receipt (payment against selected invoices), Sales return, Customer statement, Receipts list. */
import { logEvent } from '../lib/location';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, FileDown, HandCoins, MessageCircle, Minus, Plus, Printer, Search, Trash2, Undo2 } from 'lucide-react';
import { newClientRef, useStore, type Row } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { dateFmt, dateTimeFmt, isoDate, money, qtyFmt, round2 } from '../lib/format';
import { downloadReceiptPdf, downloadStatementPdf, loadPaymentReceipt, printPaymentReceipt, printStatement, receiptHtml, statementHtml, whatsappReceipt, whatsappStatement, type PaymentReceiptData } from '../lib/printer';
import { Empty, PrintPreview, ProductImage, Sheet, TopBar, useToast } from '../ui';

function useCustomer(id: string | undefined) {
  const { customers } = useStore();
  const cached = customers.find((c) => c.id === Number(id));
  const { data } = useQuery({
    queryKey: ['customer', id],
    enabled: !cached && !!id,
    queryFn: async () => (await supabase.from('customers').select('*').eq('id', Number(id)).single()).data as Row,
  });
  return cached ?? data ?? null;
}

function useOutstanding(customerId: number | undefined) {
  return useQuery({
    queryKey: ['cust-bal', customerId],
    enabled: !!customerId,
    queryFn: () => rpc<number>('customer_outstanding', { p_customer: customerId }),
  });
}

// =====================================================================
// RECEIPT — select invoices, enter amount per invoice
// =====================================================================
export function Receipt() {
  const { customerId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { paymodes, profile, settings } = useStore();
  const customer = useCustomer(customerId);
  // Default = first paymode in Master → Paymode order (Bill to Bill).
  const cash = paymodes[0];
  const [paymodeId, setPaymodeId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [chequeNo, setChequeNo] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Row | null>(null);
  const [previewData, setPreviewData] = useState<PaymentReceiptData | null>(null);
  const { data: balance, refetch: refetchBal } = useOutstanding(Number(customerId));

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['open-inv', customerId],
    queryFn: async () => {
      const { data } = await supabase.from('sales_docs').select('id, doc_no, doc_date, due_date, total, paid, credited')
        .eq('customer_id', Number(customerId)).eq('type', 'INVOICE').neq('status', 'VOID').order('doc_date');
      return (data ?? []).map((d) => ({ ...d, bal: round2(d.total - d.paid - d.credited) })).filter((d) => d.bal > 0.004);
    },
  });

  // Pre-select the invoice we came from.
  useEffect(() => {
    const id = Number(sp.get('doc'));
    const inv = invoices.find((i) => i.id === id);
    if (inv && !Object.keys(selected).length) setSelected({ [inv.id]: inv.bal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);

  const amount = round2(Object.values(selected).reduce((s, v) => s + (v || 0), 0));
  const totalDue = round2(invoices.reduce((s, i) => s + i.bal, 0));
  const pm = paymodes.find((p) => p.id === (paymodeId ?? cash?.id));

  function toggle(inv: Row) {
    setSelected((s) => {
      const n = { ...s };
      if (n[inv.id] !== undefined) delete n[inv.id];
      else n[inv.id] = inv.bal;
      return n;
    });
  }
  const selectAll = () => setSelected(Object.fromEntries(invoices.map((i) => [i.id, i.bal])));

  async function save() {
    if (!(amount > 0)) return toast('err', 'Select at least one invoice');
    const over = invoices.find((i) => (selected[i.id] ?? 0) - i.bal > 0.004);
    if (over) return toast('err', `${over.doc_no}: amount is more than its balance ${money(over.bal)}`);
    setBusy(true);
    try {
      logEvent('RECEIPT');
      const r = await rpc<Row>('create_receipt', {
        p: {
          customer_id: Number(customerId), location_id: profile?.location_id, paymode_id: pm?.id, amount,
          cheque_no: chequeNo || null, reference: reference || null,
          allocations: Object.entries(selected).filter(([, v]) => v > 0).map(([doc_id, v]) => ({ doc_id: Number(doc_id), amount: v })),
        },
      });
      toast('ok', `${r.receipt_no} saved`);
      qc.invalidateQueries();
      const { data: bal } = await refetchBal();
      setDone({ ...r, balanceAfter: bal });
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); }
  }

  /** action: print | pdf | whatsapp */
  async function receiptAction(action: 'print' | 'pdf' | 'whatsapp') {
    try {
      const data = await loadPaymentReceipt(supabase, done!.id, settings, profile?.full_name);
      if (action === 'print') setPreviewData(data);
      else if (action === 'pdf') await downloadReceiptPdf(data);
      else if ((await whatsappReceipt(data)) === 'fallback') toast('ok', 'PDF downloaded — attach it in WhatsApp');
    } catch (e) { toast('err', (e as Error).message); }
  }

  return (
    <div className="pb-6">
      <TopBar title="Receive payment" back />
      <div className="space-y-3 p-3">
        <div className="rounded-2xl bg-ink-900 p-5 text-white">
          <div className="text-sm text-ink-300">{customer?.name}</div>
          <div className="mt-1 text-xs uppercase tracking-wider text-gold-300">Total outstanding</div>
          <div className="font-display text-3xl font-semibold tabular-nums">{settings?.currency} {money(Number(balance ?? totalDue))}</div>
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Select invoices being paid</div>
          {invoices.length > 1 && <button className="text-xs font-semibold text-gold-600" onClick={selectAll}>Select all</button>}
        </div>
        <div className="card divide-y divide-ink-100">
          {isLoading && <div className="p-4 text-center text-sm text-ink-400">Loading…</div>}
          {!isLoading && !invoices.length && <div className="p-4 text-center text-sm text-ink-400">No unpaid invoices for this shop</div>}
          {invoices.map((i) => {
            const on = selected[i.id] !== undefined;
            const overdue = i.due_date && new Date(i.due_date) < new Date();
            return (
              <div key={i.id} className={`px-4 py-3 ${on ? 'bg-gold-50/60' : ''}`}>
                <button className="flex w-full items-center gap-3 text-left" onClick={() => toggle(i)}>
                  {on ? <CheckCircle2 className="shrink-0 text-gold-600" size={22} /> : <Circle className="shrink-0 text-ink-300" size={22} />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink-900">{i.doc_no}</div>
                    <div className={`text-xs ${overdue ? 'text-rose-600' : 'text-ink-400'}`}>{dateFmt(i.doc_date)}{i.due_date ? ` · due ${dateFmt(i.due_date)}` : ''}{overdue ? ' · overdue' : ''}</div>
                  </div>
                  <div className="text-right"><div className="text-xs text-ink-400">Balance</div><div className="font-semibold tabular-nums">{money(i.bal)}</div></div>
                </button>
                {on && (
                  <div className="mt-2 flex items-center gap-2 pl-9">
                    <span className="text-xs text-ink-500">Paying</span>
                    <input className="input py-2 text-right font-semibold" inputMode="decimal" value={selected[i.id] || ''} onChange={(e) => setSelected({ ...selected, [i.id]: Number(e.target.value) || 0 })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="card space-y-3 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Payment method</div>
          <div className="grid grid-cols-3 gap-2">
            {paymodes.map((p) => (
              <button key={p.id} className={`rounded-xl px-2 py-2.5 text-xs font-semibold ${pm?.id === p.id ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600'}`} onClick={() => setPaymodeId(p.id)}>{p.name}</button>
            ))}
          </div>
          {pm?.code === 'CHEQUE' && <label className="block"><span className="label">Cheque no.</span><input className="input" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></label>}
          <label className="block"><span className="label">Reference (optional)</span><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PayNow ref, bank ref…" /></label>
        </div>

        <button className="btn-gold w-full py-4 text-base" disabled={busy || !(amount > 0)} onClick={save}>
          <HandCoins size={19} /> {busy ? 'Saving…' : `Save receipt · ${money(amount)}`}
        </button>
      </div>

      <PrintPreview html={previewData ? receiptHtml(previewData) : null} title={`Receipt ${previewData?.receipt.receipt_no ?? ''}`} onClose={() => setPreviewData(null)} onPrint={() => printPaymentReceipt(previewData!)} onPdf={() => downloadReceiptPdf(previewData!)} onWhatsapp={() => whatsappReceipt(previewData!)} />
      <Sheet open={!!done} onClose={() => nav(-1)} title={`Receipt ${done?.receipt_no ?? ''} saved`} footer={
        <div className="space-y-2"><div className="grid grid-cols-3 gap-2"><button className="btn-primary" onClick={() => receiptAction('print')}><Printer size={16} /> Print</button><button className="btn-secondary" onClick={() => receiptAction('pdf')}><FileDown size={16} /> PDF</button><button className="btn-secondary !text-emerald-700" onClick={() => receiptAction('whatsapp')}><MessageCircle size={16} /> WhatsApp</button></div><button className="btn-ghost w-full" onClick={() => nav('/')}>Done</button></div>
      }>
        <p className="text-sm text-ink-600">{money(amount)} received from <b>{customer?.name}</b> by {pm?.name}.</p>
        {done?.balanceAfter !== undefined && <p className="mt-2 text-sm">Remaining outstanding: <b>{money(Number(done.balanceAfter))}</b></p>}
      </Sheet>
    </div>
  );
}

// =====================================================================
// SALES RETURN — expired / damaged / wrong item
// =====================================================================
const REASONS: [string, string, boolean][] = [
  ['EXPIRED', 'Expired', false],
  ['DAMAGED', 'Damaged', false],
  ['WRONG_ITEM', 'Wrong item', true],
  ['OTHER', 'Other', true],
];

interface RLine { product_id: number; name: string; code: string; image_url?: string; uom?: string; qty: number; price: number; max?: number }

export function SalesReturn() {
  const { customerId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { products, priceFor, profile, settings, permissions } = useStore();
  const customer = useCustomer(customerId);
  const [invoiceId, setInvoiceId] = useState<number | null>(Number(sp.get('invoice')) || null);
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<RLine[]>([]);
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: invoices = [] } = useQuery({
    queryKey: ['cust-invoices', customerId],
    queryFn: async () => (await supabase.from('sales_docs').select('id, doc_no, doc_date, total')
      .eq('customer_id', Number(customerId)).eq('type', 'INVOICE').neq('status', 'VOID').order('id', { ascending: false }).limit(30)).data ?? [],
  });
  const { data: invLines = [] } = useQuery({
    queryKey: ['inv-lines', invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => (await supabase.from('sales_lines').select('product_id, description, qty, price, product:products(code, image_url, uom:uoms(code))').eq('doc_id', invoiceId!).order('line_no')).data ?? [],
  });

  // When an invoice is chosen, list its items (qty 0) so the salesman just enters return qty.
  useEffect(() => {
    if (!invoiceId) return;
    setLines(invLines.map((l: Row) => ({
      product_id: l.product_id, name: l.description, code: l.product?.code, image_url: l.product?.image_url, uom: l.product?.uom?.code,
      qty: 0, price: Number(l.price), max: Number(l.qty),
    })));
  }, [invLines, invoiceId]);

  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return products.slice(0, 40);
    return products.filter((p) => p.name.toLowerCase().includes(t) || p.code.toLowerCase().includes(t) || p.barcode === q.trim()).slice(0, 40);
  }, [products, q]);

  const active = lines.filter((l) => l.qty > 0);
  const subtotal = active.reduce((s, l) => s + l.qty * l.price, 0);
  const taxRate = Number(settings?.tax_rate ?? 0);
  const total = settings?.tax_inclusive ? subtotal : subtotal * (1 + taxRate / 100);

  function add(p: Row) {
    setLines((ls) => ls.some((l) => l.product_id === p.id)
      ? ls.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l))
      : [...ls, { product_id: p.id, name: p.name, code: p.code, image_url: p.image_url, uom: p.uom?.code, qty: 1, price: priceFor(p) }]);
    setPicker(false);
    setQ('');
  }
  const setQty = (id: number, qty: number) => setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, qty: Math.max(0, qty) } : l)));

  async function save() {
    if (!reason) return toast('err', 'Select the return reason');
    if (!active.length) return toast('err', 'Enter the return quantity for at least one item');
    const over = active.find((l) => l.max !== undefined && l.qty > l.max);
    if (over) return toast('err', `${over.name}: only ${qtyFmt(over.max)} were invoiced`);
    setBusy(true);
    try {
      const doc = await rpc<Row>('create_sales_return', {
        p: {
          customer_id: Number(customerId), location_id: profile?.location_id, invoice_id: invoiceId, return_reason: reason, restock,
          notes: notes || null, client_ref: newClientRef(),
          lines: active.map((l) => ({ product_id: l.product_id, description: l.name, qty: l.qty, price: l.price })),
        },
      });
      toast('ok', `${doc.doc_no} saved`);
      logEvent('RETURN');
      qc.invalidateQueries();
      nav(`/orders/${doc.id}?new=1`, { replace: true });
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); }
  }

  if (!permissions.has('sales_return')) return <div><TopBar title="Sales return" back /><Empty title="Not allowed">Your role cannot create returns.</Empty></div>;

  return (
    <div className="pb-6">
      <TopBar title="Sales return" back />
      <div className="space-y-3 p-3">
        <div className="card p-4">
          <div className="text-xs text-ink-400">Shop</div>
          <div className="font-semibold text-ink-900">{customer?.name}</div>
          <label className="mt-3 block"><span className="label">From invoice (recommended)</span>
            <select className="input" value={invoiceId ?? ''} onChange={(e) => { setInvoiceId(e.target.value ? Number(e.target.value) : null); setLines([]); }}>
              <option value="">— No invoice / pick products —</option>
              {invoices.map((i: Row) => <option key={i.id} value={i.id}>{i.doc_no} · {dateFmt(i.doc_date)} · {money(i.total)}</option>)}
            </select>
          </label>
        </div>

        <div className="card p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Reason</div>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map(([k, l, rs]) => (
              <button key={k} className={`rounded-xl px-3 py-3 text-sm font-semibold ${reason === k ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600'}`} onClick={() => { setReason(k); setRestock(rs); }}>{l}</button>
            ))}
          </div>
          <label className="mt-3 flex items-center justify-between text-sm">
            <span>Put goods back into my stock<br /><span className="text-xs text-ink-400">{restock ? 'Goods can be sold again' : 'Expired / damaged goods are written off'}</span></span>
            <input type="checkbox" className="h-5 w-5 accent-ink-900" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          </label>
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Items returned</div>
          <button className="text-xs font-semibold text-gold-600" onClick={() => setPicker(true)}>+ Add product</button>
        </div>
        <div className="card divide-y divide-ink-100">
          {!lines.length && <div className="p-6 text-center text-sm text-ink-400">{invoiceId ? 'Loading invoice items…' : 'Tap "Add product" to choose returned items'}</div>}
          {lines.map((l) => (
            <div key={l.product_id} className={`flex items-center gap-3 p-3 ${l.qty > 0 ? '' : 'opacity-70'}`}>
              <ProductImage p={{ name: l.name, image_url: l.image_url }} className="h-12 w-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium text-ink-900">{l.name}</div>
                <div className="text-xs text-ink-400">{money(l.price)}{l.max !== undefined ? ` · invoiced ${qtyFmt(l.max)} ${l.uom ?? ''}` : ''}</div>
              </div>
              <div className="flex items-center rounded-full bg-ink-50">
                <button className="p-2" onClick={() => setQty(l.product_id, l.qty - 1)}><Minus size={15} /></button>
                <input className="w-10 bg-transparent text-center text-sm font-semibold" inputMode="decimal" value={l.qty} onChange={(e) => setQty(l.product_id, Number(e.target.value) || 0)} />
                <button className="p-2" onClick={() => setQty(l.product_id, l.qty + 1)}><Plus size={15} /></button>
              </div>
              {!invoiceId && <button className="p-1 text-ink-300" onClick={() => setLines(lines.filter((x) => x.product_id !== l.product_id))}><Trash2 size={16} /></button>}
            </div>
          ))}
        </div>

        <label className="block"><span className="label">Notes</span><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Batch no., expiry date, condition…" /></label>

        <div className="card flex items-center justify-between p-4">
          <span className="text-sm text-ink-500">Credit to shop</span>
          <span className="font-display text-2xl font-semibold tabular-nums">{money(round2(total))}</span>
        </div>
        <button className="btn-gold w-full py-4 text-base" disabled={busy || !active.length || !reason} onClick={save}>
          <Undo2 size={19} /> {busy ? 'Saving…' : 'Save sales return'}
        </button>
        <p className="px-2 text-center text-xs text-ink-400">The credit reduces the shop's outstanding. It is applied to the selected invoice first, then to the oldest unpaid invoices.</p>
      </div>

      <Sheet open={picker} onClose={() => setPicker(false)} title="Add returned product">
        <div className="relative mb-3">
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-300" />
          <input className="input pl-10" placeholder="Search product" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="divide-y divide-ink-100">
          {found.map((p) => (
            <button key={p.id} className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => add(p)}>
              <ProductImage p={p} className="h-11 w-11 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{p.name}</div><div className="text-xs text-ink-400">{p.code}</div></div>
              <div className="text-sm font-semibold tabular-nums">{money(priceFor(p))}</div>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

// =====================================================================
// CUSTOMER STATEMENT — date range, print, WhatsApp
// =====================================================================
export function Statement() {
  const { customerId } = useParams();
  const toast = useToast();
  const { settings } = useStore();
  const customer = useCustomer(customerId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [from, setFrom] = useState(isoDate(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1)));
  const [to, setTo] = useState(isoDate());
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['statement', customerId, from, to],
    queryFn: () => rpc<Row[]>('customer_statement', { p_customer: Number(customerId), p_from: from, p_to: to }),
  });
  const closing = rows.length ? Number(rows[rows.length - 1].balance) : 0;
  const quick = (months: number) => { setFrom(isoDate(new Date(new Date().getFullYear(), new Date().getMonth() - months, 1))); setTo(isoDate()); };

  async function print() {
    if (!customer) return;
    setPreviewOpen(true);
  }
  const stmt = () => ({ settings, customer: customer!, from, to, rows: rows as never });
  async function share() {
    if (!customer) return;
    try {
      const r = await whatsappStatement(stmt());
      if (r === 'fallback') toast('ok', 'PDF downloaded — attach it in WhatsApp');
    } catch (e) { toast('err', (e as Error).message); }
  }
  async function pdf() {
    if (!customer) return;
    try { await downloadStatementPdf(stmt()); } catch (e) { toast('err', (e as Error).message); }
  }

  return (
    <div className="pb-6">
      <TopBar title="Statement" back />
      <PrintPreview html={previewOpen && customer ? statementHtml(stmt()) : null} title="Statement" onClose={() => setPreviewOpen(false)} onPrint={() => printStatement(stmt())} onPdf={() => downloadStatementPdf(stmt())} onWhatsapp={() => whatsappStatement(stmt())} />
      <div className="space-y-3 p-3">
        <div className="card p-4">
          <div className="font-semibold text-ink-900">{customer?.name}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block"><span className="label">From</span><input type="date" className="input py-2" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="block"><span className="label">To</span><input type="date" className="input py-2" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="mt-2 flex gap-2 text-xs font-semibold">
            {[[0, 'This month'], [2, '3 months'], [5, '6 months'], [11, '12 months']].map(([m, l]) => (
              <button key={l} className="rounded-full bg-ink-50 px-3 py-1.5 text-ink-600" onClick={() => quick(m as number)}>{l}</button>
            ))}
          </div>
        </div>

        {isLoading ? <div className="p-6 text-center text-sm text-ink-400">Loading…</div> : error ? <div className="p-4 text-sm text-rose-600">{(error as Error).message}</div> : (
          <div className="card divide-y divide-ink-100">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <div className="font-medium">{r.kind === 'OPENING' ? 'Opening balance' : r.doc_no}</div>
                  {r.kind !== 'OPENING' && <div className="text-xs text-ink-400">{dateTimeFmt(r.tx_date)} · {String(r.kind).toLowerCase()}</div>}
                </div>
                <div className="text-right">
                  {r.kind !== 'OPENING' && <div className={`tabular-nums ${r.debit ? '' : 'text-emerald-700'}`}>{r.debit ? money(r.debit) : `−${money(r.credit)}`}</div>}
                  <div className="text-xs tabular-nums text-ink-400">bal {money(r.balance)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between rounded-2xl bg-ink-900 p-4 text-white">
          <span className="text-sm text-gold-300">Balance due</span>
          <span className="font-display text-2xl font-semibold tabular-nums">{settings?.currency} {money(closing)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button className="btn-primary" onClick={print}><Printer size={17} /> Print</button>
          <button className="btn-secondary" onClick={pdf}><FileDown size={17} /> PDF</button>
          <button className="btn-secondary !text-emerald-700" onClick={share}><MessageCircle size={17} /> WhatsApp</button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Pick a shop, then go to receipt / return / statement
// =====================================================================
export function PickShop() {
  const { action = 'collect' } = useParams();
  const nav = useNavigate();
  const { customers, customer, profile } = useStore();
  const [q, setQ] = useState('');
  const title = action === 'return' ? 'Sales return' : action === 'statement' ? 'Statement' : 'Receive payment';
  const hasMine = customers.some((c) => c.salesman_id === profile?.id);
  const list = customers.filter((c) => (!hasMine || c.salesman_id === profile?.id) && (!q || c.name.toLowerCase().includes(q.toLowerCase()) || c.code.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <TopBar title={`${title} — choose shop`} back />
      <div className="p-3"><input className="input rounded-full" placeholder="Search shop" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      {customer && (
        <button className="mx-3 mb-2 w-[calc(100%-1.5rem)] rounded-2xl bg-gold-50 p-3 text-left ring-1 ring-gold-200" onClick={() => nav(`/${action}/${customer.id}`, { replace: true })}>
          <div className="text-xs text-gold-700">Current shop</div><div className="font-semibold">{customer.name}</div>
        </button>
      )}
      <div className="divide-y divide-ink-100 bg-white">
        {list.map((c) => (
          <button key={c.id} className="block w-full px-4 py-3 text-left active:bg-ink-50" onClick={() => nav(`/${action}/${c.id}`, { replace: true })}>
            <div className="font-medium">{c.name}</div><div className="text-xs text-ink-400">{[c.code, c.area?.name].filter(Boolean).join(' · ')}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// My receipts
// =====================================================================
export function ReceiptsList() {
  const nav = useNavigate();
  const toast = useToast();
  const { online, settings, profile } = useStore();
  const [menu, setMenu] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<PaymentReceiptData | null>(null);
  async function act(id: number, action: 'print' | 'pdf' | 'whatsapp') {
    setMenu(null);
    try {
      const data = await loadPaymentReceipt(supabase, id, settings, profile?.full_name);
      if (action === 'print') setPreviewData(data);
      else if (action === 'pdf') await downloadReceiptPdf(data);
      else if ((await whatsappReceipt(data)) === 'fallback') toast('ok', 'PDF downloaded — attach it in WhatsApp');
    } catch (e) { toast('err', (e as Error).message); }
  }
  const { data = [] } = useQuery({
    queryKey: ['my-receipts'],
    enabled: online,
    queryFn: async () => (await supabase.from('receipts').select('id, receipt_no, receipt_date, amount, status, customer:customers(id, name), paymode:paymodes(name)').order('id', { ascending: false }).limit(100)).data ?? [],
  });
  return (
    <div>
      <TopBar title="My receipts" back right={<button className="rounded-full p-2 active:bg-white/10" onClick={() => nav('/pick/collect')}><Plus size={22} /></button>} />
      {!data.length ? <Empty icon={<HandCoins size={44} />} title="No receipts yet" /> : (
        <div className="divide-y divide-ink-100 bg-white">
          {data.map((r: Row) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => r.customer && nav(`/statement/${r.customer.id}`)}>
                <div className="truncate font-semibold">{r.customer?.name ?? 'Walk-in'}</div>
                <div className="text-xs text-ink-400">{r.receipt_no} · {dateTimeFmt(r.receipt_date)} · {r.paymode?.name}</div>
              </button>
              <div className="text-right"><div className="font-semibold tabular-nums">{money(r.amount)}</div>{r.status === 'VOID' && <div className="text-[10px] font-semibold text-rose-600">VOID</div>}</div>
              {r.status !== 'VOID' && <button className="rounded-full bg-ink-900 p-2 text-gold-300" title="Print / PDF / WhatsApp" onClick={() => setMenu(r.id)}><Printer size={16} /></button>}
            </div>
          ))}
        </div>
      )}
      <PrintPreview html={previewData ? receiptHtml(previewData) : null} title={`Receipt ${previewData?.receipt.receipt_no ?? ''}`} onClose={() => setPreviewData(null)} onPrint={() => printPaymentReceipt(previewData!)} onPdf={() => downloadReceiptPdf(previewData!)} onWhatsapp={() => whatsappReceipt(previewData!)} />
      <Sheet open={menu !== null} onClose={() => setMenu(null)} title="Receipt">
        <div className="grid grid-cols-3 gap-2 pb-2">
          <button className="btn-primary" onClick={() => act(menu!, 'print')}><Printer size={16} /> Print</button>
          <button className="btn-secondary" onClick={() => act(menu!, 'pdf')}><FileDown size={16} /> PDF</button>
          <button className="btn-secondary !text-emerald-700" onClick={() => act(menu!, 'whatsapp')}><MessageCircle size={16} /> WhatsApp</button>
        </div>
      </Sheet>
    </div>
  );
}
