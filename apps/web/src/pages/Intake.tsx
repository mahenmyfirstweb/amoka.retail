/**
 * Export stock intake.
 *  Exporter team: create intake (products + qty) -> Submit.
 *  Admin: on container arrival enter container no / arrival date / lot no, adjust received qty,
 *         deduct customs samples etc. -> one click "Approve & add to stock".
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Printer, Send, Trash2, XCircle } from 'lucide-react';
import { supabase, rpc } from '../lib/supabase';
import { useLookup, useSettings, type Row } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateFmt, dateTimeFmt, isoDate, qtyFmt } from '../lib/format';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useToast } from '../components/ui';
import { ProductPicker } from '../components/Pickers';
import { CompanyHeader } from './docs/DocView';
import { QtyCells, QtyHead, QtyInputs, joinQty, perCarton, splitQty } from '../components/CartonQty';

const STATUS_COLOR: Record<string, 'gray' | 'gold' | 'green' | 'red'> = { DRAFT: 'gray', SUBMITTED: 'gold', APPROVED: 'green', REJECTED: 'red' };
const REASONS = ['Customs sample', 'Damaged', 'Short shipped', 'Expired', 'Other'];

export function IntakeList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['intakes', status],
    queryFn: async () => {
      let q = supabase.from('stock_intakes').select('*, lines:stock_intake_lines(qty, added_qty)').order('id', { ascending: false }).limit(300);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data as Row[];
    },
  });
  return (
    <div>
      <PageHeader
        title="Stock Intake (Export)"
        subtitle="Exporter submits ready stock → admin approves on container arrival → stock goes into inventory"
        actions={can('stock_intake') && <button className="btn-primary" onClick={() => nav('/intake/new')}><Plus size={16} /> New intake</button>}
      />
      <div className="card overflow-hidden">
        <div className="flex gap-2 border-b border-ink-100 p-3">
          {[['', 'All'], ['DRAFT', 'Draft'], ['SUBMITTED', 'Waiting approval'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([k, l]) => (
            <button key={k} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${status === k ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600'}`} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        {isLoading ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data.length ? <Empty>No stock intakes yet</Empty> : (
          <table className="table">
            <thead><tr><th>No.</th><th>Ready date</th><th>Shipment ref</th><th>Container</th><th>Arrival</th><th>Lot</th><th className="num">Products</th><th className="num">Qty shipped</th><th className="num">Added to stock</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id}>
                  <td><Link className="font-medium hover:text-gold-600" to={`/intake/${i.id}`}>{i.intake_no}</Link></td>
                  <td>{dateFmt(i.ready_date)}</td>
                  <td>{i.shipment_ref}</td>
                  <td>{i.container_no}</td>
                  <td>{dateFmt(i.arrival_date)}</td>
                  <td>{i.lot_no}</td>
                  <td className="num">{i.lines.length}</td>
                  <td className="num">{qtyFmt(i.lines.reduce((s: number, l: Row) => s + Number(l.qty), 0))}</td>
                  <td className="num">{i.status === 'APPROVED' ? qtyFmt(i.lines.reduce((s: number, l: Row) => s + Number(l.added_qty ?? 0), 0)) : ''}</td>
                  <td><Badge color={STATUS_COLOR[i.status]}>{i.status === 'SUBMITTED' ? 'Waiting approval' : i.status.charAt(0) + i.status.slice(1).toLowerCase()}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface Line { product_id: number; code: string; name: string; uom?: string; pcs: number; c: number; l: number; remarks?: string }

const ProductCell = ({ name, code, pcs, uom, extra }: { name: string; code: string; pcs: number; uom?: string; extra?: string }) => (
  <td>
    <div className="font-medium text-ink-900">{name}</div>
    <div className="text-xs text-gold-700">Product Code: {code} · PcsPerCarton: {pcs}{uom ? ` · ${uom}` : ''}{extra ? ` · ${extra}` : ''}</div>
  </td>
);

/** Exporter: create / edit a draft intake (cartons + loose pieces). */
export function IntakeEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [readyDate, setReadyDate] = useState(isoDate());
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase.from('stock_intakes').select('*, lines:stock_intake_lines(*, product:products(code, name, pcs_per_carton, uom:uoms(code)))').eq('id', Number(id)).single().then(({ data }) => {
      if (!data) return;
      setReadyDate(data.ready_date); setRef(data.shipment_ref ?? ''); setNotes(data.notes ?? '');
      setLines((data.lines as Row[]).sort((a, b) => a.line_no - b.line_no).map((l) => {
        const pcs = perCarton(l.product);
        const s = splitQty(Number(l.qty), pcs);
        return { product_id: l.product_id, code: l.product.code, name: l.product.name, uom: l.product.uom?.code, pcs, c: s.c, l: s.l, remarks: l.remarks ?? '' };
      }));
    });
  }, [id]);

  function add(p: Row) {
    setLines((ls) => (ls.some((l) => l.product_id === p.id) ? ls : [...ls, { product_id: p.id, code: p.code, name: p.name, uom: p.uom?.code, pcs: perCarton(p), c: 0, l: 0 }]));
  }

  async function save(submit: boolean) {
    setError(null);
    if (!lines.length) return setError('Add at least one product');
    if (lines.some((l) => !(joinQty(l.c, l.l, l.pcs) > 0))) return setError('Enter cartons or loose quantity for every product (or remove it)');
    setBusy(true);
    try {
      const doc = await rpc<Row>('save_stock_intake', {
        p: { id: id ? Number(id) : null, ready_date: readyDate, shipment_ref: ref || null, notes: notes || null,
             lines: lines.map((l) => ({ product_id: l.product_id, qty: joinQty(l.c, l.l, l.pcs), remarks: l.remarks || null })) },
      });
      if (submit) await rpc('submit_stock_intake', { p_id: doc.id });
      qc.invalidateQueries();
      toast('ok', `${doc.intake_no} ${submit ? 'submitted for approval' : 'saved as draft'}`);
      nav(`/intake/${doc.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tot = lines.reduce((s, l) => ({ c: s.c + (l.c || 0), q: s.q + joinQty(l.c, l.l, l.pcs) }), { c: 0, q: 0 });
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={id ? 'Edit Stock Intake' : 'Add Stock Intake'} subtitle="Products ready for shipping to Singapore" back="/intake"
        actions={<><button className="btn-secondary" disabled={busy} onClick={() => save(false)}>Save draft</button><button className="btn-gold" disabled={busy} onClick={() => save(true)}><Send size={15} /> Save & submit</button></>} />
      <div className="space-y-4">
        <ErrorBox error={error} />
        <div className="card p-5">
          <div className="mb-3 inline-block rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white">Stock Intake</div>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Intake No"><input className="input" disabled value={id ? '' : 'Auto'} /></Field>
            <Field label="Goods ready date"><input type="date" className="input" value={readyDate} onChange={(e) => setReadyDate(e.target.value)} /></Field>
            <Field label="Shipment / invoice reference"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. EXP-2026-077" /></Field>
            <Field label="Remarks"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </div>
        <div className="card overflow-visible p-5">
          <div className="mb-3 inline-block rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white">Products Info</div>
          <div className="mb-3"><ProductPicker onPick={add} placeholder="+ Search product to add…" autoFocus={!id} /></div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th className="w-10 align-bottom">SNo</th><th className="align-bottom">Product Name</th><QtyHead title="Quantity Shipped" /><th className="align-bottom">Remarks</th><th className="w-10 align-bottom">Action</th></tr>
              </thead>
              <tbody>
                {!lines.length && <tr><td colSpan={7} className="py-10 text-center text-ink-400">Search and add the products that are ready</td></tr>}
                {lines.map((l, i) => (
                  <tr key={l.product_id}>
                    <td className="text-ink-400">{i + 1}</td>
                    <ProductCell name={l.name} code={l.code} pcs={l.pcs} uom={l.uom} />
                    <QtyInputs c={l.c} l={l.l} pcs={l.pcs} onChange={(c, lq) => set(i, { c, l: lq })} />
                    <td><input className="input py-1.5" value={l.remarks ?? ''} placeholder="batch, expiry…" onChange={(e) => set(i, { remarks: e.target.value })} /></td>
                    <td><button className="btn-ghost p-1.5 text-ink-300 hover:text-rose-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
              {lines.length > 0 && <tfoot><tr className="font-semibold"><td /><td className="px-3 py-2.5">{lines.length} products</td><td className="num px-3">{qtyFmt(tot.c)}</td><td /><td className="num px-3">{qtyFmt(tot.q)}</td><td colSpan={2} /></tr></tfoot>}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ALine {
  id?: number; product_id: number; code: string; name: string; uom?: string; pcs: number;
  qty: number; rc: number; rl: number; dc: number; dl: number; reason: string; remarks?: string; extra?: boolean; added?: number | null;
}

/** View an intake; admin approval form when SUBMITTED. */
export function IntakeView() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, locationId } = useAuth();
  const { data: settings } = useSettings();
  const { data: locations } = useLookup('locations');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [h, setH] = useState({ location_id: 0, container_no: '', arrival_date: isoDate(), lot_no: '', review_note: '' });
  const [lines, setLines] = useState<ALine[]>([]);

  const { data: doc, isLoading, refetch } = useQuery({
    queryKey: ['intake', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_intakes')
        .select('*, location:locations(name), creator:profiles!stock_intakes_created_by_fkey(full_name), approver:profiles!stock_intakes_approved_by_fkey(full_name), lines:stock_intake_lines(*, product:products(code, name, pcs_per_carton, uom:uoms(code)))')
        .eq('id', Number(id)).single();
      if (error) throw new Error(error.message);
      return data as Row;
    },
  });

  useEffect(() => {
    if (!doc) return;
    setH((x) => ({ ...x, location_id: doc.location_id ?? locationId ?? locations?.[0]?.id ?? 0, container_no: doc.container_no ?? '', lot_no: doc.lot_no ?? '', arrival_date: doc.arrival_date ?? isoDate() }));
    setLines((doc.lines as Row[]).sort((a, b) => a.line_no - b.line_no || a.id - b.id).map((l) => {
      const pcs = perCarton(l.product);
      const r = splitQty(Number(l.received_qty ?? l.qty), pcs);
      const dd = splitQty(Number(l.deduct_qty ?? 0), pcs);
      return {
        id: l.id, product_id: l.product_id, code: l.product.code, name: l.product.name, uom: l.product.uom?.code, pcs,
        qty: Number(l.qty), rc: r.c, rl: r.l, dc: dd.c, dl: dd.l, reason: l.deduct_reason ?? '', remarks: l.remarks ?? '',
        extra: Number(l.qty) === 0 && l.remarks === 'Added at approval', added: l.added_qty,
      };
    }));
  }, [doc, locationId, locations]);

  if (isLoading || !doc) return <Loading />;
  const approving = doc.status === 'SUBMITTED' && can('stock_intake_approve');
  const setLine = (i: number, patch: Partial<ALine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const rec = (l: ALine) => (l.extra ? 0 : joinQty(l.rc, l.rl, l.pcs));
  const ded = (l: ALine) => joinQty(l.dc, l.dl, l.pcs);
  const totals = lines.reduce((t, l) => ({ shipped: t.shipped + l.qty, received: t.received + rec(l), deduct: t.deduct + ded(l), add: t.add + (rec(l) - ded(l)) }), { shipped: 0, received: 0, deduct: 0, add: 0 });

  async function approve() {
    setError(null);
    if (!h.container_no.trim()) return setError('Enter the container number');
    if (!h.arrival_date) return setError('Enter the arrival date');
    if (lines.some((l) => ded(l) > 0 && !l.reason)) return setError('Choose the reason for every deducted quantity');
    if (lines.some((l) => !l.extra && ded(l) > rec(l))) return setError('Deducted quantity cannot be more than received');
    if (!confirm(`Approve ${doc!.intake_no} and add ${qtyFmt(totals.add)} units to stock?`)) return;
    setBusy(true);
    try {
      await rpc('approve_stock_intake', {
        p_id: doc!.id,
        p: {
          location_id: h.location_id || null, container_no: h.container_no, arrival_date: h.arrival_date, lot_no: h.lot_no || null, review_note: h.review_note || null,
          lines: lines.map((l) => (l.extra && !l.id
            ? { product_id: l.product_id, deduct_qty: ded(l), deduct_reason: l.reason }
            : { id: l.id, received_qty: rec(l), deduct_qty: ded(l), deduct_reason: l.reason })),
        },
      });
      toast('ok', `${doc!.intake_no} approved — stock updated`);
      qc.invalidateQueries();
      refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    try {
      await rpc('reject_stock_intake', { p_id: doc!.id, p_reason: reason });
      toast('ok', 'Sent back to exporter');
      setRejectOpen(false);
      refetch();
    } catch (e) {
      toast('err', (e as Error).message);
    }
  }
  async function submit() {
    try { await rpc('submit_stock_intake', { p_id: doc!.id }); toast('ok', 'Submitted for approval'); refetch(); } catch (e) { toast('err', (e as Error).message); }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/intake" className="text-xs font-medium text-ink-400 hover:text-ink-700">← Stock intake</Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold text-ink-900">{doc.intake_no}</h1>
            <Badge color={STATUS_COLOR[doc.status]}>{doc.status === 'SUBMITTED' ? 'Waiting approval' : doc.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {['DRAFT', 'REJECTED'].includes(doc.status) && can('stock_intake') && (
            <>
              <button className="btn-secondary" onClick={() => nav(`/intake/${doc.id}/edit`)}>Edit</button>
              <button className="btn-gold" onClick={submit}><Send size={15} /> Submit</button>
            </>
          )}
          {approving && <button className="btn-ghost text-rose-600" onClick={() => setRejectOpen(true)}><XCircle size={15} /> Reject</button>}
          <button className="btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button>
        </div>
      </div>

      {doc.status === 'REJECTED' && doc.review_note && <div className="no-print mb-4"><ErrorBox error={`Sent back: ${doc.review_note}`} /></div>}
      <ErrorBox error={error} />

      <div className="card print-area mt-4 p-6">
        <CompanyHeader settings={settings} title="STOCK INTAKE" compact />
        <div className="mt-5 grid gap-4 text-sm md:grid-cols-4">
          <div><div className="text-xs text-ink-400">Ready date</div><div className="font-medium">{dateFmt(doc.ready_date)}</div></div>
          <div><div className="text-xs text-ink-400">Shipment ref</div><div className="font-medium">{doc.shipment_ref || '—'}</div></div>
          <div><div className="text-xs text-ink-400">Prepared by</div><div className="font-medium">{doc.creator?.full_name}</div></div>
          <div><div className="text-xs text-ink-400">Submitted</div><div className="font-medium">{dateTimeFmt(doc.submitted_at) || '—'}</div></div>
        </div>

        {approving ? (
          <div className="no-print mt-5 grid gap-4 rounded-2xl bg-gold-50 p-4 ring-1 ring-gold-200 md:grid-cols-4">
            <Field label="Container number *"><input className="input" value={h.container_no} onChange={(e) => setH({ ...h, container_no: e.target.value.toUpperCase() })} placeholder="e.g. MSKU1234567" /></Field>
            <Field label="Arrival date *"><input type="date" className="input" value={h.arrival_date} onChange={(e) => setH({ ...h, arrival_date: e.target.value })} /></Field>
            <Field label="Lot number"><input className="input" value={h.lot_no} onChange={(e) => setH({ ...h, lot_no: e.target.value.toUpperCase() })} placeholder="e.g. LOT-26-11" /></Field>
            <Field label="Receive into">
              <select className="input" value={h.location_id} onChange={(e) => setH({ ...h, location_id: Number(e.target.value) })}>
                {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
        ) : doc.status === 'APPROVED' && (
          <div className="mt-5 grid gap-4 rounded-2xl bg-emerald-50 p-4 text-sm ring-1 ring-emerald-200 md:grid-cols-5">
            <div><div className="text-xs text-emerald-700">Container</div><div className="font-semibold">{doc.container_no}</div></div>
            <div><div className="text-xs text-emerald-700">Arrival</div><div className="font-semibold">{dateFmt(doc.arrival_date)}</div></div>
            <div><div className="text-xs text-emerald-700">Lot</div><div className="font-semibold">{doc.lot_no || '—'}</div></div>
            <div><div className="text-xs text-emerald-700">Into</div><div className="font-semibold">{doc.location?.name}</div></div>
            <div><div className="text-xs text-emerald-700">Approved</div><div className="font-semibold">{doc.approver?.full_name} · {dateFmt(doc.approved_at)}</div></div>
          </div>
        )}

        <div className="mt-5 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="align-bottom">SNo</th><th className="align-bottom">Product Name</th>
                <QtyHead title="Shipped" />
                <QtyHead title="Received" />
                <QtyHead title="Deduct" className="text-rose-600" />
                <th className="align-bottom">Reason</th>
                <QtyHead title="Into Stock" />
                <th className="no-print w-8 align-bottom" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const into = l.added ?? rec(l) - ded(l);
                return (
                  <tr key={l.id ?? `x${l.product_id}-${i}`} className={l.extra ? 'bg-rose-50/50' : ''}>
                    <td className="text-ink-400">{i + 1}</td>
                    <ProductCell name={l.name} code={l.code} pcs={l.pcs} uom={l.uom} extra={l.extra ? 'deduction only (from existing stock)' : l.remarks} />
                    {l.extra ? <><td /><td /><td /></> : <QtyCells qty={l.qty} pcs={l.pcs} />}
                    {l.extra ? <><td /><td /><td /></> : approving ? <QtyInputs c={l.rc} l={l.rl} pcs={l.pcs} onChange={(c, lq) => setLine(i, { rc: c, rl: lq })} /> : <QtyCells qty={rec(l)} pcs={l.pcs} />}
                    {approving ? <QtyInputs c={l.dc} l={l.dl} pcs={l.pcs} onChange={(c, lq) => setLine(i, { dc: c, dl: lq })} /> : <QtyCells qty={ded(l)} pcs={l.pcs} className="text-rose-600" />}
                    <td>{approving ? (
                      <select className="input py-1" value={l.reason} onChange={(e) => setLine(i, { reason: e.target.value })} disabled={!ded(l)}>
                        <option value="">—</option>{REASONS.map((r) => <option key={r}>{r}</option>)}
                      </select>) : l.reason}</td>
                    <QtyCells qty={Number(into)} pcs={l.pcs} className={Number(into) < 0 ? 'text-rose-600' : ''} />
                    <td className="no-print">{approving && l.extra && !l.id && <button className="btn-ghost p-1 text-ink-300" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={2} className="px-3 py-2.5">Total</td>
                <td colSpan={3} className="num px-3">{qtyFmt(totals.shipped)}</td>
                <td colSpan={3} className="num px-3">{qtyFmt(totals.received)}</td>
                <td colSpan={3} className="num px-3 text-rose-600">{totals.deduct ? `−${qtyFmt(totals.deduct)}` : ''}</td>
                <td />
                <td colSpan={3} className="num px-3">{qtyFmt(totals.add)}</td>
                <td className="no-print" />
              </tr>
            </tfoot>
          </table>
        </div>

        {approving && (
          <div className="no-print mt-5 space-y-4">
            <div className="rounded-xl border border-dashed border-ink-200 p-3">
              <div className="mb-2 text-sm font-medium text-ink-700">Deduct another product (e.g. customs took a sample of a product not in this shipment)</div>
              <ProductPicker onPick={(p) => setLines((ls) => [...ls, { product_id: p.id, code: p.code, name: p.name, uom: p.uom?.code, pcs: perCarton(p), qty: 0, rc: 0, rl: 0, dc: 0, dl: 1, reason: 'Customs sample', extra: true }])} placeholder="Search product to deduct…" />
            </div>
            <Field label="Remarks (optional)"><input className="input" value={h.review_note} onChange={(e) => setH({ ...h, review_note: e.target.value })} /></Field>
            <button className="btn-gold w-full py-3.5 text-base" disabled={busy} onClick={approve}>
              <CheckCircle2 size={18} /> {busy ? 'Approving…' : `Approve & add ${qtyFmt(totals.add)} units to stock`}
            </button>
          </div>
        )}
        {doc.notes && <p className="mt-4 text-sm text-ink-600"><b>Notes:</b> {doc.notes}</p>}
      </div>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title={`Send ${doc.intake_no} back to exporter`} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setRejectOpen(false)}>Cancel</button><button className="btn-danger" onClick={reject}>Send back</button></>}>
        <Field label="Reason *"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Modal>
    </div>
  );
}
