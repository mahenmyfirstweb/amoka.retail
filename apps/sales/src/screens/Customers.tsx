import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MapPin, MessageCircle, Phone, Plus, Search, Store as StoreIcon, UserRound } from 'lucide-react';
import { useStore, type Row } from '../lib/store';
import { supabase } from '../lib/supabase';
import { dateFmt, money } from '../lib/format';
import { Empty, Sheet, TopBar, useToast } from '../ui';

export default function Customers() {
  const { customers, setCustomer, customer, profile, online, refreshData } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(true);
  const [info, setInfo] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const hasAssigned = customers.some((c) => c.salesman_id === profile?.id);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (!mine || !hasAssigned || c.salesman_id === profile?.id) &&
        (!t || c.name.toLowerCase().includes(t) || c.code.toLowerCase().includes(t) || (c.phone ?? '').includes(t) || (c.area?.name ?? '').toLowerCase().includes(t)),
    );
  }, [customers, q, mine, hasAssigned, profile]);

  async function choose(c: Row) {
    await setCustomer(c);
    nav('/catalog');
  }

  return (
    <div>
      <TopBar title="Retail shops" back right={online && <button className="rounded-full p-2 active:bg-white/10" onClick={() => setAdding(true)}><Plus size={22} /></button>} />
      <div className="sticky top-14 z-20 space-y-2 bg-ink-50/95 px-3 pb-2 pt-3 backdrop-blur">
        <div className="relative">
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-300" />
          <input className="input rounded-full py-2.5 pl-10" placeholder="Shop name, code, phone or area" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {hasAssigned && (
          <div className="flex gap-2 text-xs font-semibold">
            <button className={`rounded-full px-3 py-1.5 ${mine ? 'bg-ink-900 text-white' : 'bg-white text-ink-500'}`} onClick={() => setMine(true)}>My shops</button>
            <button className={`rounded-full px-3 py-1.5 ${!mine ? 'bg-ink-900 text-white' : 'bg-white text-ink-500'}`} onClick={() => setMine(false)}>All shops</button>
          </div>
        )}
      </div>
      {!list.length ? <Empty icon={<StoreIcon size={44} />} title="No shops found" /> : (
        <div className="divide-y divide-ink-100 bg-white">
          {list.map((c) => (
            <div key={c.id} className={`flex items-center gap-3 px-4 py-3 ${customer?.id === c.id ? 'bg-gold-50' : ''}`}>
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => choose(c)}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-900 font-display text-lg text-gold-300">{c.name.slice(0, 1)}</div>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink-900">{c.name}</div>
                  <div className="truncate text-xs text-ink-400">{[c.code, c.area?.name, c.phone].filter(Boolean).join(' · ')}</div>
                </div>
              </button>
              <button className="rounded-full px-3 py-1.5 text-xs font-semibold text-gold-700 ring-1 ring-gold-200" onClick={() => setInfo(c)}>Info</button>
            </div>
          ))}
        </div>
      )}
      <CustomerInfo c={info} onClose={() => setInfo(null)} onChoose={choose} />
      <AddCustomer open={adding} onClose={() => setAdding(false)} onSaved={async (c) => { setAdding(false); await refreshData(); choose(c); }} />
    </div>
  );
}

function CustomerInfo({ c, onClose, onChoose }: { c: Row | null; onClose: () => void; onChoose: (c: Row) => void }) {
  const nav = useNavigate();
  const { online } = useStore();
  const { data } = useQuery({
    queryKey: ['cust-info', c?.id],
    enabled: !!c && online,
    queryFn: async () => {
      const { data: docs } = await supabase
        .from('sales_docs')
        .select('id, doc_no, type, doc_date, total, paid, credited, status')
        .eq('customer_id', c!.id)
        .neq('status', 'VOID')
        .order('id', { ascending: false })
        .limit(30);
      const invoices = (docs ?? []).filter((d) => d.type === 'INVOICE');
      const outstanding = invoices.reduce((s, d) => s + Math.max(d.total - d.paid - d.credited, 0), 0);
      return { docs: docs ?? [], outstanding };
    },
  });
  if (!c) return null;
  const tel = c.phone?.replace(/[^\d+]/g, '');
  return (
    <Sheet open onClose={onClose} title={c.name} footer={<button className="btn-gold w-full" onClick={() => { onClose(); onChoose(c); }}>Start order for this shop</button>}>
      <div className="space-y-1 text-sm text-ink-600">
        {c.contact_person && <div className="flex items-center gap-2"><UserRound size={15} /> {c.contact_person}</div>}
        {c.address && <div className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-line">{c.address}</span></div>}
        <div className="text-xs text-ink-400">Terms: {c.terms_days ? `${c.terms_days} days` : 'Cash'} · Credit limit {money(c.credit_limit)}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {tel && <a href={`tel:${tel}`} className="btn-secondary py-2.5 text-xs"><Phone size={15} /> Call</a>}
        {tel && <a href={`https://wa.me/${tel.replace('+', '')}`} target="_blank" rel="noreferrer" className="btn-secondary py-2.5 text-xs"><MessageCircle size={15} /> WhatsApp</a>}
        {c.address && <a href={`https://maps.google.com/?q=${encodeURIComponent(c.address)}`} target="_blank" rel="noreferrer" className="btn-secondary py-2.5 text-xs"><MapPin size={15} /> Map</a>}
      </div>
      {data && (
        <>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-ink-900 p-4 text-white">
            <div><div className="text-xs text-gold-300">Outstanding</div><div className="text-xl font-semibold tabular-nums">{money(data.outstanding)}</div></div>
            {data.outstanding > 0 && <button className="btn-gold py-2 text-xs" onClick={() => { onClose(); nav(`/collect/${c.id}`); }}>Collect</button>}
          </div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink-400">Recent documents</div>
          <div className="mt-1 divide-y divide-ink-100">
            {data.docs.slice(0, 10).map((d) => (
              <button key={d.id} className="flex w-full justify-between py-2 text-left text-sm" onClick={() => { onClose(); nav(`/orders/${d.id}`); }}>
                <span>{d.doc_no} <span className="text-xs text-ink-400">{dateFmt(d.doc_date)}</span></span>
                <span className="tabular-nums">{money(d.total)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function AddCustomer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (c: Row) => void }) {
  const toast = useToast();
  const { profile } = useStore();
  const [f, setF] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name?.trim()) return toast('err', 'Enter the shop name');
    setBusy(true);
    const code = (f.code?.trim() || `C${Date.now().toString().slice(-6)}`).toUpperCase();
    const { data, error } = await supabase
      .from('customers')
      .insert({ code, name: f.name.trim(), contact_person: f.contact_person || null, phone: f.phone || null, address: f.address || null, salesman_id: profile?.id })
      .select()
      .single();
    setBusy(false);
    if (error) return toast('err', error.message);
    toast('ok', 'Shop added');
    setF({});
    onSaved(data);
  }
  const field = (k: string, label: string, type = 'text') => (
    <label className="block"><span className="label">{label}</span>
      {type === 'textarea'
        ? <textarea className="input" rows={2} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        : <input className="input" type={type} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
    </label>
  );
  return (
    <Sheet open={open} onClose={onClose} title="New retail shop" footer={<button className="btn-primary w-full" onClick={save} disabled={busy}>Save shop</button>}>
      <div className="space-y-3">
        {field('name', 'Shop name *')}
        {field('contact_person', 'Contact person')}
        {field('phone', 'Phone', 'tel')}
        {field('address', 'Address', 'textarea')}
        {field('code', 'Code (optional — auto if empty)')}
      </div>
    </Sheet>
  );
}
