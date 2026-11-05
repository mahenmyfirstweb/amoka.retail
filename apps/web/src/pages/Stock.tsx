import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { supabase, rpc } from '../lib/supabase';
import { useLookup, useSettings, useTable, type Row } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateFmt, isoDate, qtyFmt } from '../lib/format';
import { Badge, Empty, ErrorBox, Field, Loading, PageHeader, Pager, StatusBadge, useToast } from '../components/ui';
import { ProductPicker } from '../components/Pickers';
import { CompanyHeader } from './docs/DocView';

type StockKind = 'ADJUST' | 'STOCKTAKE' | 'TRANSFER' | 'REQUEST';
const CFG: Record<StockKind, { title: string; singular: string; table: string; linesTable: string; base: string; printTitle: string; area?: string }> = {
  ADJUST: { title: 'Stock Adjustments', singular: 'Adjustment', table: 'stock_adjustments', linesTable: 'stock_adjustment_lines', base: '/stock/ADJUST', printTitle: 'STOCK ADJUSTMENT', area: 'stock' },
  STOCKTAKE: { title: 'Stock Take', singular: 'Stock Take', table: 'stock_adjustments', linesTable: 'stock_adjustment_lines', base: '/stock/STOCKTAKE', printTitle: 'STOCK TAKE', area: 'stock' },
  TRANSFER: { title: 'Product Transfers', singular: 'Transfer', table: 'stock_transfers', linesTable: 'stock_transfer_lines', base: '/stock/transfers', printTitle: 'STOCK TRANSFER', area: 'stock' },
  REQUEST: { title: 'Stock Requests', singular: 'Request', table: 'stock_requests', linesTable: 'stock_request_lines', base: '/stock/requests', printTitle: 'STOCK REQUEST' },
};

const PAGE = 50;
const locSelect = 'from_location:locations!from_location_id(name), to_location:locations!to_location_id(name)';

export function StockList({ kind }: { kind: StockKind }) {
  const c = CFG[kind];
  const { can } = useAuth();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const isAdj = kind === 'ADJUST' || kind === 'STOCKTAKE';
  const list = useTable(c.table, {
    select: isAdj ? '*, location:locations(name)' : `*, ${locSelect}`,
    key: [kind, page],
    build: (q) => {
      if (isAdj) q = q.eq('type', kind);
      return q.order('id', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
    },
  });
  return (
    <div>
      <PageHeader
        title={c.title}
        actions={(!c.area || can(c.area)) && <button className="btn-primary" onClick={() => nav(`${c.base}/new`)}><Plus size={16} /> New {c.singular}</button>}
      />
      <div className="card overflow-hidden">
        {list.isLoading ? <Loading /> : list.error ? <div className="p-4"><ErrorBox error={list.error} /></div> : !list.data?.items.length ? <Empty /> : (
          <table className="table">
            <thead><tr><th>No.</th><th>Date</th>{isAdj ? <><th>Location</th><th>Reason</th></> : <><th>From</th><th>To</th></>}<th>Notes</th><th>Status</th></tr></thead>
            <tbody>
              {list.data.items.map((d) => (
                <tr key={d.id}>
                  <td><Link className="font-medium text-ink-900 hover:text-gold-600" to={`${c.base}/${d.id}`}>{d.doc_no}</Link></td>
                  <td>{dateFmt(d.doc_date)}</td>
                  {isAdj ? <><td>{d.location?.name}</td><td>{d.reason}</td></> : <><td>{d.from_location?.name}</td><td>{d.to_location?.name}</td></>}
                  <td className="max-w-xs truncate">{d.notes}</td>
                  <td><StatusBadge status={d.status} /></td>
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

interface Line { product_id: number; code: string; name: string; uom?: string; qty: number; system_qty?: number }

export function StockNew({ kind }: { kind: StockKind }) {
  const c = CFG[kind];
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { locationId } = useAuth();
  const { data: locations } = useLookup('locations');
  const isAdj = kind === 'ADJUST' || kind === 'STOCKTAKE';
  const [loc, setLoc] = useState<number | null>(locationId);
  const [fromLoc, setFromLoc] = useState<number | null>(null);
  const [toLoc, setToLoc] = useState<number | null>(kind === 'REQUEST' ? locationId : null);
  const [date, setDate] = useState(isoDate());
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [requestId, setRequestId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Transfer from a stock request: ?request=ID
  useEffect(() => {
    const rid = Number(sp.get('request'));
    if (kind !== 'TRANSFER' || !rid) return;
    supabase
      .from('stock_requests')
      .select('*, lines:stock_request_lines(qty, product:products(id, code, name, uom:uoms(code)))')
      .eq('id', rid)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setRequestId(rid);
        setFromLoc(data.from_location_id);
        setToLoc(data.to_location_id);
        setNotes(`For request ${data.doc_no}`);
        setLines(data.lines.map((l: Row) => ({ product_id: l.product.id, code: l.product.code, name: l.product.name, uom: l.product.uom?.code, qty: Number(l.qty) })));
      });
  }, [kind, sp]);

  const stockLoc = isAdj ? loc : fromLoc;
  async function add(p: Row) {
    if (lines.some((l) => l.product_id === p.id)) {
      setLines(lines.map((l) => (l.product_id === p.id && kind !== 'STOCKTAKE' ? { ...l, qty: l.qty + 1 } : l)));
      return;
    }
    let system_qty: number | undefined;
    if (stockLoc) {
      const { data } = await supabase.from('stocks').select('qty').eq('product_id', p.id).eq('location_id', stockLoc).maybeSingle();
      system_qty = Number(data?.qty ?? 0);
    }
    setLines((ls) => [...ls, { product_id: p.id, code: p.code, name: p.name, uom: p.uom?.code, qty: kind === 'STOCKTAKE' ? (system_qty ?? 0) : 1, system_qty }]);
  }

  async function save() {
    setError(null);
    if (!lines.length) return setError('Add at least one product');
    setSaving(true);
    const doc_date = new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString();
    try {
      let doc: Row;
      if (isAdj) {
        if (kind === 'ADJUST' && lines.some((l) => !l.qty)) throw new Error('Adjustment qty cannot be 0 (use + to add, - to reduce)');
        doc = await rpc<Row>('create_stock_adjustment', {
          p: {
            type: kind, location_id: loc, doc_date, reason: reason || null, notes: notes || null,
            lines: lines.map((l) => (kind === 'STOCKTAKE' ? { product_id: l.product_id, counted_qty: l.qty } : { product_id: l.product_id, qty: l.qty })),
          },
        });
      } else {
        if (!fromLoc || !toLoc || fromLoc === toLoc) throw new Error('Choose two different locations');
        doc = await rpc<Row>(kind === 'TRANSFER' ? 'create_stock_transfer' : 'create_stock_request', {
          p: { from_location_id: fromLoc, to_location_id: toLoc, doc_date, notes: notes || null, request_id: requestId, lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) },
        });
      }
      qc.invalidateQueries();
      toast('ok', `${doc.doc_no} saved`);
      nav(`${c.base}/${doc.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const locSel = (v: number | null, set: (n: number) => void) => (
    <select className="input" value={v ?? ''} onChange={(e) => set(Number(e.target.value))}>
      <option value="">Select…</option>
      {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`New ${c.singular}`}
        subtitle={kind === 'STOCKTAKE' ? 'Enter the physical count. The difference to system stock is posted automatically.' : kind === 'ADJUST' ? 'Use positive qty to add stock, negative to reduce (damaged, expired, etc.).' : undefined}
        back={c.base}
        actions={<><button className="btn-secondary" onClick={() => nav(-1)}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>Save</button></>}
      />
      <div className="space-y-4">
        <ErrorBox error={error} />
        <div className="card grid gap-4 p-5 md:grid-cols-4">
          {isAdj ? (
            <Field label="Location">{locSel(loc, (n) => { setLoc(n); setLines([]); })}</Field>
          ) : (
            <>
              <Field label={kind === 'REQUEST' ? 'Request stock from' : 'From location'}>{locSel(fromLoc, (n) => { setFromLoc(n); if (kind === 'TRANSFER') setLines([]); })}</Field>
              <Field label={kind === 'REQUEST' ? 'Deliver to' : 'To location'}>{locSel(toLoc, setToLoc)}</Field>
            </>
          )}
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {isAdj && <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'ADJUST' ? 'Damaged / expired / found…' : 'Monthly count'} /></Field>}
          <Field label="Notes" className={isAdj ? '' : 'md:col-span-1'}><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="card overflow-visible">
          <div className="border-b border-ink-100 p-3"><ProductPicker onPick={add} locationId={stockLoc} autoFocus /></div>
          <table className="table">
            <thead>
              <tr>
                <th>#</th><th>Product</th>
                {stockLoc && <th className="num">System qty</th>}
                <th className="w-40 num">{kind === 'STOCKTAKE' ? 'Counted qty' : kind === 'ADJUST' ? 'Adjust qty (+/-)' : 'Qty'}</th>
                {kind === 'STOCKTAKE' && <th className="num">Difference</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {!lines.length && <tr><td colSpan={6} className="py-10 text-center text-ink-400">Scan or search products to add</td></tr>}
              {lines.map((l, i) => (
                <tr key={l.product_id}>
                  <td className="text-ink-400">{i + 1}</td>
                  <td><div className="font-medium text-ink-900">{l.name}</div><div className="text-xs text-ink-400">{l.code} {l.uom}</div></td>
                  {stockLoc && <td className="num">{qtyFmt(l.system_qty)}</td>}
                  <td><input type="number" step="any" className="input num py-1.5" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} /></td>
                  {kind === 'STOCKTAKE' && <td className={`num font-medium ${l.qty - (l.system_qty ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{qtyFmt(l.qty - (l.system_qty ?? 0))}</td>}
                  <td><button className="btn-ghost p-1.5 text-ink-300 hover:text-rose-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function StockView({ kind }: { kind: StockKind }) {
  const c = CFG[kind];
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const isAdj = kind === 'ADJUST' || kind === 'STOCKTAKE';
  const { data: d, isLoading } = useQuery({
    queryKey: ['stockdoc', kind, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(c.table)
        .select(`*, ${isAdj ? 'location:locations(name)' : locSelect}, lines:${c.linesTable}(*, product:products(code, name, uom:uoms(code)))`)
        .eq('id', Number(id))
        .single();
      if (error) throw new Error(error.message);
      return data as Row;
    },
  });
  if (isLoading || !d) return <Loading />;

  async function setRequestStatus(status: string) {
    try {
      await rpc('set_stock_request_status', { p_id: d!.id, p_status: status });
      toast('ok', `Request ${status.toLowerCase()}`);
    } catch (e) {
      toast('err', (e as Error).message);
    }
    qc.invalidateQueries();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-5 flex items-center justify-between">
        <Link to={c.base} className="text-xs font-medium text-ink-400 hover:text-ink-700">← {c.title}</Link>
        <div className="flex gap-2">
          {kind === 'REQUEST' && d.status === 'OPEN' && can('stock') && (
            <>
              <button className="btn-gold" onClick={() => nav(`/stock/transfers/new?request=${d.id}`)}>Transfer stock</button>
              <button className="btn-ghost text-rose-600" onClick={() => setRequestStatus('REJECTED')}>Reject</button>
            </>
          )}
          <button className="btn-primary" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
      </div>
      <div className="card print-area p-8">
        <CompanyHeader settings={settings} title={c.printTitle} compact />
        <div className="mt-5 flex flex-wrap justify-between gap-4 text-sm">
          <div>
            <div><span className="text-ink-400">No. </span><b>{d.doc_no}</b> <StatusBadge status={d.status} /></div>
            <div><span className="text-ink-400">Date </span>{dateFmt(d.doc_date)}</div>
          </div>
          <div className="text-right">
            {isAdj ? <div><span className="text-ink-400">Location </span>{d.location?.name}</div> : (
              <><div><span className="text-ink-400">From </span>{d.from_location?.name}</div><div><span className="text-ink-400">To </span>{d.to_location?.name}</div></>
            )}
            {d.reason && <div><span className="text-ink-400">Reason </span>{d.reason}</div>}
          </div>
        </div>
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-y border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
              <th className="py-2 text-left">#</th><th className="py-2 text-left">Product</th>
              {isAdj && <th className="py-2 text-right">System</th>}
              {kind === 'STOCKTAKE' && <th className="py-2 text-right">Counted</th>}
              <th className="py-2 text-right">{isAdj ? 'Change' : 'Qty'}</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l: Row, i: number) => (
              <tr key={l.id} className="border-b border-ink-100">
                <td className="py-2 text-ink-400">{i + 1}</td>
                <td className="py-2">{l.product.code} · {l.product.name}</td>
                {isAdj && <td className="py-2 text-right tabular-nums">{qtyFmt(l.system_qty)}</td>}
                {kind === 'STOCKTAKE' && <td className="py-2 text-right tabular-nums">{qtyFmt(l.counted_qty)}</td>}
                <td className={`py-2 text-right font-medium tabular-nums ${isAdj && l.qty < 0 ? 'text-rose-600' : ''}`}>{qtyFmt(l.qty)} {l.product.uom?.code}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.notes && <p className="mt-4 text-sm text-ink-600">{d.notes}</p>}
        {kind === 'REQUEST' && d.transfer_id && <p className="no-print mt-4 text-sm"><Badge color="green">Transferred</Badge> <Link className="ml-2 underline" to={`/stock/transfers/${d.transfer_id}`}>View transfer</Link></p>}
        <div className="mt-16 grid grid-cols-2 gap-16 text-xs text-ink-500">
          <div className="border-t border-ink-300 pt-2">Prepared by</div>
          <div className="border-t border-ink-300 pt-2">{isAdj ? 'Approved by' : 'Received by'}</div>
        </div>
      </div>
    </div>
  );
}
