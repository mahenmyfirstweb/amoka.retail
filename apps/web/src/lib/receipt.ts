/** Web POS receipt: same 80mm invoice layout as the salesman app and admin portal. */
import { invoiceLayout, printHtml, toHtml, type Row } from '../../../../packages/shared/receipts';
import { money } from './format';

export function printReceipt(opts: {
  settings: Row | undefined;
  doc: Row;
  lines: Row[];
  payments: { name: string; amount: number }[];
  change?: number;
  cashier?: string;
  customer?: string | null;
  reprint?: boolean;
}) {
  const s = opts.settings ?? null;
  const lines = invoiceLayout(
    {
      settings: s,
      doc: opts.doc,
      customer: opts.customer ? { name: opts.customer } : null,
      salesman: opts.cashier,
      title: `${opts.reprint ? 'REPRINT - ' : ''}Invoice`,
      lines: opts.lines.map((l) => ({
        description: l.description,
        qty: Number(l.qty),
        price: Number(l.price),
        discount: Number(l.discount ?? 0),
        line_total: Number(l.line_total),
      })),
      payments: opts.payments,
      note: opts.change ? `CHANGE: ${s?.currency ?? 'SGD'} ${money(opts.change)}` : undefined,
    },
    80,
  );
  printHtml(toHtml(lines, 80, s?.logo_url || `${location.origin}/logo.png`));
}
