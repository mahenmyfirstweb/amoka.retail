/** Carton / loose quantity helpers: Qty = CQty × pcs per carton + LQty. */
import { qtyFmt } from '../lib/format';

export const perCarton = (p?: { pcs_per_carton?: number | string | null } | null) => Math.max(1, Number(p?.pcs_per_carton ?? 1) || 1);

/** Splits a total quantity into cartons + loose pieces. */
export function splitQty(qty: number, pcs: number) {
  const neg = qty < 0;
  const q = Math.abs(qty);
  if (pcs <= 1) return { c: 0, l: neg ? -q : q };
  const c = Math.floor(q / pcs + 1e-9);
  const l = Math.round((q - c * pcs) * 1000) / 1000;
  return { c: neg ? -c : c, l: neg ? -l : l };
}

export const joinQty = (c: number, l: number, pcs: number) => Math.round(((c || 0) * pcs + (l || 0)) * 1000) / 1000;

/** Read-only "CQty | LQty | Qty" cells. */
export function QtyCells({ qty, pcs, className = '' }: { qty: number; pcs: number; className?: string }) {
  const { c, l } = splitQty(qty, pcs);
  return (
    <>
      <td className={`num ${className}`}>{pcs > 1 ? qtyFmt(c) : ''}</td>
      <td className={`num ${className}`}>{qtyFmt(l)}</td>
      <td className={`num font-semibold ${className}`}>{qtyFmt(qty)}</td>
    </>
  );
}

/** Editable "CQty | LQty" inputs + computed Qty cell. */
export function QtyInputs({ c, l, pcs, onChange, disabled }: { c: number; l: number; pcs: number; onChange: (c: number, l: number) => void; disabled?: boolean }) {
  return (
    <>
      <td className="px-1"><input type="number" min="0" step="1" className="input num w-20 py-1.5" disabled={disabled} placeholder="0" value={c || ''} onChange={(e) => onChange(Number(e.target.value), l)} /></td>
      <td className="px-1"><input type="number" min="0" step="any" className="input num w-20 py-1.5" disabled={disabled} placeholder="0" value={l || ''} onChange={(e) => onChange(c, Number(e.target.value))} /></td>
      <td className="num font-semibold">{qtyFmt(joinQty(c, l, pcs))}</td>
    </>
  );
}

/** Two-row header group like "Stock In Hand / CQty | LQty | Qty". */
export function QtyHead({ title, className = '' }: { title: string; className?: string }) {
  return (
    <th colSpan={3} className={`text-center ${className}`}>
      <div>{title}</div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] font-medium normal-case tracking-normal opacity-80"><span>CQty</span><span>LQty</span><span>Qty</span></div>
    </th>
  );
}

/** Small editable "PcsPerCarton" box shown under the product name. */
export function PcsInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="mt-1 inline-flex items-center gap-1 text-xs text-gold-700">
      PcsPerCarton:
      <input
        type="number"
        min="1"
        step="1"
        className={`w-16 rounded-md border px-1.5 py-0.5 text-right text-xs ${value <= 1 ? 'border-amber-400 bg-amber-50' : 'border-ink-200 bg-white'}`}
        value={value || ''}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        title="Pieces in one carton"
      />
      {value <= 1 && <span className="text-amber-600">set carton size</span>}
    </label>
  );
}
