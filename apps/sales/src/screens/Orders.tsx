import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, CloudUpload, FileText, HandCoins, MessageCircle, Printer, RefreshCw, ScrollText, Undo2 } from 'lucide-react';
import { useStore, type Row } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { dateFmt, dateTimeFmt, money, qtyFmt, round2 } from '../lib/format';
import { printReceipt } from '../lib/printer';
import { Empty, Sheet, TopBar, useToast } from '../ui';

const LABEL: Record<string, string> = { ORDER: 'Order', INVOICE: 'Invoice', QUOTE: 'Quote', RETURN: 'Return', DELIVERY: 'Delivery' };

function statusOf(d: Row) {
  if (d.status === 'VOID') return ['Void', 'bg-rose-50 text-rose-600'];
  if (d.status === 'CONVERTED') return ['Invoiced', 'bg-sky-50 text-sky-700'];
  if (d.type === 'INVOICE') {
    const bal = d.total - d.paid - d.credited;
    if (bal <= 0.004) return ['Paid', 'bg-emerald-50 text-emerald-700'];
    if (d.paid > 0) return ['Partial', 'bg-amber-50 text-amber-700'];
    return ['Unpaid', 'bg-gold-50 text-gold-700'];
  }
  return ['Open', 'bg-gold-50 text-gold-700'];
}

export default function Orders() {
  const { pending, syncPending, online } = useStore();
  const nav = useNavigate();
  const [type, setType] = useState('');
  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['my-docs', type],
    enabled: online,
    queryFn: async () => {
      let q = supabase.from('sales_docs').select('id, doc_no, type, status, doc_date, total, paid, credited, customer:customers(name)').order('id', { ascending: false }).limit(150);
      if (type) q = q.eq('type', type);
      return (await q).data ?? [];
    },
  });

  return (
    <div>
      <TopBar title="My orders" right={<button className="rounded-full p-2 active:bg-white/10" onClick={() => refetch()}><RefreshCw size={19} className={isFetching ? 'animate-spin' : ''} /></button>} />
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3">
        {[['', 'All'], ['ORDER', 'Orders'], ['INVOICE', 'Invoices'], ['RETURN', 'Returns'], ['QUOTE', 'Quotes']].map(([k, l]) => (
          <button key={k} className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold ${type === k ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-100'}`} onClick={() => setType(k)}>{l}</button>
        ))}
      </div>

      {pending.length > 0 && (
        <div className="m-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-amber-800">{pending.length} order(s) waiting to send</div>
            <button className="btn-primary px-3 py-2 text-xs" disabled={!online} onClick={() => syncPending()}><CloudUpload size={15} /> Send now</button>
          </div>
          {pending.map((p) => (
            <div key={p.client_ref} className="mt-2 text-xs text-amber-900">
              {p.customer?.name} · {dateTimeFmt(p.created_at)} · {p.payload.lines.length} items
              {p.error && <div className="text-rose-600">Error: {p.error}</div>}
            </div>
          ))}
        </div>
      )}

      {!online ? <Empty icon={<ClipboardList size={44} />} title="Offline">Order history appears when you are back online.</Empty>
        : isLoading ? <div className="p-6 text-center text-sm text-ink-400">Loading…</div>
        : !data.length ? <Empty icon={<ClipboardList size={44} />} title="No orders yet" />
        : (
          <div className="mt-3 divide-y divide-ink-100 bg-white">
            {data.map((d: Row) => {
              const [st, cls] = statusOf(d);
              return (
                <button key={d.id} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-50" onClick={() => nav(`/orders/${d.id}`)}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-50 text-ink-500"><FileText size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink-900">{d.customer?.name ?? 'Walk-in'}</div>
                    <div className="text-xs text-ink-400">{d.doc_no} · {LABEL[d.type]} · {dateFmt(d.doc_date)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{money(d.total)}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{st}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
    </div>
  );
}

export function OrderView() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { settings, profile, permissions } = useStore();
  const [busy, setBusy] = useState(false);

  const { data: d, refetch } = useQuery({
    queryKey: ['doc', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_docs')
        .select('*, customer:customers(*), user:profiles(full_name), lines:sales_lines(*, product:products(code, image_url, uom:uoms(code))), allocations:receipt_allocations(amount, receipt:receipts(status, paymode:paymodes(name)))')
        .eq('id', Number(id))
        .single();
      if (error) throw new Error(error.message);
      return data as Row;
    },
  });

  // Shop's total outstanding (invoices - returns - receipts), printed on invoices and returns.
  const { data: custBal } = useQuery({
    queryKey: ['cust-bal', d?.customer_id, d?.updated_at],
    enabled: !!d?.customer_id && ['INVOICE', 'RETURN'].includes(d?.type),
    queryFn: () => rpc<number>('customer_outstanding', { p_customer: d!.customer_id }),
  });

  const receiptData = useMemo(() => d && ({
    settings,
    doc: d,
    customer: d.customer,
    salesman: d.user?.full_name ?? profile?.full_name,
    lines: [...d.lines].sort((a: Row, b: Row) => a.line_no - b.line_no).map((l: Row) => ({ description: l.description, qty: l.qty, price: l.price, discount: Number(l.discount), line_total: l.line_total, uom: l.product?.uom?.code })),
    payments: d.allocations.filter((a: Row) => a.receipt.status === 'ACTIVE').map((a: Row) => ({ name: a.receipt.paymode.name, amount: a.amount })),
    outstanding: custBal === undefined || custBal === null ? undefined : Number(custBal),
    note: d.type === 'RETURN' ? `Reason: ${String(d.return_reason ?? '-').replace('_', ' ')}${d.restock ? '' : ' (written off)'}` : undefined,
  }), [d, settings, profile, custBal]);

  async function print() {
    try { await printReceipt(receiptData!); } catch (e) { toast('err', (e as Error).message); }
  }

  // Auto-print right after a new invoice is created if a printer is paired.
  useEffect(() => {
    if (sp.get('new') && d?.type === 'INVOICE' && localStorage.getItem('amoka.sales.autoprint') === '1') print();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id]);

  if (!d) return <div><TopBar title="Order" back="/orders" /><div className="p-6 text-center text-sm text-ink-400">Loading…</div></div>;
  const [st, cls] = statusOf(d);
  const bal = round2(d.total - d.paid - d.credited);

  function share() {
    const lines = [...d!.lines].sort((a: Row, b: Row) => a.line_no - b.line_no).map((l: Row) => `• ${l.description} × ${qtyFmt(l.qty)} = ${money(l.line_total)}`).join('\n');
    const text = `*${settings?.company_name}*\n${LABEL[d!.type]} ${d!.doc_no} · ${dateFmt(d!.doc_date)}\n${d!.customer?.name ?? ''}\n\n${lines}\n\n*Total: ${settings?.currency} ${money(d!.total)}*${d!.type === 'INVOICE' && bal > 0 ? `\nBalance due: ${money(bal)}` : ''}\n\nThank you!`;
    const tel = d!.customer?.phone?.replace(/[^\d]/g, '') ?? '';
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(text)}`, '_blank');
  }

  async function convert() {
    if (!confirm('Convert this order into an invoice now? Stock will be deducted.')) return;
    setBusy(true);
    try {
      const inv = await rpc<Row>('convert_sales_doc', { p_id: d!.id, p_type: 'INVOICE' });
      toast('ok', `${inv.doc_no} created`);
      qc.invalidateQueries();
      nav(`/orders/${inv.id}?new=1`, { replace: true });
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="pb-6">
      <TopBar title={d.doc_no} back="/orders" right={<button className="rounded-full p-2 active:bg-white/10" onClick={() => refetch()}><RefreshCw size={18} /></button>} />
      <div className="space-y-3 p-3">
        <div className="card p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gold-600">{LABEL[d.type]}</div>
              <div className="mt-0.5 text-lg font-semibold text-ink-900">{d.customer?.name ?? 'Walk-in'}</div>
              <div className="text-xs text-ink-400">{dateTimeFmt(d.doc_date)}{d.ref_no ? ` · Ref ${d.ref_no}` : ''}</div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{st}</span>
          </div>
          {d.notes && <p className="mt-2 rounded-xl bg-ink-50 p-2 text-xs text-ink-600">{d.notes}</p>}
        </div>

        <div className="card divide-y divide-ink-100">
          {[...d.lines].sort((a: Row, b: Row) => a.line_no - b.line_no).map((l: Row) => (
            <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink-900">{l.description}</div>
                <div className="text-xs text-ink-400">{qtyFmt(l.qty)} {l.product?.uom?.code ?? ''} × {money(l.price)}{Number(l.discount) ? ` − ${money(l.discount)}` : ''}</div>
              </div>
              <div className="font-semibold tabular-nums">{money(l.line_total)}</div>
            </div>
          ))}
          <div className="space-y-1 px-4 py-3 text-sm">
            {Number(d.discount) > 0 && <div className="flex justify-between text-ink-500"><span>Discount</span><span>-{money(d.discount)}</span></div>}
            {settings?.show_tax && (
              <>
                <div className="flex justify-between text-ink-500"><span>Subtotal</span><span className="tabular-nums">{money(d.subtotal)}</span></div>
                <div className="flex justify-between text-ink-500"><span>{settings?.tax_name}</span><span className="tabular-nums">{money(d.tax)}</span></div>
              </>
            )}
            <div className="flex justify-between text-base font-semibold"><span>Total</span><span className="tabular-nums">{settings?.currency} {money(d.total)}</span></div>
            {d.type === 'INVOICE' && (
              <>
                <div className="flex justify-between text-ink-500"><span>Paid</span><span className="tabular-nums">{money(d.paid)}</span></div>
                <div className={`flex justify-between font-semibold ${bal > 0 ? 'text-rose-600' : 'text-emerald-700'}`}><span>Balance</span><span className="tabular-nums">{money(bal)}</span></div>
              </>
            )}
            {d.type === 'RETURN' && (
              <div className="text-xs text-ink-500">Reason: {String(d.return_reason ?? '—').replace('_', ' ').toLowerCase()} · {d.restock ? 'back to stock' : 'written off'}</div>
            )}
            {custBal !== undefined && custBal !== null && (
              <div className="mt-2 flex justify-between rounded-xl bg-ink-900 px-3 py-2 font-semibold text-white">
                <span>Shop total outstanding</span><span className="tabular-nums">{money(Number(custBal))}</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primary" onClick={print}><Printer size={17} /> Print</button>
          <button className="btn-secondary" onClick={share}><MessageCircle size={17} /> WhatsApp</button>
          {d.type === 'ORDER' && d.status === 'OPEN' && permissions.has('sales_invoice') && (
            <button className="btn-gold col-span-2" disabled={busy} onClick={convert}><FileText size={17} /> Convert to invoice</button>
          )}
          {d.type === 'INVOICE' && d.status !== 'VOID' && bal > 0.004 && permissions.has('receipts') && d.customer && (
            <button className="btn-gold col-span-2" onClick={() => nav(`/collect/${d.customer.id}?doc=${d.id}`)}><HandCoins size={17} /> Receive payment · {money(bal)}</button>
          )}
          {d.type === 'INVOICE' && d.status !== 'VOID' && permissions.has('sales_return') && d.customer && (
            <button className="btn-secondary" onClick={() => nav(`/return/${d.customer.id}?invoice=${d.id}`)}><Undo2 size={17} /> Return items</button>
          )}
          {d.customer && (
            <button className="btn-secondary" onClick={() => nav(`/statement/${d.customer.id}`)}><ScrollText size={17} /> Statement</button>
          )}
        </div>
      </div>
    </div>
  );
}

