import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, rpc } from '../../lib/supabase';
import { useLookup, useSettings, type Row } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { computeTotals, isoDate, money, qtyFmt } from '../../lib/format';
import { ErrorBox, Field, Loading, PageHeader, useToast } from '../../components/ui';
import { PartyPicker, ProductPicker } from '../../components/Pickers';
import { kindDef, type DocKind } from './config';

export const RETURN_REASONS = [['EXPIRED', 'Expired'], ['DAMAGED', 'Damaged'], ['WRONG_ITEM', 'Wrong item / not ordered'], ['OTHER', 'Other']] as const;

interface Line {
  product_id: number;
  code: string;
  name: string;
  description: string;
  uom?: string;
  qty: number;
  price: number;
  discount: number;
  taxable: boolean;
}

export default function DocEditor({ kind }: { kind: DocKind }) {
  const def = kindDef(kind);
  const { type: typeParam, id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { locationId } = useAuth();
  const { data: settings } = useSettings();
  const { data: locations } = useLookup('locations');

  const [loading, setLoading] = useState(!!id || !!sp.get('from'));
  const [type, setType] = useState((typeParam ?? '').toUpperCase());
  const [party, setParty] = useState<Row | null>(null);
  const [loc, setLoc] = useState<number | null>(locationId);
  const [date, setDate] = useState(isoDate());
  const [dueDate, setDueDate] = useState('');
  const [refNo, setRefNo] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [sourceNo, setSourceNo] = useState('');
  const [sourceOptions, setSourceOptions] = useState<Row[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = def.types[type];

  // Load existing doc (edit) or source doc (convert: ?from=ID)
  useEffect(() => {
    const loadId = id ?? sp.get('from');
    if (!loadId) return;
    (async () => {
      const { data: raw, error: e } = await supabase
        .from(def.table)
        .select(`*, party:${def.partyTable}(*), lines:${def.linesTable}(*, product:products(code, name, taxable, uom:uoms(code)))`)
        .eq('id', Number(loadId))
        .single();
      const d = raw as Row | null;
      if (e || !d) { setError(e?.message ?? 'Not found'); setLoading(false); return; }
      if (id) {
        setType(d.type);
        setDate(isoDate(new Date(d.doc_date)));
        setRefNo(d.ref_no ?? '');
        setNotes(d.notes ?? '');
      } else {
        setSourceId(d.id);
        setSourceNo(d.doc_no);
        setRefNo(d.ref_no ?? '');
      }
      setParty(d.party);
      setLoc(d.location_id);
      setDiscount(Number(d.discount));
      setLines(
        (d.lines as Row[])
          .sort((a, b) => a.line_no - b.line_no)
          .map((l) => ({
            product_id: l.product_id,
            code: l.product.code,
            name: l.product.name,
            description: l.description,
            uom: l.product.uom?.code,
            qty: Number(l.qty),
            price: Number(l.price),
            discount: Number(l.discount),
            taxable: l.product.taxable,
          })),
      );
      setLoading(false);
    })();
  }, [id, sp, def]);

  // Returns: let the user pick the original invoice / GRN of the selected party.
  useEffect(() => {
    if (!t?.sourceType || !party || id || sp.get('from')) return;
    supabase
      .from(def.table)
      .select('id, doc_no, doc_date, total')
      .eq('type', t.sourceType)
      .eq(`${def.party}_id`, party.id)
      .neq('status', 'VOID')
      .order('id', { ascending: false })
      .limit(50)
      .then(({ data }) => setSourceOptions(data ?? []));
  }, [t, party, id, sp, def]);

  const taxCfg = useMemo(
    () => ({ taxRate: Number(settings?.tax_rate ?? 0), taxInclusive: kind === 'sales' || settings?.tax_inclusive ? !!settings?.tax_inclusive : false }),
    [settings, kind],
  );
  const totals = computeTotals(lines, discount, taxCfg);

  async function addProduct(p: Row) {
    const existing = lines.findIndex((l) => l.product_id === p.id);
    if (existing >= 0) {
      setLines(lines.map((l, i) => (i === existing ? { ...l, qty: l.qty + 1 } : l)));
      return;
    }
    let price = Number(kind === 'sales' ? p.sell_price : p.cost_price);
    try {
      if (kind === 'sales' && party) price = Number(await rpc('get_price', { p_product: p.id, p_customer: party.id }));
      if (kind === 'purchase' && party) {
        const { data } = await supabase.from('supplier_prices').select('price').eq('supplier_id', party.id).eq('product_id', p.id).maybeSingle();
        if (data) price = Number(data.price);
      }
    } catch { /* fall back to list price */ }
    setLines((ls) => [
      ...ls,
      { product_id: p.id, code: p.code, name: p.name, description: p.name, uom: p.uom?.code, qty: 1, price, discount: 0, taxable: p.taxable },
    ]);
  }

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    setError(null);
    if (!party) return setError(`Select a ${def.partyLabel.toLowerCase()}`);
    if (!lines.length) return setError('Add at least one product');
    if (lines.some((l) => !(l.qty > 0))) return setError('Every line needs a quantity above 0');
    setSaving(true);
    const p: Row = {
      type,
      [`${def.party}_id`]: party.id,
      location_id: loc,
      doc_date: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
      ref_no: refNo || null,
      notes: notes || null,
      discount,
      lines: lines.map((l) => ({ product_id: l.product_id, description: l.description, qty: l.qty, price: l.price, discount: l.discount })),
    };
    if (dueDate) p.due_date = dueDate;
    const salesReturn = kind === 'sales' && type === 'RETURN';
    if (sourceId && !salesReturn) p.source_id = sourceId;
    if (salesReturn) {
      if (!returnReason) { setSaving(false); return setError('Select the return reason'); }
      Object.assign(p, { invoice_id: sourceId, return_reason: returnReason, restock });
    }
    try {
      const doc = id
        ? await rpc<Row>(def.updateFn, { p_id: Number(id), p })
        : await rpc<Row>(salesReturn ? 'create_sales_return' : def.createFn, { p });
      qc.invalidateQueries();
      toast('ok', `${doc.doc_no} saved`);
      nav(`${def.base}/doc/${doc.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!t) return <ErrorBox error={`Unknown document type ${type}`} />;
  if (loading) return <Loading />;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={id ? `Edit ${t.label}` : `New ${t.label}`}
        subtitle={sourceNo ? `Created from ${sourceNo}` : undefined}
        back={`${def.base}/${type}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => nav(-1)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : `Save ${t.short}`}</button>
          </>
        }
      />
      <div className="space-y-4">
        <ErrorBox error={error} />
        <div className="card grid grid-cols-1 gap-4 p-5 md:grid-cols-4">
          <Field label={`${def.partyLabel} *`} className="md:col-span-2">
            <PartyPicker table={def.partyTable as 'customers' | 'suppliers'} value={party} onChange={setParty} disabled={!!sourceId || !!id} allowClear={!sourceId && !id} />
          </Field>
          <Field label="Date">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Location">
            <select className="input" value={loc ?? ''} onChange={(e) => setLoc(Number(e.target.value))} disabled={!!id}>
              {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          {t.hasBalance && (
            <Field label="Due date" hint="Empty = date + customer terms">
              <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
          <Field label={kind === 'purchase' ? "Supplier's invoice / DO no." : 'Reference / PO no.'}>
            <input className="input" value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </Field>
          {kind === 'sales' && type === 'RETURN' && (
            <>
              <Field label="Return reason *">
                <select className="input" value={returnReason} onChange={(e) => { setReturnReason(e.target.value); setRestock(!['EXPIRED', 'DAMAGED'].includes(e.target.value)); }}>
                  <option value="">Select…</option>
                  {RETURN_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
                Put goods back into stock {!restock && <span className="text-xs text-rose-600">(written off)</span>}
              </label>
            </>
          )}
          {t.sourceType && !id && !sp.get('from') && (
            <Field label={`Original ${def.types[t.sourceType].short} (optional — ${kind === 'sales' ? 'credited first, then oldest unpaid invoices' : 'reduces its balance'})`} className="md:col-span-2">
              <select className="input" value={sourceId ?? ''} onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : null)} disabled={!party}>
                <option value="">— none —</option>
                {sourceOptions.map((s) => <option key={s.id} value={s.id}>{s.doc_no} · {money(s.total)}</option>)}
              </select>
            </Field>
          )}
        </div>

        <div className="card overflow-visible">
          <div className="border-b border-ink-100 p-3">
            <ProductPicker onPick={addProduct} locationId={loc} autoFocus={!id} />
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Product</th>
                  <th className="w-28 num">Qty</th>
                  <th className="w-32 num">{kind === 'sales' ? 'Price' : 'Cost'}</th>
                  <th className="w-28 num">Discount</th>
                  <th className="w-32 num">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-ink-400">Scan or search products above to add lines</td></tr>
                )}
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="text-ink-400">{i + 1}</td>
                    <td>
                      <input className="w-full border-0 bg-transparent p-0 text-sm font-medium text-ink-900 outline-none" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                      <div className="text-xs text-ink-400">{l.code}{l.uom ? ` · ${l.uom}` : ''}{!l.taxable ? ' · non-taxable' : ''}</div>
                    </td>
                    <td><input type="number" step="any" min="0" className="input num py-1.5" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} /></td>
                    <td><input type="number" step="any" min="0" className="input num py-1.5" value={l.price} onChange={(e) => setLine(i, { price: Number(e.target.value) })} /></td>
                    <td><input type="number" step="any" min="0" className="input num py-1.5" value={l.discount} onChange={(e) => setLine(i, { discount: Number(e.target.value) })} /></td>
                    <td className="num font-medium">{money(totals.lineTotals[i])}</td>
                    <td><button className="btn-ghost p-1.5 text-ink-300 hover:text-rose-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-6 border-t border-ink-100 p-5 md:grid-cols-[1fr_320px]">
            <Field label="Notes / remarks">
              <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-500">Items</span><span className="tabular-nums">{lines.length} · qty {qtyFmt(lines.reduce((s, l) => s + (l.qty || 0), 0))}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Gross</span><span className="tabular-nums">{money(totals.gross)}</span></div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">Discount</span>
                <input type="number" step="any" min="0" className="input num w-32 py-1.5" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
              </div>
              {settings?.show_tax && (
                <>
                  <div className="flex justify-between"><span className="text-ink-500">Subtotal</span><span className="tabular-nums">{money(totals.subtotal)}</span></div>
                  <div className="flex justify-between">
                    <span className="text-ink-500">{settings?.tax_name ?? 'Tax'} {Number(settings?.tax_rate ?? 0)}%{taxCfg.taxInclusive ? ' (incl.)' : ''}</span>
                    <span className="tabular-nums">{money(totals.tax)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between border-t border-ink-100 pt-2 text-lg font-semibold text-ink-900">
                <span>Total</span><span className="tabular-nums">{settings?.currency} {money(totals.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
