import type { Row } from './data';
import { dateTimeFmt, money, qtyFmt } from './format';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Builds an 80mm thermal receipt and opens the print dialog in a hidden iframe. */
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
  const s = opts.settings ?? {};
  const rows = opts.lines
    .map(
      (l) => `<tr><td colspan="3">${esc(l.description)}</td></tr>
      <tr><td>${qtyFmt(l.qty)} x ${money(l.price)}${Number(l.discount) ? ` -${money(l.discount)}` : ''}</td><td></td><td class="r">${money(l.line_total)}</td></tr>`,
    )
    .join('');
  const pays = opts.payments.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${money(p.amount)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.doc.doc_no)}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    * { font-family: 'Courier New', monospace; font-size: 12px; }
    body { width: 74mm; margin: 0; color: #000; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
    .big { font-size: 15px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  </style></head><body>
  <div class="c"><img src="${esc(s.logo_url || location.origin + '/logo.png')}" style="max-width:55%;max-height:70px" onerror="this.remove()"></div>
  <div class="c big">${esc(s.company_name)}</div>
  ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}
  ${s.phone ? `<div class="c">Tel: ${esc(s.phone)}</div>` : ''}
  ${s.show_tax && s.tax_reg_no ? `<div class="c">${esc(s.tax_name)} Reg: ${esc(s.tax_reg_no)}</div>` : ''}
  <hr>
  <div class="c b">${opts.reprint ? 'REPRINT - ' : ''}${s.show_tax ? 'TAX INVOICE' : 'INVOICE'}</div>
  <table><tr><td>${esc(opts.doc.doc_no)}</td><td class="r">${dateTimeFmt(opts.doc.doc_date)}</td></tr>
  ${opts.cashier ? `<tr><td colspan="2">Cashier: ${esc(opts.cashier)}</td></tr>` : ''}
  ${opts.customer ? `<tr><td colspan="2">Customer: ${esc(opts.customer)}</td></tr>` : ''}</table>
  <hr><table>${rows}</table><hr>
  <table>
    ${Number(opts.doc.discount) ? `<tr><td>Discount</td><td class="r">-${money(opts.doc.discount)}</td></tr>` : ''}
    ${s.show_tax ? `<tr><td>Subtotal</td><td class="r">${money(opts.doc.subtotal)}</td></tr>
    <tr><td>${esc(s.tax_name)} ${Number(s.tax_rate)}%${s.tax_inclusive ? ' (incl)' : ''}</td><td class="r">${money(opts.doc.tax)}</td></tr>` : ''}
    <tr class="big"><td>TOTAL</td><td class="r">${esc(s.currency)} ${money(opts.doc.total)}</td></tr>
  </table><hr>
  <table>${pays}${opts.change ? `<tr class="b"><td>CHANGE</td><td class="r">${money(opts.change)}</td></tr>` : ''}</table>
  <hr><div class="c">${esc(s.receipt_footer ?? 'Thank you!')}</div><br>
  </body></html>`;

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const w = frame.contentWindow!;
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
    setTimeout(() => frame.remove(), 1000);
  }, 250);
}
