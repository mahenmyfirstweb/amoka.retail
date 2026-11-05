import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { like, useLookup, useSave, useTable, type Row } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateTimeFmt, money, qtyFmt } from '../lib/format';
import { Badge, Empty, ErrorBox, Loading, Modal, PageHeader, Pager, SearchInput, Tabs, useToast } from '../components/ui';
import { RecordForm } from './MasterPage';
import { ProductImages } from '../components/ProductImages';

const PAGE = 50;

const productFields = [
  { key: 'code', label: 'Product code', required: true, upper: true },
  { key: 'barcode', label: 'Barcode' },
  { key: 'name', label: 'Product name', required: true, span: 2 as const },
  { key: 'description', label: 'Description', type: 'textarea' as const },
  { key: 'category_id', label: 'Category', type: 'lookup' as const, table: 'categories' },
  { key: 'brand_id', label: 'Brand', type: 'lookup' as const, table: 'brands' },
  { key: 'uom_id', label: 'UOM', type: 'lookup' as const, table: 'uoms' },
  { key: 'pcs_per_carton', label: 'Pcs per carton', type: 'number' as const },
  { key: 'cost_price', label: 'Cost price', type: 'number' as const },
  { key: 'sell_price', label: 'Retail price', type: 'number' as const },
  { key: 'wholesale_price', label: 'Wholesale price', type: 'number' as const },
  { key: 'min_stock', label: 'Minimum stock (alert)', type: 'number' as const },
  { key: 'image_url', label: 'Main photo URL (or upload above)', span: 2 as const },
  { key: 'taxable', label: 'Taxable (GST)', type: 'bool' as const },
  { key: 'track_stock', label: 'Track stock', type: 'bool' as const },
  { key: 'is_active', label: 'Active', type: 'bool' as const },
];

function ProductDetail({ product }: { product: Row }) {
  const [tab, setTab] = useState('stock');
  const stock = useTable('stocks', {
    select: 'qty, location:locations(name)',
    key: [product.id],
    build: (q) => q.eq('product_id', product.id),
  });
  const moves = useTable('stock_movements', {
    select: '*, location:locations(name)',
    key: [product.id],
    enabled: tab === 'moves',
    build: (q) => q.eq('product_id', product.id).order('id', { ascending: false }).limit(100),
  });
  const prices = useTable('price_changes', {
    key: [product.id],
    enabled: tab === 'prices',
    build: (q) => q.eq('product_id', product.id).order('id', { ascending: false }).limit(50),
  });
  return (
    <div className="mt-6 border-t border-ink-100 pt-4">
      <Tabs
        tabs={[
          { key: 'stock', label: 'Stock' },
          { key: 'moves', label: 'Movements' },
          { key: 'prices', label: 'Price history' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'stock' && (
        <table className="table">
          <thead><tr><th>Location</th><th className="num">Qty</th></tr></thead>
          <tbody>
            {stock.data?.items.map((s, i) => (
              <tr key={i}><td>{s.location?.name}</td><td className="num">{qtyFmt(s.qty)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'moves' && (
        <table className="table">
          <thead><tr><th>Date</th><th>Location</th><th>Type</th><th>Ref</th><th className="num">Qty</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {moves.data?.items.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">{dateTimeFmt(m.created_at)}</td>
                <td>{m.location?.name}</td>
                <td><Badge>{m.type}</Badge></td>
                <td>{m.ref_no}</td>
                <td className={`num ${m.qty < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{qtyFmt(m.qty)}</td>
                <td className="num">{qtyFmt(m.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'prices' && (
        <table className="table">
          <thead><tr><th>Date</th><th className="num">Retail</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {prices.data?.items.map((p) => (
              <tr key={p.id}>
                <td>{dateTimeFmt(p.created_at)}</td>
                <td className="num">{money(p.old_sell_price)} → <b>{money(p.new_sell_price)}</b></td>
                <td className="num">{money(p.old_cost_price)} → <b>{money(p.new_cost_price)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Products() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Row | null>(null);
  const { data: categories } = useLookup('categories');
  const save = useSave('products');

  const list = useTable('products', {
    select: '*, category:categories(name), uom:uoms(code), stocks(qty)',
    key: [search, categoryId, page],
    build: (q) => {
      if (search) q = q.or(`code.ilike.${like(search)},name.ilike.${like(search)},barcode.eq.${search.replace(/[,()]/g, '')}`);
      if (categoryId) q = q.eq('category_id', Number(categoryId));
      return q.order('name').range((page - 1) * PAGE, page * PAGE - 1);
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const row: Row = {};
    for (const f of productFields) {
      let v = editing[f.key];
      if (typeof v === 'string') v = v.trim() || null;
      if (f.type === 'number' && (v === null || v === undefined)) v = f.key === 'pcs_per_carton' ? 1 : 0;
      if (f.type === 'bool') v = !!v;
      row[f.key] = v;
    }
    if (editing.id) row.id = editing.id;
    try {
      await save.mutateAsync(row);
      toast('ok', 'Product saved');
      setEditing(null);
    } catch (err) {
      toast('err', (err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${list.data?.count ?? 0} products`}
        actions={
          can('products') && (
            <button className="btn-primary" onClick={() => setEditing({ is_active: true, taxable: true, track_stock: true, pcs_per_carton: 1 })}>
              <Plus size={16} /> New Product
            </button>
          )
        }
      />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3">
          <div className="w-72"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Code, name or barcode…" /></div>
          <select className="input w-56" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {list.isLoading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} /></div> : !list.data?.items.length ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Code</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>UOM</th>
                  <th className="num">Cost</th>
                  <th className="num">Retail</th>
                  <th className="num">Wholesale</th>
                  <th className="num">Stock (all)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => {
                  const qty = (p.stocks ?? []).reduce((s: number, x: Row) => s + Number(x.qty), 0);
                  const low = p.track_stock && qty <= p.min_stock;
                  return (
                    <tr key={p.id} className="cursor-pointer" onClick={() => setEditing({ ...p })}>
                      <td className="w-12">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-50 text-xs font-semibold text-ink-300">{p.name.slice(0, 2)}</div>
                        )}
                      </td>
                      <td className="font-medium text-ink-900">{p.code}</td>
                      <td>
                        {p.name}
                        {!p.is_active && <span className="ml-2"><Badge>Inactive</Badge></span>}
                        {p.barcode && <div className="text-xs text-ink-400">{p.barcode}</div>}
                      </td>
                      <td>{p.category?.name}</td>
                      <td>{p.uom?.code}</td>
                      <td className="num">{money(p.cost_price)}</td>
                      <td className="num font-medium">{money(p.sell_price)}</td>
                      <td className="num">{money(p.wholesale_price)}</td>
                      <td className="num">{p.track_stock ? <span className={low ? 'font-semibold text-rose-600' : ''}>{qtyFmt(qty)}</span> : '—'}</td>
                      <td className="w-10 text-ink-300"><Pencil size={14} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE} count={list.data?.count ?? 0} onPage={setPage} />
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `${editing.code} · ${editing.name}` : 'New Product'}
        size="lg"
        footer={
          can('products') && (
            <>
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" form="product-form" disabled={save.isPending}>Save</button>
            </>
          )
        }
      >
        {editing && (
          <>
            <form id="product-form" onSubmit={submit}>
              <ProductImages product={editing} editable={can('products')} onMainChange={(url) => setEditing({ ...editing, image_url: url })} />
              <fieldset disabled={!can('products')}>
                <RecordForm fields={productFields} value={editing} onChange={setEditing} />
              </fieldset>
            </form>
            {editing.id && <ProductDetail product={editing} />}
          </>
        )}
      </Modal>
    </div>
  );
}

export function ProductStock() {
  const { data: locations } = useLookup('locations');
  const { data: categories } = useLookup('categories');
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const list = useTable('products', {
    select: 'id, code, name, cost_price, sell_price, min_stock, category:categories(name), uom:uoms(code), stocks(qty, location_id)',
    key: [search, categoryId],
    build: (q) => {
      q = q.eq('track_stock', true).eq('is_active', true);
      if (categoryId) q = q.eq('category_id', Number(categoryId));
      if (search) q = q.or(`code.ilike.${like(search)},name.ilike.${like(search)}`);
      return q.order('name').limit(2000);
    },
  });
  const rows = (list.data?.items ?? [])
    .map((p) => {
      const qty = (p.stocks ?? [])
        .filter((s: Row) => !locationId || s.location_id === Number(locationId))
        .reduce((a: number, s: Row) => a + Number(s.qty), 0);
      return { ...p, qty, value: qty * p.cost_price } as Row;
    })
    .filter((p) => !lowOnly || p.qty <= p.min_stock);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div>
      <PageHeader title="Product Stock Report" subtitle={`Stock value at cost: ${money(totalValue)}`} actions={<button className="btn-secondary" onClick={() => window.print()}>Print</button>} />
      <div className="card overflow-hidden">
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
          <div className="w-72"><SearchInput value={search} onChange={setSearch} /></div>
          <select className="input w-52" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input w-52" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
        </div>
        {list.isLoading ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Code</th><th>Name</th><th>UOM</th><th className="num">Min</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Value</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.code}</td>
                  <td>{r.name}</td>
                  <td>{r.uom?.code}</td>
                  <td className="num">{qtyFmt(r.min_stock)}</td>
                  <td className={`num font-medium ${r.qty <= r.min_stock ? 'text-rose-600' : ''}`}>{qtyFmt(r.qty)}</td>
                  <td className="num">{money(r.cost_price)}</td>
                  <td className="num">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function PriceChanges() {
  const list = useTable('price_changes', {
    select: '*, product:products(code, name)',
    build: (q) => q.order('id', { ascending: false }).limit(300),
  });
  return (
    <div>
      <PageHeader title="Price Change History" subtitle="Every change to retail or cost price is logged automatically. Edit prices from Products." />
      <div className="card overflow-hidden">
        {list.isLoading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} /></div> : !list.data?.items.length ? <Empty>No price changes yet</Empty> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Product</th><th className="num">Retail price</th><th className="num">Cost price</th></tr></thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{dateTimeFmt(p.created_at)}</td>
                  <td>{p.product?.code} · {p.product?.name}</td>
                  <td className="num">{money(p.old_sell_price)} → <b>{money(p.new_sell_price)}</b></td>
                  <td className="num">{money(p.old_cost_price)} → <b>{money(p.new_cost_price)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function StockMovements() {
  const { data: locations } = useLookup('locations');
  const [locationId, setLocationId] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const list = useTable('stock_movements', {
    select: '*, product:products(code, name), location:locations(name)',
    key: [locationId, type, page],
    build: (q) => {
      if (locationId) q = q.eq('location_id', Number(locationId));
      if (type) q = q.eq('type', type);
      return q.order('id', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
    },
  });
  return (
    <div>
      <PageHeader title="Stock Movements" subtitle="Every stock in / out, with running balance" />
      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3">
          <select className="input w-52" value={locationId} onChange={(e) => { setLocationId(e.target.value); setPage(1); }}>
            <option value="">All locations</option>
            {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select className="input w-52" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {['SALE', 'SALE_RETURN', 'GRN', 'PURCHASE_RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUST', 'STOCKTAKE', 'VOID'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        {list.isLoading ? <Loading /> : !list.data?.items.length ? <Empty /> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Product</th><th>Location</th><th>Type</th><th>Ref</th><th className="num">Qty</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {list.data.items.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{dateTimeFmt(m.created_at)}</td>
                  <td>{m.product?.code} · {m.product?.name}</td>
                  <td>{m.location?.name}</td>
                  <td><Badge>{m.type}</Badge></td>
                  <td>{m.ref_no}</td>
                  <td className={`num ${m.qty < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{qtyFmt(m.qty)}</td>
                  <td className="num">{qtyFmt(m.balance)}</td>
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
