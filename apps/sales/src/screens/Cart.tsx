import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ShoppingCart, Trash2 } from 'lucide-react';
import { newClientRef, useStore, type Row } from '../lib/store';
import { rpc } from '../lib/supabase';
import { computeTotals, money } from '../lib/format';
import { CustomerBar, Empty, ProductImage, Sheet, Stepper, TopBar, useToast } from '../ui';

export default function Cart() {
  const s = useStore();
  const { cart, customer, settings, setQty, updateLine, clearCart, paymodes, profile, online, queueOrder, permissions } = s;
  const nav = useNavigate();
  const toast = useToast();
  const [type, setType] = useState<'ORDER' | 'INVOICE'>('ORDER');
  const [notes, setNotes] = useState('');
  const [refNo, setRefNo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [collect, setCollect] = useState(0);
  const [paymodeId, setPaymodeId] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const tax = { taxRate: Number(settings?.tax_rate ?? 0), taxInclusive: !!settings?.tax_inclusive };
  const totals = computeTotals(cart, discount, tax);
  const canInvoice = permissions.has('sales_invoice');
  const cash = paymodes.find((p) => p.is_cash) ?? paymodes[0];

  async function submit() {
    if (!customer) return toast('err', 'Select the retail shop first');
    if (!cart.length) return;
    if (type === 'INVOICE' && !online) return toast('err', 'Invoices need internet. Save as an order now, or wait for signal.');
    setBusy(true);
    const payload: Row = {
      type,
      customer_id: customer.id,
      location_id: profile?.location_id ?? null,
      client_ref: newClientRef(),
      ref_no: refNo || null,
      notes: notes || null,
      discount,
      lines: cart.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price, discount: l.discount })),
    };
    if (type === 'INVOICE' && collect > 0) payload.payments = [{ paymode_id: paymodeId ?? cash?.id, amount: Math.min(collect, totals.total) }];

    try {
      if (!online) {
        queueOrder({ client_ref: payload.client_ref, created_at: new Date().toISOString(), customer, payload });
        toast('ok', 'Saved offline — will be sent when online');
        clearCart();
        nav('/orders');
        return;
      }
      const doc = await rpc<Row>('create_sales_document', { p: payload });
      toast('ok', `${doc.doc_no} saved`);
      clearCart();
      setNotes(''); setRefNo(''); setDiscount(0); setCollect(0);
      nav(`/orders/${doc.id}?new=1`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/fetch|network/i.test(msg) && type === 'ORDER') {
        queueOrder({ client_ref: payload.client_ref, created_at: new Date().toISOString(), customer, payload });
        toast('ok', 'No connection — order saved offline');
        clearCart();
        nav('/orders');
      } else toast('err', msg);
    } finally {
      setBusy(false);
    }
  }

  const line = editing !== null ? cart.find((l) => l.product_id === editing) : null;

  return (
    <div className="pb-6">
      <TopBar title="Cart" right={cart.length > 0 && <button className="rounded-full p-2 active:bg-white/10" onClick={() => confirm('Remove all items?') && clearCart()}><Trash2 size={19} /></button>} />
      <CustomerBar />
      {!cart.length ? (
        <Empty icon={<ShoppingCart size={44} />} title="Cart is empty">
          <button className="btn-primary mt-4" onClick={() => nav('/catalog')}>Open catalog</button>
        </Empty>
      ) : (
        <div className="space-y-3 p-3">
          <div className="card divide-y divide-ink-100">
            {cart.map((l, i) => (
              <div key={l.product_id} className="flex items-center gap-3 p-3">
                <ProductImage p={{ name: l.name, image_url: l.image_url }} className="h-14 w-14 shrink-0 rounded-xl" />
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(l.product_id)}>
                  <div className="line-clamp-2 text-sm font-medium text-ink-900">{l.name}</div>
                  <div className="text-xs text-ink-400">
                    {money(l.price)}{l.uom ? ` / ${l.uom}` : ''}{l.discount ? ` · disc ${money(l.discount)}` : ''}
                    {l.price !== l.list_price && <span className="ml-1 text-emerald-600">special</span>}
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{money(totals.lineTotals[i])}</div>
                </button>
                <Stepper size="sm" value={l.qty} onChange={(v) => setQty(l.product_id, v)} />
              </div>
            ))}
          </div>

          <div className="card space-y-3 p-4">
            {canInvoice && (
              <div className="grid grid-cols-2 rounded-xl bg-ink-50 p-1 text-sm font-semibold">
                {(['ORDER', 'INVOICE'] as const).map((t) => (
                  <button key={t} className={`rounded-lg py-2 ${type === t ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-400'}`} onClick={() => setType(t)}>
                    {t === 'ORDER' ? 'Sales order' : 'Invoice now'}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-400">
              {type === 'ORDER' ? 'The office / warehouse will deliver and invoice this order.' : 'Goods handed over now (van sales). Stock is deducted from your location and an invoice is printed.'}
            </p>
            <label className="block"><span className="label">Shop's PO / reference</span><input className="input" value={refNo} onChange={(e) => setRefNo(e.target.value)} /></label>
            <label className="block"><span className="label">Notes / delivery instructions</span><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            <label className="block"><span className="label">Bill discount</span><input className="input" inputMode="decimal" value={discount || ''} onChange={(e) => setDiscount(Number(e.target.value) || 0)} /></label>
            {type === 'INVOICE' && (
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="label">Collect now</span><input className="input" inputMode="decimal" value={collect || ''} placeholder="0.00" onChange={(e) => setCollect(Number(e.target.value) || 0)} /></label>
                <label className="block"><span className="label">Paymode</span>
                  <select className="input" value={paymodeId ?? cash?.id ?? ''} onChange={(e) => setPaymodeId(Number(e.target.value))}>
                    {paymodes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <button className="col-span-2 text-left text-xs font-semibold text-gold-600" onClick={() => setCollect(totals.total)}>Collect full amount {money(totals.total)}</button>
              </div>
            )}
          </div>

          <div className="card space-y-1.5 p-4 text-sm">
            <Row2 l="Items" r={`${cart.length} · qty ${cart.reduce((a, l) => a + l.qty, 0)}`} />
            {settings?.show_tax && (
              <>
                <Row2 l="Subtotal" r={money(totals.subtotal)} />
                <Row2 l={`${settings?.tax_name ?? 'Tax'} ${Number(settings?.tax_rate ?? 0)}%${tax.taxInclusive ? ' (incl.)' : ''}`} r={money(totals.tax)} />
              </>
            )}
            <div className="flex items-end justify-between border-t border-ink-100 pt-2">
              <span className="font-semibold">Total</span>
              <span className="font-display text-2xl font-semibold tabular-nums">{settings?.currency} {money(totals.total)}</span>
            </div>
            {customer && Number(customer.credit_limit) > 0 && <div className="text-xs text-ink-400">Credit limit {money(customer.credit_limit)}</div>}
          </div>

          <button className="btn-gold w-full py-4 text-base" disabled={busy || !customer} onClick={submit}>
            {busy ? 'Saving…' : !customer ? 'Select a shop first' : type === 'ORDER' ? `Place order · ${money(totals.total)}` : `Create invoice · ${money(totals.total)}`}
          </button>
        </div>
      )}

      <Sheet open={!!line} onClose={() => setEditing(null)} title={line?.name} footer={<button className="btn-primary w-full" onClick={() => setEditing(null)}>Done</button>}>
        {line && (
          <div className="grid grid-cols-3 gap-3">
            <label className="block"><span className="label">Qty</span><input className="input" inputMode="decimal" value={line.qty} onChange={(e) => setQty(line.product_id, Number(e.target.value) || 0)} /></label>
            <label className="block"><span className="label">Price</span><input className="input" inputMode="decimal" value={line.price} onChange={(e) => updateLine(line.product_id, { price: Number(e.target.value) || 0 })} /></label>
            <label className="block"><span className="label">Discount</span><input className="input" inputMode="decimal" value={line.discount || ''} onChange={(e) => updateLine(line.product_id, { discount: Number(e.target.value) || 0 })} /></label>
            <button className="btn-secondary col-span-3 text-rose-600" onClick={() => { setQty(line.product_id, 0); setEditing(null); }}>Remove item</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

const Row2 = ({ l, r }: { l: string; r: string }) => (
  <div className="flex justify-between"><span className="text-ink-500">{l}</span><span className="tabular-nums">{r}</span></div>
);
