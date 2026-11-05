/**
 * Shared 80mm / 58mm document layouts for the admin portal and the salesman app.
 * One layout -> Bluetooth ESC/POS bytes, printable HTML, or a PDF file (same look everywhere).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Paper = 58 | 80;

// ---------- formatting ----------
export const money = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-SG', { maximumFractionDigits: 3 });
const pad2 = (n: number) => String(n).padStart(2, '0');
/** 08/10/2026 */
export const printDate = (v: string | Date | null | undefined) => {
  if (!v) return '';
  const d = new Date(v);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
/** 08/10/2026 10:36:00 AM */
export const printDateTime = (v: string | Date | null | undefined) => {
  if (!v) return '';
  const d = new Date(v);
  const h = d.getHours() % 12 || 12;
  return `${printDate(d)} ${pad2(h)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

// ---------- layout model ----------
type Align = 'left' | 'center' | 'right';
export type PLine =
  | { k: 'text'; text: string; align?: Align; bold?: boolean; big?: boolean }
  | { k: 'lr'; left: string; right: string; bold?: boolean }
  | { k: 'cols'; cols: string[]; widths: number[]; aligns: Align[]; bold?: boolean }
  | { k: 'rule'; dashed?: boolean }
  | { k: 'gap'; n?: number };

function header(s: Row): PLine[] {
  const out: PLine[] = [{ k: 'text', text: String(s.company_name ?? ''), align: 'center', bold: true, big: true }];
  if (s.address) for (const part of String(s.address).split('\n')) out.push({ k: 'text', text: part, align: 'center' });
  if (s.phone) out.push({ k: 'text', text: `TEL : ${s.phone}`, align: 'center' });
  if (s.reg_no) out.push({ k: 'text', text: `UEN No / CO REG NO: ${s.reg_no}`, align: 'center' });
  if (s.show_tax && s.tax_reg_no) out.push({ k: 'text', text: `${s.tax_name} REG NO: ${s.tax_reg_no}`, align: 'center' });
  out.push({ k: 'gap' });
  return out;
}

function footer(goods: boolean): PLine[] {
  const out: PLine[] = [{ k: 'gap' }, { k: 'text', text: 'Customer Signature & Company Stamp' }, { k: 'gap', n: 4 }];
  if (goods) out.push({ k: 'rule', dashed: true }, { k: 'text', text: 'RECEIVED ABOVE GOODS IN GOOD ORDER AND CONDITION', align: 'center' }, { k: 'rule', dashed: true });
  return out;
}

const DOC_TITLE: Record<string, string> = { INVOICE: 'Invoice', ORDER: 'Sales Order', QUOTE: 'Quotation', RETURN: 'Sales Return', DELIVERY: 'Delivery Order' };

export interface InvoiceData {
  settings: Row | null;
  doc: Row; // sales_docs row
  customer: Row | null;
  lines: { description: string; qty: number; price: number; discount?: number; line_total: number; uom?: string }[];
  salesman?: string;
  username?: string;
  payments?: { name: string; amount: number }[];
  title?: string;
  /** Customer's total outstanding after this document (all invoices - returns - receipts). */
  outstanding?: number;
  note?: string;
}

/** Invoice / order / return — Amoka invoice layout. */
export function invoiceLayout(d: InvoiceData, paper: Paper = 80): PLine[] {
  const s = d.settings ?? {};
  const cur = s.currency ?? 'SGD';
  const c = d.customer ?? {};
  const L: PLine[] = [...header(s), { k: 'text', text: d.title ?? DOC_TITLE[d.doc.type] ?? d.doc.type, align: 'center', bold: true }];
  L.push({ k: 'lr', left: `No: ${d.doc.doc_no}`, right: `Date:${printDateTime(d.doc.doc_date)}` });
  if (d.salesman) L.push({ k: 'text', text: `Person Incharge: ${d.salesman}` });
  if (c.phone) L.push({ k: 'text', text: `Contact Nos: ${c.phone}` });
  if (d.doc.ref_no) L.push({ k: 'text', text: `Ref: ${d.doc.ref_no}` });
  L.push({ k: 'gap' }, { k: 'text', text: `CUST: ${c.name ?? 'CASH CUSTOMER'}`, bold: true });
  if (c.address) L.push({ k: 'text', text: `ADDR: ${String(c.address).replace(/\n/g, ' ')}` });
  if (d.username) L.push({ k: 'text', text: `User: ${d.username}` });
  if (d.doc.due_date && d.doc.type === 'INVOICE') L.push({ k: 'text', text: `Due Date: ${printDate(d.doc.due_date)}` });
  const narrow = paper === 58;
  const W = narrow ? [6, 6, 10, 10] : [16, 4, 6, 6];
  const A: Align[] = ['left', 'right', 'right', 'right'];
  L.push({ k: 'rule' });
  if (narrow) L.push({ k: 'text', text: 'SNO DESCRIPTION', bold: true }, { k: 'cols', cols: ['', 'QTY', 'PRICE', 'TOTAL'], widths: W, aligns: A, bold: true });
  else L.push({ k: 'cols', cols: ['SNO DESCRIPTION', 'QTY', 'PRICE', 'TOTAL'], widths: W, aligns: A, bold: true });
  L.push({ k: 'rule' });
  d.lines.forEach((l, i) => {
    L.push({ k: 'text', text: `${i + 1}  ${l.description}${l.uom ? `(${l.uom})` : ''}` });
    L.push({ k: 'cols', cols: ['', qty(l.qty), money(l.price), money(l.line_total)], widths: W, aligns: A });
    if (l.discount) L.push({ k: 'text', text: `less discount ${money(l.discount)}`, align: 'right' });
  });
  L.push({ k: 'rule' });
  const gross = d.lines.reduce((a, l) => a + Number(l.line_total), 0);
  L.push({ k: 'lr', left: '', right: `SUB TOTAL:${cur}  ${money(gross)}` });
  if (Number(d.doc.discount)) L.push({ k: 'lr', left: '', right: `DISCOUNT:${cur}  -${money(d.doc.discount)}` });
  if (s.show_tax) L.push({ k: 'lr', left: '', right: `${s.tax_name ?? 'GST'}(${Number(s.tax_rate ?? 0)}%):${cur}  ${money(d.doc.tax)}` });
  L.push({ k: 'lr', left: '', right: `${d.doc.type === 'RETURN' ? 'RETURN TOTAL' : 'GRAND TOTAL'}:${cur}  ${money(d.doc.total)}`, bold: true });
  for (const p of d.payments ?? []) L.push({ k: 'lr', left: '', right: `PAID (${p.name}):${cur}  ${money(p.amount)}` });
  if (d.note) L.push({ k: 'text', text: d.note });
  if (d.outstanding !== undefined) {
    L.push({ k: 'rule' }, { k: 'text', text: `TOTAL OUTSTANDING : ${cur} ${money(d.outstanding)}`, bold: true }, { k: 'rule' });
  }
  L.push(...footer(d.doc.type !== 'QUOTE'));
  return L;
}

export interface PaymentReceiptData {
  settings: Row | null;
  receipt: Row; // receipt_no, receipt_date, amount, cheque_no, reference
  customer: Row | null;
  payMode: string;
  rows: { no: string; date: string; amount: number; paid: number; balance: number; credit: number; isReturn: boolean }[];
  salesman?: string;
}

/** Payment receipt — Amoka receipt layout. */
export function paymentLayout(d: PaymentReceiptData, paper: Paper = 80): PLine[] {
  const s = d.settings ?? {};
  const cur = s.currency ?? 'SGD';
  const L: PLine[] = [...header(s), { k: 'text', text: 'Receipt', align: 'center', bold: true }];
  L.push({ k: 'lr', left: `Receipt No: ${d.receipt.receipt_no}`, right: printDate(d.receipt.receipt_date) });
  L.push({ k: 'text', text: `Customer: ${d.customer?.name ?? ''}` });
  L.push({ k: 'lr', left: `CODE: ${d.customer?.code ?? ''}`, right: `Pay Mode: ${d.payMode.toUpperCase()}` });
  if (d.receipt.cheque_no) L.push({ k: 'text', text: `Cheque No: ${d.receipt.cheque_no}` });
  if (d.receipt.reference) L.push({ k: 'text', text: `Ref: ${d.receipt.reference}` });
  if (d.salesman) L.push({ k: 'text', text: `Collected by: ${d.salesman}` });
  const narrow = paper === 58;
  const W = narrow ? [4, 14, 14] : [4, 12, 11, 9];
  const A: Align[] = narrow ? ['left', 'left', 'right'] : ['left', 'left', 'left', 'right'];
  const head = narrow ? ['SNo', 'Invoice No', 'Inv Date'] : ['SNo', 'Invoice No', 'Inv Date', 'Amount'];
  L.push({ k: 'rule' }, { k: 'cols', cols: head, widths: W, aligns: A, bold: true }, { k: 'rule' });
  d.rows.forEach((r, i) => {
    if (narrow) {
      L.push({ k: 'cols', cols: [String(i + 1), r.no, r.date], widths: W, aligns: A, bold: true });
      L.push({ k: 'lr', left: `Amount: ${money(r.amount)}`, right: `Paid Amt: ${money(r.paid)}` });
      L.push({ k: 'lr', left: `Credit Amt: ${money(r.credit)}`, right: `Balance Amt: ${money(r.balance)}` }, { k: 'gap' });
    } else {
      L.push({ k: 'cols', cols: [String(i + 1), r.no, r.date, money(r.amount)], widths: W, aligns: A });
      L.push({ k: 'lr', left: `Paid Amt: ${money(r.paid)}`, right: `Balance Amt: ${money(r.balance)}` });
      L.push({ k: 'text', text: `Credit Amt: ${money(r.credit)}` }, { k: 'gap' });
    }
  });
  L.push({ k: 'rule' });
  const ret = d.rows.filter((r) => r.isReturn).reduce((a, r) => a + r.paid, 0);
  const balance = d.rows.filter((r) => !r.isReturn).reduce((a, r) => a + r.balance, 0);
  if (ret) L.push({ k: 'lr', left: '', right: `SALES RETURN AMT : ${cur} ${money(ret)}`, bold: true });
  L.push({ k: 'lr', left: '', right: `NET PAID AMT : ${cur} ${money(d.receipt.amount)}`, bold: true });
  L.push({ k: 'lr', left: '', right: `NET BALANCE : ${cur} ${money(balance)}`, bold: true });
  L.push({ k: 'rule' }, ...footer(true));
  return L;
}

export interface StatementData {
  settings: Row | null;
  customer: Row;
  from: string;
  to: string;
  rows: { tx_date: string | null; doc_no: string; kind: string; debit: number | null; credit: number | null; balance: number }[];
}

export function statementLayout(d: StatementData): PLine[] {
  const s = d.settings ?? {};
  const cur = s.currency ?? 'SGD';
  const L: PLine[] = [...header(s), { k: 'text', text: 'Customer Statement', align: 'center', bold: true }];
  L.push({ k: 'text', text: `Customer: ${d.customer.name}`, bold: true });
  if (d.customer.code) L.push({ k: 'text', text: `CODE: ${d.customer.code}` });
  L.push({ k: 'text', text: `Period: ${printDate(d.from)} - ${printDate(d.to)}` }, { k: 'rule' });
  for (const r of d.rows) {
    if (r.kind === 'OPENING') { L.push({ k: 'lr', left: 'Opening balance', right: money(r.balance), bold: true }); continue; }
    L.push({ k: 'lr', left: `${printDate(r.tx_date)} ${r.doc_no}`, right: r.debit ? money(r.debit) : `-${money(r.credit)}` });
    L.push({ k: 'lr', left: `  ${r.kind.toLowerCase()}`, right: `bal ${money(r.balance)}` });
  }
  const closing = d.rows.length ? Number(d.rows[d.rows.length - 1].balance) : 0;
  L.push({ k: 'rule' }, { k: 'text', text: `BALANCE DUE : ${cur} ${money(closing)}`, bold: true }, { k: 'rule' });
  L.push({ k: 'gap' }, { k: 'text', text: 'Thank you for your business', align: 'center' });
  return L;
}

// ---------- column fitting (character based, for ESC/POS) ----------
function fitCols(cols: string[], widths: number[], aligns: Align[], total: number) {
  const base = widths.reduce((a, b) => a + b, 0);
  const chars = widths.map((w) => Math.max(1, Math.round((w * total) / base)));
  chars[0] += total - chars.reduce((a, b) => a + b, 0);
  return cols
    .map((c, i) => {
      const room = chars[i] - 1;
      const t = c.length > room ? c.slice(0, room) : c;
      return aligns[i] === 'right' ? t.padStart(chars[i]) : t.padEnd(chars[i]);
    })
    .join('');
}

// ---------- ESC/POS ----------
const ESC = 0x1b;
const GS = 0x1d;
const enc = (s: string) => [...s.normalize('NFKD').replace(/[^\x20-\x7e\n]/g, '')].map((c) => c.charCodeAt(0));

export function toEscPos(lines: PLine[], paper: Paper = 80): Uint8Array {
  const cols = paper === 80 ? 48 : 32;
  const out: number[] = [ESC, 0x40];
  const line = (s = '') => out.push(...enc(`${s}\n`));
  const align = (a: Align) => out.push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  const bold = (on: boolean) => out.push(ESC, 0x45, on ? 1 : 0);
  const size = (big: boolean) => out.push(GS, 0x21, big ? 0x11 : 0x00);
  const lr = (l: string, r: string) => {
    if (l.length + r.length + 1 > cols) { line(l); line(r.padStart(cols)); }
    else line(l + ' '.repeat(cols - l.length - r.length) + r);
  };
  for (const l of lines) {
    if (l.k === 'gap') { for (let i = 0; i < (l.n ?? 1); i++) line(); continue; }
    if (l.k === 'rule') { align('left'); line(l.dashed ? '- '.repeat(cols / 2) : '-'.repeat(cols)); continue; }
    if (l.k === 'text') {
      align(l.align ?? 'left'); bold(!!l.bold); size(!!l.big);
      const width = l.big ? Math.floor(cols / 2) : cols;
      let cur = '';
      for (const w of l.text.split(' ')) {
        if ((cur + ' ' + w).trim().length > width) { line(cur); cur = w; } else cur = (cur + ' ' + w).trim();
      }
      line(cur); size(false); bold(false);
      continue;
    }
    if (l.k === 'lr') { align('left'); bold(!!l.bold); lr(l.left, l.right); bold(false); continue; }
    align('left'); bold(!!l.bold); line(fitCols(l.cols, l.widths, l.aligns, cols)); bold(false);
  }
  out.push(ESC, 0x64, 4, GS, 0x56, 0x42, 0x00); // feed + cut
  return new Uint8Array(out);
}

// ---------- HTML (system print) ----------
const esc = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function toHtml(lines: PLine[], paper: Paper = 80, logo?: string) {
  const body = lines
    .map((l) => {
      if (l.k === 'gap') return `<div style="height:${10 * (l.n ?? 1)}px"></div>`;
      if (l.k === 'rule') return `<hr${l.dashed ? ' class=d' : ''}>`;
      if (l.k === 'text') return `<div style="text-align:${l.align ?? 'left'};${l.bold ? 'font-weight:bold;' : ''}${l.big ? 'font-size:15px;' : ''}">${esc(l.text)}</div>`;
      if (l.k === 'lr') return `<div class=lr${l.bold ? ' style="font-weight:bold"' : ''}><span>${esc(l.left)}</span><span>${esc(l.right)}</span></div>`;
      return `<table${l.bold ? ' style="font-weight:bold"' : ''}><tr>${l.cols.map((c, i) => `<td style="width:${(l.widths[i] / l.widths.reduce((a, b) => a + b, 0)) * 100}%;text-align:${l.aligns[i]}">${esc(c)}</td>`).join('')}</tr></table>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset=utf-8><title>print</title><style>
    @page{size:${paper}mm auto;margin:2mm} *{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000}
    body{width:${paper - 6}mm;margin:0} table{width:100%;border-collapse:collapse} td{padding:1px 0;vertical-align:top}
    hr{border:0;border-top:1px solid #000;margin:4px 0} hr.d{border-top-style:dashed}
    .lr{display:flex;justify-content:space-between;gap:6px}
  </style></head><body>${logo ? `<div style="text-align:center"><img src="${esc(logo)}" style="max-width:55%;max-height:60px" onerror="this.remove()"></div>` : ''}${body}</body></html>`;
}

/** Prints the HTML in a hidden frame (browser print dialog at 80mm / 58mm). */
export function printHtml(html: string) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  f.contentWindow!.document.write(html);
  f.contentWindow!.document.close();
  setTimeout(() => {
    f.contentWindow!.print();
    setTimeout(() => f.remove(), 1500);
  }, 400);
}

// ---------- PDF ----------
async function imageData(url?: string | null): Promise<{ data: string; w: number; h: number } | null> {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    const data: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = data;
    });
    return { data, w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

/** Creates a receipt-width PDF (80mm by default) that looks like the printout. */
export async function toPdf(lines: PLine[], paper: Paper = 80, logoUrl?: string | null): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const M = 4; // side margin mm
  const W = paper - M * 2;
  const LH = 4.1; // line height mm
  const logo = await imageData(logoUrl);
  const logoW = logo ? Math.min(42, W) : 0;
  const logoH = logo ? (logoW * logo.h) / logo.w : 0;

  // Measure height with a scratch document.
  const measure = new jsPDF({ unit: 'mm', format: [paper, 1000] });
  const wrap = (doc: InstanceType<typeof jsPDF>, text: string, size: number, width: number) => {
    doc.setFontSize(size);
    return doc.splitTextToSize(text, width) as string[];
  };
  let height = M + (logo ? logoH + 2 : 0);
  for (const l of lines) {
    if (l.k === 'gap') height += 2.2 * (l.n ?? 1);
    else if (l.k === 'rule') height += 2.4;
    else if (l.k === 'text') height += wrap(measure, l.text, l.big ? 11 : 8, W).length * (l.big ? 5 : LH);
    else if (l.k === 'lr') height += l.left && measure.getTextWidth(l.left) + measure.getTextWidth(l.right) + 2 > W ? LH * 2 : LH;
    else height += LH;
  }
  height += M;

  const doc = new jsPDF({ unit: 'mm', format: [paper, Math.max(height, 60)] });
  let y = M;
  if (logo) {
    doc.addImage(logo.data, 'PNG', (paper - logoW) / 2, y, logoW, logoH);
    y += logoH + 2;
  }
  for (const l of lines) {
    if (l.k === 'gap') { y += 2.2 * (l.n ?? 1); continue; }
    if (l.k === 'rule') {
      doc.setLineWidth(0.2);
      if (l.dashed) doc.setLineDashPattern([1, 1], 0); else doc.setLineDashPattern([], 0);
      doc.line(M, y + 0.6, paper - M, y + 0.6);
      doc.setLineDashPattern([], 0);
      y += 2.4;
      continue;
    }
    doc.setFont('helvetica', (l as { bold?: boolean }).bold ? 'bold' : 'normal');
    if (l.k === 'text') {
      const size = l.big ? 11 : 8;
      const parts = wrap(doc, l.text, size, W);
      for (const p of parts) {
        y += l.big ? 4.2 : 3.2;
        const x = l.align === 'center' ? paper / 2 : l.align === 'right' ? paper - M : M;
        doc.text(p, x, y, { align: l.align ?? 'left' });
        y += l.big ? 0.8 : LH - 3.2;
      }
      continue;
    }
    doc.setFontSize(8);
    if (l.k === 'lr') {
      if (l.left && doc.getTextWidth(l.left) + doc.getTextWidth(l.right) + 2 > W) {
        y += 3.2; doc.text(l.left, M, y); y += LH - 3.2;
        y += 3.2; doc.text(l.right, paper - M, y, { align: 'right' }); y += LH - 3.2;
      } else {
        y += 3.2;
        if (l.left) doc.text(l.left, M, y);
        doc.text(l.right, paper - M, y, { align: 'right' });
        y += LH - 3.2;
      }
      continue;
    }
    // columns
    const total = l.widths.reduce((a, b) => a + b, 0);
    let x = M;
    y += 3.2;
    l.cols.forEach((c, i) => {
      const cw = (l.widths[i] / total) * W;
      const text = doc.splitTextToSize(c, cw - 1)[0] ?? '';
      if (l.aligns[i] === 'right') doc.text(text, x + cw, y, { align: 'right' });
      else doc.text(text, x, y);
      x += cw;
    });
    y += LH - 3.2;
  }
  return doc.output('blob');
}

// ---------- download / share ----------
export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
}

/**
 * Shares the PDF through the phone's share sheet (choose WhatsApp → contact or group).
 * Needs HTTPS. Elsewhere: downloads the PDF and opens WhatsApp with the message so the PDF can be attached.
 * Returns 'shared' | 'fallback' | 'cancelled'.
 */
export async function shareToWhatsApp(blob: Blob, fileName: string, message: string, phone?: string | null) {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (window.isSecureContext && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName, text: message });
      return 'shared' as const;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled' as const;
    }
  }
  downloadBlob(blob, fileName);
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  const sgPhone = digits.length === 8 ? `65${digits}` : digits; // Singapore 8-digit numbers
  window.open(`https://wa.me/${sgPhone}?text=${encodeURIComponent(message)}`, '_blank');
  return 'fallback' as const;
}

// ---------- receipt loader (shared by both apps) ----------
/**
 * Builds the receipt printout data: each invoice paid in this receipt, plus sales returns credited
 * to those invoices (shown as minus rows), like the old system's receipt.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadPaymentReceipt(supabase: any, receiptId: number, settings: Row | null, salesman?: string): Promise<PaymentReceiptData> {
  const { data: r, error } = await supabase
    .from('receipts')
    .select('id, receipt_no, receipt_date, amount, cheque_no, reference, customer:customers(name, code, phone), paymode:paymodes(name), user:profiles(full_name), allocations:receipt_allocations(amount, doc:sales_docs(id, doc_no, doc_date, total, paid, credited))')
    .eq('id', receiptId)
    .single();
  if (error || !r) throw new Error(error?.message ?? 'Receipt not found');
  const rec = r as Row;
  const invIds = rec.allocations.map((a: Row) => a.doc.id);
  const { data: rets } = invIds.length
    ? await supabase.from('return_allocations').select('doc_id, amount, ret:sales_docs!return_id(doc_no, doc_date, status)').in('doc_id', invIds)
    : { data: [] as Row[] };
  const activeRets = ((rets ?? []) as Row[]).filter((x) => x.ret?.status !== 'VOID');
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const rows: PaymentReceiptData['rows'] = [];
  for (const a of rec.allocations as Row[]) {
    const retForInv = activeRets.filter((x) => x.doc_id === a.doc.id);
    const retSum = retForInv.reduce((s, x) => s + Number(x.amount), 0);
    rows.push({
      no: a.doc.doc_no,
      date: printDate(a.doc.doc_date),
      amount: Number(a.doc.total),
      paid: round2(Number(a.amount) + retSum),
      balance: round2(Number(a.doc.total) - Number(a.doc.paid) - Number(a.doc.credited)),
      credit: 0,
      isReturn: false,
    });
    for (const x of retForInv) {
      rows.push({ no: x.ret.doc_no, date: printDate(x.ret.doc_date), amount: -Number(x.amount), paid: -Number(x.amount), balance: 0, credit: 0, isReturn: true });
    }
  }
  return { settings, receipt: rec, customer: rec.customer, payMode: rec.paymode?.name ?? '', rows, salesman: salesman ?? rec.user?.full_name };
}

/** Builds invoice print data from a sales_docs row loaded with customer, user, lines(product.uom), allocations(receipt). */
export function invoiceDataFromDoc(d: Row, settings: Row | null, outstanding?: number | null): InvoiceData {
  return {
    settings,
    doc: d,
    customer: d.customer ?? null,
    salesman: d.user?.full_name,
    username: d.user?.username,
    lines: [...(d.lines ?? [])]
      .sort((a: Row, b: Row) => a.line_no - b.line_no)
      .map((l: Row) => ({ description: l.description, qty: Number(l.qty), price: Number(l.price), discount: Number(l.discount), line_total: Number(l.line_total), uom: l.product?.uom?.code })),
    payments: (d.allocations ?? [])
      .filter((a: Row) => a.receipt?.status === 'ACTIVE')
      .map((a: Row) => ({ name: a.receipt.paymode?.name ?? '', amount: Number(a.amount) })),
    outstanding: outstanding === undefined || outstanding === null ? undefined : Number(outstanding),
    note: d.type === 'RETURN' ? `Reason: ${String(d.return_reason ?? '-').replace('_', ' ')}${d.restock ? '' : ' (written off)'}` : undefined,
  };
}

/** WhatsApp message to go with an invoice / receipt PDF. */
export function shareMessage(kind: 'invoice' | 'receipt' | 'statement', s: Row | null, no: string, amount: number, extra?: string) {
  const cur = s?.currency ?? 'SGD';
  const label = kind === 'invoice' ? 'Invoice' : kind === 'receipt' ? 'Receipt' : 'Statement';
  return `${s?.company_name ?? 'Amoka'}\n${label} ${no}\nAmount: ${cur} ${money(amount)}${extra ? `\n${extra}` : ''}\n\nPlease find the attached PDF. Thank you!`;
}
