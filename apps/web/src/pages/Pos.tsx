import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Banknote, Keyboard, List, Lock, Minus, Pause, Play, Plus, Printer, Trash2, User, Wallet, X,
} from 'lucide-react';
import { supabase, rpc } from '../lib/supabase';
import { like, usePaymodes, useSettings, type Row } from '../lib/data';
import { useAuth } from '../lib/auth';
import { computeTotals, dateTimeFmt, money, round2 } from '../lib/format';
import { printReceipt } from '../lib/receipt';
import { ErrorBox, Field, Modal, useToast } from '../components/ui';
import { PartyPicker, ProductPicker } from '../components/Pickers';

interface CartLine { product_id: number; code: string; name: string; qty: number; price: number; discount: number; taxable: boolean }
interface Pay { paymode_id: number; amount: number; reference?: string }

export default function Pos() {
  const { profile, locationId } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: paymodes = [] } = usePaymodes();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Row | null>(null);
  const [billDiscount, setBillDiscount] = useState(0);
  const [heldId, setHeldId] = useState<number | null>(null);
  const [category, setCategory] = useState<number | null>(null);
  const [gridSearch, setGridSearch] = useState('');
  const [modal, setModal] = useState<null | 'pay' | 'held' | 'cash' | 'settle' | 'invoices' | 'keys' | 'edit'>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [lastSale, setLastSale] = useState<Row | null>(null);

  // ---------- Session ----------
  const session = useQuery({
    queryKey: ['pos-session', profile?.id, locationId],
    enabled: !!profile && !!locationId,
    queryFn: async () => {
      const { data } = await supabase.from('cash_sessions').select('*').eq('user_id', profile!.id).eq('location_id', locationId!).eq('status', 'OPEN').maybeSingle();
      return data as Row | null;
    },
  });
  const [float, setFloat] = useState(0);

  // ---------- Catalogue ----------
  const { data: categories = [] } = useQuery({
    queryKey: ['pos-categories'],
    queryFn: async () => (await supabase.from('categories').select('id, name').eq('is_active', true).is('parent_id', null).order('name')).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ['pos-products', category, gridSearch],
    queryFn: async () => {
      let q = supabase.from('products').select('id, code, name, sell_price, taxable, image_url, category_id').eq('is_active', true);
      if (category) {
        const { data: subs } = await supabase.from('categories').select('id').eq('parent_id', category);
        q = q.in('category_id', [category, ...(subs ?? []).map((s) => s.id)]);
      }
      if (gridSearch) q = q.or(`name.ilike.${like(gridSearch)},code.ilike.${like(gridSearch)}`);
      return (await q.order('name').limit(120)).data ?? [];
    },
  });

  const taxCfg = { taxRate: Number(settings?.tax_rate ?? 0), taxInclusive: !!settings?.tax_inclusive };
  const totals = computeTotals(cart, billDiscount, taxCfg);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);

  const addProduct = useCallback(async (p: Row) => {
    let price = Number(p.sell_price);
    if (customer) {
      try { price = Number(await rpc('get_price', { p_product: p.id, p_customer: customer.id })); } catch { /* list price */ }
    }
    setCart((c) => {
      const i = c.findIndex((l) => l.product_id === p.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { product_id: p.id, code: p.code, name: p.name, qty: 1, price, discount: 0, taxable: p.taxable }];
    });
  }, [customer]);

  function clear() {
    setCart([]);
    setCustomer(null);
    setBillDiscount(0);
    setHeldId(null);
  }

  async function hold() {
    if (!cart.length) return;
    const label = customer?.name ?? `Bill ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const { error } = await supabase.from('held_carts').insert({
      location_id: locationId, user_id: profile!.id, label, customer_id: customer?.id ?? null,
      data: { cart, billDiscount, customer },
    });
    if (error) return toast('err', error.message);
    if (heldId) await supabase.from('held_carts').delete().eq('id', heldId);
    toast('ok', `Held: ${label}`);
    clear();
    qc.invalidateQueries({ queryKey: ['held'] });
  }

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F4' || (e.key === 'Enter' && e.ctrlKey)) { e.preventDefault(); if (cart.length) setModal('pay'); }
      if (e.key === 'F8') { e.preventDefault(); hold(); }
      if (e.key === 'F9') { e.preventDefault(); setModal('held'); }
      if (e.key === 'F1') { e.preventDefault(); setModal('keys'); }
      if (e.key === 'Escape' && !modal && e.shiftKey) clear();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------- Open register screen ----------
  if (!locationId) return <Gate><ErrorBox error="Select a working location from the top bar first." /><Link to="/" className="btn-secondary mt-4">Back</Link></Gate>;
  if (session.isLoading) return <Gate>Loading…</Gate>;
  if (!session.data) {
    return (
      <Gate>
        <Lock className="mx-auto mb-3 text-gold-400" size={32} />
        <h2 className="font-display text-2xl text-white">Open the register</h2>
        <p className="mb-6 mt-1 text-sm text-ink-300">Count the cash in the drawer to start the shift.</p>
        <Field label="Opening float"><input type="number" step="any" min="0" className="input text-center text-lg" value={float} onChange={(e) => setFloat(Number(e.target.value))} autoFocus /></Field>
        <button
          className="btn-gold mt-4 w-full py-3"
          onClick={async () => {
            try { await rpc('pos_open_session', { p_location: locationId, p_float: float }); session.refetch(); }
            catch (e) { toast('err', (e as Error).message); }
          }}
        >
          <Play size={16} /> Start shift
        </button>
        <Link to="/" className="mt-3 block text-xs text-ink-400 hover:text-white">← Back to portal</Link>
      </Gate>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-ink-50">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 bg-ink-950 px-4 text-white">
        <Link to="/" className="rounded-lg p-1.5 text-ink-300 hover:bg-white/10 hover:text-white" title="Back to portal"><ArrowLeft size={18} /></Link>
        <div className="font-display text-lg tracking-wide">amoka<span className="text-gold-300">.</span>pos</div>
        <div className="ml-4 hidden flex-1 md:block"><div className="max-w-xl"><ProductPicker onPick={addProduct} locationId={locationId} autoFocus placeholder="Scan barcode or search… (Enter)" /></div></div>
        <div className="ml-auto flex items-center gap-1">
          <TopBtn icon={<List size={16} />} label="Invoices" onClick={() => setModal('invoices')} />
          <TopBtn icon={<Play size={16} />} label="Recall (F9)" onClick={() => setModal('held')} />
          <TopBtn icon={<Banknote size={16} />} label="Cash In/Out" onClick={() => setModal('cash')} />
          <TopBtn icon={<Wallet size={16} />} label="Settlement" onClick={() => setModal('settle')} />
          <TopBtn icon={<Keyboard size={16} />} label="Keys" onClick={() => setModal('keys')} />
          {lastSale && <TopBtn icon={<Printer size={16} />} label="Reprint" onClick={() => reprint(lastSale.id)} />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Catalogue */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-2 overflow-x-auto border-b border-ink-100 bg-white px-4 py-3">
            <Chip active={!category} onClick={() => setCategory(null)}>All</Chip>
            {categories.map((c: Row) => <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</Chip>)}
            <input className="input ml-auto w-48 py-1.5 md:hidden" placeholder="Search" value={gridSearch} onChange={(e) => setGridSearch(e.target.value)} />
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 xl:grid-cols-5">
            {products.map((p: Row) => (
              <button key={p.id} onClick={() => addProduct(p)} className="group card flex flex-col overflow-hidden text-left transition hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-lg active:scale-[0.98]">
                <div className="flex h-24 items-center justify-center bg-gradient-to-br from-ink-50 to-gold-50">
                  {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : <span className="font-display text-3xl text-gold-500/60">{p.name.slice(0, 1)}</span>}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <div className="line-clamp-2 text-[13px] font-medium leading-snug text-ink-900">{p.name}</div>
                  <div className="mt-auto pt-2 text-sm font-semibold tabular-nums text-gold-700">{money(p.sell_price)}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Cart */}
        <aside className="flex w-[400px] shrink-0 flex-col border-l border-ink-100 bg-white">
          <div className="border-b border-ink-100 p-3">
            <PartyPicker table="customers" value={customer} onChange={setCustomer} placeholder="Walk-in customer — search to select" />
          </div>
          <div className="flex-1 overflow-y-auto">
            {!cart.length && <div className="flex h-full flex-col items-center justify-center text-sm text-ink-300"><User size={28} className="mb-2" />Cart is empty</div>}
            {cart.map((l, i) => (
              <div key={l.product_id} className="flex items-center gap-2 border-b border-ink-50 px-3 py-2.5">
                <button className="min-w-0 flex-1 text-left" onClick={() => { setEditIdx(i); setModal('edit'); }}>
                  <div className="truncate text-sm font-medium text-ink-900">{l.name}</div>
                  <div className="text-xs text-ink-400">{money(l.price)}{l.discount ? ` · disc ${money(l.discount)}` : ''}</div>
                </button>
                <div className="flex items-center rounded-lg border border-ink-200">
                  <button className="p-1.5 text-ink-500 hover:text-ink-900" onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus size={14} /></button>
                  <span className="w-8 text-center text-sm font-semibold tabular-nums">{l.qty}</span>
                  <button className="p-1.5 text-ink-500 hover:text-ink-900" onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}><Plus size={14} /></button>
                </div>
                <div className="w-20 text-right text-sm font-semibold tabular-nums">{money(totals.lineTotals[i])}</div>
                <button className="p-1 text-ink-300 hover:text-rose-600" onClick={() => setCart(cart.filter((_, j) => j !== i))}><X size={15} /></button>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-ink-100 bg-ink-50/60 p-4 text-sm">
            <div className="flex justify-between text-ink-500"><span>Items</span><span className="tabular-nums">{itemCount}</span></div>
            <div className="flex items-center justify-between text-ink-500">
              <span>Bill discount</span>
              <input type="number" min="0" step="any" className="input num w-24 py-1" value={billDiscount || ''} onChange={(e) => setBillDiscount(Number(e.target.value))} />
            </div>
            <div className="flex justify-between text-ink-500"><span>{settings?.tax_name} {Number(settings?.tax_rate ?? 0)}%{taxCfg.taxInclusive ? ' (incl.)' : ''}</span><span className="tabular-nums">{money(totals.tax)}</span></div>
            <div className="flex items-end justify-between pt-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">Total</span>
              <span className="font-display text-3xl font-semibold tabular-nums text-ink-900">{money(totals.total)}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 p-3">
            <button className="btn-secondary py-3" onClick={clear} disabled={!cart.length}><Trash2 size={15} /> Clear</button>
            <button className="btn-secondary py-3" onClick={hold} disabled={!cart.length}><Pause size={15} /> Hold</button>
            <button className="btn-gold py-3 text-base" onClick={() => setModal('pay')} disabled={!cart.length}>Pay</button>
          </div>
        </aside>
      </div>

      {modal === 'pay' && (
        <PayModal
          total={totals.total}
          paymodes={paymodes}
          hasCustomer={!!customer}
          onClose={() => setModal(null)}
          onConfirm={async (payments) => {
            const res = await rpc<Row>('pos_checkout', {
              p: {
                customer_id: customer?.id ?? null, location_id: locationId, discount: billDiscount, held_cart_id: heldId,
                lines: cart.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price, discount: l.discount })),
                payments,
              },
            });
            const inv = res.invoice as Row;
            setLastSale(inv);
            printReceipt({
              settings, doc: inv, cashier: profile?.full_name, customer: customer?.name,
              lines: cart.map((l, i) => ({ description: l.name, qty: l.qty, price: l.price, discount: l.discount, line_total: totals.lineTotals[i] })),
              payments: payments.map((p) => ({ name: paymodes.find((m) => m.id === p.paymode_id)?.name ?? '', amount: p.amount })),
              change: Number(res.change),
            });
            toast('ok', `${inv.doc_no} · change ${money(res.change)}`);
            clear();
            setModal(null);
            qc.invalidateQueries();
          }}
        />
      )}

      {modal === 'edit' && editIdx !== null && cart[editIdx] && (
        <EditLine line={cart[editIdx]} onClose={() => setModal(null)} onSave={(l) => { setCart(cart.map((x, j) => (j === editIdx ? l : x))); setModal(null); }} />
      )}
      {modal === 'held' && <HeldModal onClose={() => setModal(null)} onRecall={(h) => { const d = h.data; setCart(d.cart ?? []); setBillDiscount(d.billDiscount ?? 0); setCustomer(d.customer ?? null); setHeldId(h.id); setModal(null); }} />}
      {modal === 'cash' && <CashModal sessionId={session.data.id} onClose={() => setModal(null)} />}
      {modal === 'settle' && <SettleModal sessionId={session.data.id} onClose={() => setModal(null)} onClosed={() => { setModal(null); session.refetch(); }} />}
      {modal === 'invoices' && <InvoicesModal sessionOpenedAt={session.data.opened_at} onClose={() => setModal(null)} onReprint={reprint} />}
      {modal === 'keys' && (
        <Modal open onClose={() => setModal(null)} title="Shortcut keys" size="sm">
          <table className="table"><tbody>
            {[['Enter', 'Add scanned / searched product'], ['F4 or Ctrl+Enter', 'Pay'], ['F8', 'Hold bill'], ['F9', 'Recall held bill'], ['Shift+Esc', 'Clear cart'], ['F1', 'This list']].map(([k, v]) => (
              <tr key={k}><td><kbd className="rounded bg-ink-100 px-2 py-0.5 text-xs font-semibold">{k}</kbd></td><td>{v}</td></tr>
            ))}
          </tbody></table>
        </Modal>
      )}
    </div>
  );

  async function reprint(docId: number) {
    const { data: d } = await supabase
      .from('sales_docs')
      .select('*, customer:customers(name), lines:sales_lines(*), allocations:receipt_allocations(amount, receipt:receipts(status, paymode:paymodes(name)))')
      .eq('id', docId)
      .single();
    if (!d) return;
    printReceipt({
      settings, doc: d, reprint: true, cashier: profile?.full_name, customer: d.customer?.name,
      lines: d.lines.sort((a: Row, b: Row) => a.line_no - b.line_no),
      payments: d.allocations.filter((a: Row) => a.receipt.status === 'ACTIVE').map((a: Row) => ({ name: a.receipt.paymode.name, amount: a.amount })),
    });
  }
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-ink-200 backdrop-blur [&_.label]:text-left [&_.label]:text-ink-300">{children}</div>
    </div>
  );
}

function TopBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-300 hover:bg-white/10 hover:text-white">
      {icon}<span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${active ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'}`}>
      {children}
    </button>
  );
}

function PayModal({ total, paymodes, hasCustomer, onClose, onConfirm }: {
  total: number; paymodes: Row[]; hasCustomer: boolean; onClose: () => void; onConfirm: (p: Pay[]) => Promise<void>;
}) {
  const cash = paymodes.find((p) => p.is_cash) ?? paymodes[0];
  const [pays, setPays] = useState<Pay[]>(cash ? [{ paymode_id: cash.id, amount: total }] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tendered = round2(pays.reduce((s, p) => s + (p.amount || 0), 0));
  const remaining = round2(total - tendered);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);

  const quick = useMemo(() => {
    const opts = new Set<number>([total]);
    for (const n of [5, 10, 20, 50, 100]) if (n > total) opts.add(n);
    opts.add(Math.ceil(total));
    return [...opts].sort((a, b) => a - b).slice(0, 5);
  }, [total]);

  async function confirm() {
    setError(null);
    if (remaining > 0.004 && !hasCustomer) return setError('Payment is less than the total. Select a customer to put the balance on credit.');
    setBusy(true);
    try { await onConfirm(pays.filter((p) => p.amount > 0)); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Payment" size="md"
      footer={<><button className="btn-secondary" onClick={onClose}>Back</button><button className="btn-gold px-8" onClick={confirm} disabled={busy}>{busy ? 'Saving…' : 'Complete sale'}</button></>}>
      <div className="mb-4 rounded-2xl bg-ink-950 p-5 text-center text-white">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-300">Amount due</div>
        <div className="font-display text-4xl font-semibold tabular-nums">{money(total)}</div>
      </div>
      <ErrorBox error={error} />
      <div className="mt-3 space-y-2">
        {pays.map((p, i) => (
          <div key={i} className="flex gap-2">
            <select className="input w-44" value={p.paymode_id} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, paymode_id: Number(e.target.value) } : x)))}>
              {paymodes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input ref={i === 0 ? ref : undefined} type="number" step="any" min="0" className="input num text-lg font-semibold" value={p.amount || ''} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} onKeyDown={(e) => e.key === 'Enter' && confirm()} />
            <input className="input w-32" placeholder="Ref / approval" value={p.reference ?? ''} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
            {pays.length > 1 && <button className="btn-ghost p-2" onClick={() => setPays(pays.filter((_, j) => j !== i))}><X size={15} /></button>}
          </div>
        ))}
        <button className="btn-ghost btn-sm" onClick={() => setPays([...pays, { paymode_id: paymodes.find((m) => !m.is_cash)?.id ?? paymodes[0].id, amount: Math.max(remaining, 0) }])}>
          <Plus size={14} /> Split payment
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {quick.map((q) => (
          <button key={q} className="btn-secondary" onClick={() => setPays(pays.map((x, j) => (j === 0 ? { ...x, amount: q } : x)))}>{money(q)}</button>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-ink-50 p-3"><div className="text-xs text-ink-400">Tendered</div><div className="text-xl font-semibold tabular-nums">{money(tendered)}</div></div>
        <div className={`rounded-xl p-3 ${remaining > 0.004 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
          <div className="text-xs text-ink-400">{remaining > 0.004 ? (hasCustomer ? 'On credit' : 'Remaining') : 'Change'}</div>
          <div className="text-xl font-semibold tabular-nums">{money(Math.abs(remaining))}</div>
        </div>
      </div>
    </Modal>
  );
}

function EditLine({ line, onClose, onSave }: { line: CartLine; onClose: () => void; onSave: (l: CartLine) => void }) {
  const [l, setL] = useState(line);
  return (
    <Modal open onClose={onClose} title={line.name} size="sm" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => onSave(l)}>Apply</button></>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Qty"><input type="number" step="any" min="0" className="input num" value={l.qty} onChange={(e) => setL({ ...l, qty: Number(e.target.value) })} /></Field>
        <Field label="Price"><input type="number" step="any" min="0" className="input num" value={l.price} onChange={(e) => setL({ ...l, price: Number(e.target.value) })} /></Field>
        <Field label="Discount"><input type="number" step="any" min="0" className="input num" value={l.discount} onChange={(e) => setL({ ...l, discount: Number(e.target.value) })} /></Field>
      </div>
    </Modal>
  );
}

function HeldModal({ onClose, onRecall }: { onClose: () => void; onRecall: (h: Row) => void }) {
  const { locationId } = useAuth();
  const { data = [], refetch } = useQuery({
    queryKey: ['held', locationId],
    queryFn: async () => (await supabase.from('held_carts').select('*').eq('location_id', locationId!).order('id', { ascending: false })).data ?? [],
  });
  return (
    <Modal open onClose={onClose} title="Held bills" size="md">
      {!data.length ? <div className="py-8 text-center text-sm text-ink-400">No held bills</div> : data.map((h: Row) => (
        <div key={h.id} className="flex items-center justify-between border-b border-ink-50 py-2.5">
          <div><div className="font-medium">{h.label}</div><div className="text-xs text-ink-400">{dateTimeFmt(h.created_at)} · {h.data?.cart?.length ?? 0} items</div></div>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={() => onRecall(h)}>Recall</button>
            <button className="btn-ghost btn-sm text-rose-600" onClick={async () => { await supabase.from('held_carts').delete().eq('id', h.id); refetch(); }}>Delete</button>
          </div>
        </div>
      ))}
    </Modal>
  );
}

function CashModal({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title="Cash in / out" size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={async () => {
        try { await rpc('pos_cash_movement', { p_session: sessionId, p_type: type, p_amount: amount, p_reason: reason }); toast('ok', 'Recorded'); onClose(); }
        catch (e) { toast('err', (e as Error).message); }
      }} disabled={!(amount > 0) || !reason}>Save</button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['IN', 'OUT'] as const).map((t) => <button key={t} className={type === t ? 'btn-primary' : 'btn-secondary'} onClick={() => setType(t)}>Cash {t === 'IN' ? 'in' : 'out'}</button>)}
        </div>
        <Field label="Amount"><input type="number" step="any" min="0" className="input num" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} autoFocus /></Field>
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Petty cash, change float, bank-in…" /></Field>
      </div>
    </Modal>
  );
}

export function SettlementReport({ sum }: { sum: Row }) {
  const diff = sum.session.counted_cash != null ? Number(sum.session.counted_cash) - Number(sum.expected_cash) : null;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-ink-50 p-3"><div className="text-xs text-ink-400">Invoices</div><div className="text-xl font-semibold">{sum.invoice_count}</div></div>
        <div className="rounded-xl bg-ink-50 p-3"><div className="text-xs text-ink-400">Collected</div><div className="text-xl font-semibold tabular-nums">{money(sum.total_collected)}</div></div>
      </div>
      <table className="table">
        <thead><tr><th>Paymode</th><th className="num">Count</th><th className="num">Amount</th></tr></thead>
        <tbody>{sum.by_paymode.map((p: Row) => <tr key={p.code}><td>{p.name}</td><td className="num">{p.count}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody>
      </table>
      <table className="w-full">
        <tbody className="[&_td]:py-1">
          <tr><td className="text-ink-500">Opening float</td><td className="num">{money(sum.session.opening_float)}</td></tr>
          <tr><td className="text-ink-500">+ Cash sales</td><td className="num">{money(sum.cash_sales)}</td></tr>
          <tr><td className="text-ink-500">+ Cash in</td><td className="num">{money(sum.cash_in)}</td></tr>
          <tr><td className="text-ink-500">− Cash out</td><td className="num">{money(sum.cash_out)}</td></tr>
          <tr className="border-t border-ink-200 font-semibold"><td>Expected cash in drawer</td><td className="num">{money(sum.expected_cash)}</td></tr>
          {diff !== null && (
            <>
              <tr><td className="text-ink-500">Counted</td><td className="num">{money(sum.session.counted_cash)}</td></tr>
              <tr className={`font-semibold ${Math.abs(diff) > 0.004 ? 'text-rose-600' : 'text-emerald-700'}`}><td>{diff < 0 ? 'Short' : diff > 0 ? 'Over' : 'Balanced'}</td><td className="num">{money(diff)}</td></tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SettleModal({ sessionId, onClose, onClosed }: { sessionId: number; onClose: () => void; onClosed: () => void }) {
  const toast = useToast();
  const [counted, setCounted] = useState<number | ''>('');
  const { data: sum } = useQuery({ queryKey: ['settle', sessionId], queryFn: () => rpc<Row>('pos_session_summary', { p_session: sessionId }) });
  return (
    <Modal open onClose={onClose} title="Settlement (end of shift)" size="md"
      footer={<><button className="btn-secondary" onClick={() => window.print()}>Print</button><button className="btn-danger" disabled={counted === ''} onClick={async () => {
        if (!confirm('Close this shift? You will need to open a new one to continue selling.')) return;
        try { await rpc('pos_close_session', { p_session: sessionId, p_counted: Number(counted) }); toast('ok', 'Shift closed'); onClosed(); }
        catch (e) { toast('err', (e as Error).message); }
      }}>Close shift</button></>}>
      {!sum ? 'Loading…' : (
        <>
          <SettlementReport sum={sum} />
          <Field label="Cash counted in drawer" className="mt-4"><input type="number" step="any" min="0" className="input num text-lg" value={counted} onChange={(e) => setCounted(e.target.value === '' ? '' : Number(e.target.value))} /></Field>
        </>
      )}
    </Modal>
  );
}

function InvoicesModal({ sessionOpenedAt, onClose, onReprint }: { sessionOpenedAt: string; onClose: () => void; onReprint: (id: number) => void }) {
  const { profile, locationId } = useAuth();
  const { data = [] } = useQuery({
    queryKey: ['pos-invoices', sessionOpenedAt],
    queryFn: async () => (await supabase.from('sales_docs').select('id, doc_no, doc_date, total, status, customer:customers(name)')
      .eq('type', 'INVOICE').eq('is_pos', true).eq('user_id', profile!.id).eq('location_id', locationId!)
      .gte('doc_date', sessionOpenedAt).order('id', { ascending: false }).limit(200)).data ?? [],
  });
  return (
    <Modal open onClose={onClose} title="This shift's invoices" size="lg">
      <table className="table">
        <thead><tr><th>No.</th><th>Time</th><th>Customer</th><th className="num">Total</th><th /></tr></thead>
        <tbody>
          {data.map((d: Row) => (
            <tr key={d.id}>
              <td><Link to={`/sales/doc/${d.id}`} className="font-medium hover:text-gold-600">{d.doc_no}</Link>{d.status === 'VOID' && <span className="ml-2 text-xs text-rose-600">VOID</span>}</td>
              <td>{dateTimeFmt(d.doc_date)}</td>
              <td>{d.customer?.name ?? 'Walk-in'}</td>
              <td className="num">{money(d.total)}</td>
              <td><button className="btn-secondary btn-sm" onClick={() => onReprint(d.id)}><Printer size={13} /> Reprint</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
