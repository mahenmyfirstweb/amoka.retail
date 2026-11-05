import { useMemo, useState } from 'react';
import { LayoutGrid, List, PackageSearch, RefreshCw, Search, X } from 'lucide-react';
import { stockAt, useStore, type Row } from '../lib/store';
import { money, qtyFmt } from '../lib/format';
import { CustomerBar, Empty, ProductImage, Sheet, Stepper, TopBar } from '../ui';

export default function Catalog() {
  const { products, categories, priceFor, cartQty, addToCart, setQty, profile, refreshData, syncing } = useStore();
  const [cat, setCat] = useState<number | null>(null);
  const [sub, setSub] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('amoka.sales.view') as 'grid' | 'list') ?? 'grid');
  const [detail, setDetail] = useState<Row | null>(null);
  const loc = profile?.location_id;

  const mains = categories.filter((c) => !c.parent_id);
  const subs = cat ? categories.filter((c) => c.parent_id === cat) : [];
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    const parentOf = new Map(categories.map((c) => [c.id, c.parent_id ?? c.id]));
    for (const p of products) {
      const top = parentOf.get(p.category_id) ?? p.category_id;
      m.set(top, (m.get(top) ?? 0) + 1);
    }
    return m;
  }, [products, categories]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const allowed = sub ? new Set([sub]) : cat ? new Set([cat, ...subs.map((s) => s.id)]) : null;
    return products.filter(
      (p) =>
        (!allowed || allowed.has(p.category_id)) &&
        (!term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term) || p.barcode === q.trim()),
    );
  }, [products, cat, sub, subs, q]);

  function toggleView(v: 'grid' | 'list') {
    setView(v);
    localStorage.setItem('amoka.sales.view', v);
  }

  return (
    <div className="pb-4">
      <TopBar
        title="Catalog"
        right={
          <div className="flex gap-1">
            <button className="rounded-full p-2 active:bg-white/10" onClick={() => refreshData()} title="Refresh">
              <RefreshCw size={19} className={syncing ? 'animate-spin' : ''} />
            </button>
            <button className="rounded-full p-2 active:bg-white/10" onClick={() => toggleView(view === 'grid' ? 'list' : 'grid')}>
              {view === 'grid' ? <List size={20} /> : <LayoutGrid size={20} />}
            </button>
          </div>
        }
      />
      <CustomerBar />
      <div className="sticky top-14 z-20 space-y-2 bg-ink-50/95 px-3 pb-2 pt-3 backdrop-blur">
        <div className="relative">
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-300" />
          <input className="input rounded-full py-2.5 pl-10" placeholder="Search products or scan barcode" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" onClick={() => setQ('')}><X size={17} /></button>}
        </div>
        <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3">
          <CatChip active={!cat} onClick={() => { setCat(null); setSub(null); }}>All · {products.length}</CatChip>
          {mains.map((c) => (
            <CatChip key={c.id} active={cat === c.id} onClick={() => { setCat(c.id); setSub(null); }}>
              {c.name} · {counts.get(c.id) ?? 0}
            </CatChip>
          ))}
        </div>
        {subs.length > 0 && (
          <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3">
            <SubChip active={!sub} onClick={() => setSub(null)}>All</SubChip>
            {subs.map((s) => <SubChip key={s.id} active={sub === s.id} onClick={() => setSub(s.id)}>{s.name}</SubChip>)}
          </div>
        )}
      </div>

      {!products.length ? (
        <Empty icon={<PackageSearch size={44} />} title="No products loaded">Connect to the internet and tap refresh.</Empty>
      ) : !list.length ? (
        <Empty icon={<PackageSearch size={44} />} title="No products match" />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 px-3 pt-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.map((p) => {
            const qty = cartQty(p.id);
            const stock = stockAt(p, loc);
            return (
              <div key={p.id} onClick={() => setDetail(p)} className={`card flex flex-col overflow-hidden active:scale-[0.99] ${qty ? 'ring-2 ring-gold-400' : ''}`}>
                <div className="relative">
                  <ProductImage p={p} className="aspect-square w-full" />
                  <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${stock > 0 ? 'bg-white/90 text-ink-600' : 'bg-rose-600 text-white'}`}>
                    {stock > 0 ? `${qtyFmt(stock)} in stock` : 'Out of stock'}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <div className="line-clamp-2 text-[13px] font-medium leading-snug text-ink-900">{p.name}</div>
                  <div className="mt-0.5 text-[11px] text-ink-400">{p.code}{p.uom?.code ? ` · ${p.uom.code}` : ''}</div>
                  <div className="mt-auto flex items-center justify-between pt-2.5">
                    <div className="font-semibold tabular-nums text-ink-900">{money(priceFor(p))}</div>
                    {qty ? (
                      <Stepper size="sm" value={qty} onChange={(v) => setQty(p.id, v)} />
                    ) : (
                      <button className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-lg text-white active:scale-90" onClick={(e) => { e.stopPropagation(); addToCart(p); }}>+</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-ink-100 bg-white">
          {list.map((p) => {
            const qty = cartQty(p.id);
            const stock = stockAt(p, loc);
            return (
              <div key={p.id} onClick={() => setDetail(p)} className="flex items-center gap-3 px-3 py-2.5 active:bg-ink-50">
                <ProductImage p={p} className="h-14 w-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-900">{p.name}</div>
                  <div className="text-xs text-ink-400">{p.code} · <span className={stock > 0 ? '' : 'text-rose-600'}>stock {qtyFmt(stock)}</span></div>
                  <div className="text-sm font-semibold tabular-nums">{money(priceFor(p))}</div>
                </div>
                {qty ? <Stepper size="sm" value={qty} onChange={(v) => setQty(p.id, v)} /> : (
                  <button className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-lg text-white" onClick={(e) => { e.stopPropagation(); addToCart(p); }}>+</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ProductSheet p={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function CatChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition ${active ? 'bg-ink-900 text-white shadow' : 'bg-white text-ink-600 ring-1 ring-ink-100'}`}>
      {children}
    </button>
  );
}
function SubChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${active ? 'bg-gold-100 text-gold-700 ring-1 ring-gold-300' : 'text-ink-500'}`}>
      {children}
    </button>
  );
}

function ProductSheet({ p, onClose }: { p: Row | null; onClose: () => void }) {
  const { priceFor, cartQty, setQty, addToCart, profile, customer } = useStore();
  const [img, setImg] = useState(0);
  if (!p) return null;
  const qty = cartQty(p.id);
  const gallery = [p.image_url, ...(p.images ?? []).sort((a: Row, b: Row) => a.sort_order - b.sort_order).map((i: Row) => i.url)].filter(Boolean);
  const carton = Number(p.pcs_per_carton) > 1 ? Number(p.pcs_per_carton) : 0;
  const price = priceFor(p);
  return (
    <Sheet
      open
      onClose={() => { setImg(0); onClose(); }}
      footer={
        <div className="flex items-center gap-3">
          {qty ? <Stepper value={qty} onChange={(v) => setQty(p.id, v)} /> : null}
          <button className="btn-gold flex-1" onClick={() => { if (!qty) addToCart(p); onClose(); }}>
            {qty ? `Done · ${money(qty * price)}` : `Add to cart · ${money(price)}`}
          </button>
        </div>
      }
    >
      <div className="-mx-5 mb-4">
        {gallery.length ? (
          <img src={gallery[img]} alt="" className="aspect-[4/3] w-full bg-ink-50 object-contain" />
        ) : (
          <ProductImage p={p} className="aspect-[4/3] w-full" />
        )}
        {gallery.length > 1 && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pt-2">
            {gallery.map((g, i) => (
              <img key={i} src={g} alt="" onClick={() => setImg(i)} className={`h-14 w-14 shrink-0 rounded-lg object-cover ${i === img ? 'ring-2 ring-gold-400' : 'opacity-60'}`} />
            ))}
          </div>
        )}
      </div>
      <div className="text-xs font-medium uppercase tracking-wider text-gold-600">{p.brand?.name ?? p.code}</div>
      <h2 className="mt-1 font-display text-2xl leading-tight text-ink-900">{p.name}</h2>
      <div className="mt-3 flex items-end gap-3">
        <div className="text-2xl font-semibold tabular-nums">{money(price)}</div>
        {price !== Number(p.sell_price) && <div className="pb-0.5 text-sm text-ink-400 line-through">{money(p.sell_price)}</div>}
        {customer && price !== Number(p.sell_price) && <span className="pb-1 text-xs font-medium text-emerald-600">price for {customer.name}</span>}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <Info label="Stock here" value={qtyFmt(stockAt(p, profile?.location_id))} />
        <Info label="Unit" value={p.uom?.code ?? '—'} />
        <Info label="Per carton" value={carton ? qtyFmt(carton) : '—'} />
      </div>
      {p.description && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink-600">{p.description}</p>}
      {carton > 0 && (
        <button className="btn-secondary mt-4 w-full" onClick={() => addToCart(p, carton)}>+ Add 1 carton ({qtyFmt(carton)} {p.uom?.code ?? 'pcs'})</button>
      )}
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-50 px-2 py-2.5">
      <div className="text-ink-400">{label}</div>
      <div className="mt-0.5 font-semibold text-ink-800">{value}</div>
    </div>
  );
}
