export const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const qtyFmt = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const dateFmt = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const dateTimeFmt = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/** yyyy-mm-dd in local time, for <input type="date">. */
export const isoDate = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface TotalsLine {
  qty: number;
  price: number;
  discount?: number;
  taxable: boolean;
}

/** Mirror of the API's computeTotals, used for live preview only. The server result is authoritative. */
export function computeTotals(
  lines: TotalsLine[],
  docDiscount: number,
  tax: { taxRate: number; taxInclusive: boolean },
) {
  const lineTotals = lines.map((l) => round2(l.qty * l.price - (l.discount ?? 0)));
  const gross = round2(lineTotals.reduce((s, x) => s + x, 0));
  const discount = round2(Math.min(Math.max(docDiscount || 0, 0), Math.max(gross, 0)));
  const ratio = gross === 0 ? 1 : (gross - discount) / gross;
  let t = 0;
  lines.forEach((l, i) => {
    const r = l.taxable ? tax.taxRate : 0;
    const base = lineTotals[i] * ratio;
    t += tax.taxInclusive ? (base * r) / (100 + r) : (base * r) / 100;
  });
  const taxAmt = round2(t);
  const net = round2(gross - discount);
  return {
    lineTotals,
    gross,
    discount,
    tax: taxAmt,
    subtotal: tax.taxInclusive ? round2(net - taxAmt) : net,
    total: tax.taxInclusive ? net : round2(net + taxAmt),
  };
}
