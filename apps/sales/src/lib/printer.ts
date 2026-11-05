/**
 * Thermal receipt printing.
 *  - Bluetooth (BLE) ESC/POS printers through Web Bluetooth (Chrome on Android / desktop).
 *  - Fallback: normal print dialog (Android print service, AirPrint, RawBT, etc.).
 */
import type { Row } from './store';
import { money, qtyFmt } from './format';

// Common BLE "serial" services used by 58/80mm thermal printers.
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
];

let device: BluetoothDevice | null = null;
let characteristic: BluetoothRemoteGATTCharacteristic | null = null;

export const bluetoothSupported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;
export const printerName = () => device?.name ?? localStorage.getItem('amoka.sales.printerName');
export const paperWidth = (): 58 | 80 => (localStorage.getItem('amoka.sales.paper') === '80' ? 80 : 58);
export const setPaperWidth = (w: 58 | 80) => localStorage.setItem('amoka.sales.paper', String(w));

async function findWritable(server: BluetoothRemoteGATTServer) {
  for (const uuid of SERVICES) {
    try {
      const svc = await server.getPrimaryService(uuid);
      for (const ch of await svc.getCharacteristics()) {
        if (ch.properties.write || ch.properties.writeWithoutResponse) return ch;
      }
    } catch {
      /* service not on this printer */
    }
  }
  throw new Error('This printer does not expose a BLE print service. Use "System print" instead.');
}

export async function connectPrinter() {
  if (!bluetoothSupported()) throw new Error('Bluetooth printing needs Chrome on Android (or desktop Chrome).');
  device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  const server = await device.gatt!.connect();
  characteristic = await findWritable(server);
  localStorage.setItem('amoka.sales.printerName', device.name ?? 'Printer');
  return device.name ?? 'Printer';
}

async function ensureConnected() {
  if (characteristic && device?.gatt?.connected) return;
  if (device?.gatt) {
    const server = await device.gatt.connect();
    characteristic = await findWritable(server);
    return;
  }
  await connectPrinter();
}

// ---------- ESC/POS ----------
const ESC = 0x1b;
const GS = 0x1d;
const enc = (s: string) => new Uint8Array([...s.normalize('NFKD').replace(/[^\x20-\x7e\n]/g, '')].map((c) => c.charCodeAt(0)));

class Builder {
  private parts: number[] = [];
  constructor(public cols: number) {
    this.raw(ESC, 0x40); // init
  }
  raw(...b: number[]) { this.parts.push(...b); return this; }
  text(s: string) { this.parts.push(...enc(s)); return this; }
  line(s = '') { return this.text(`${s}\n`); }
  align(a: 'left' | 'center' | 'right') { return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(double: boolean) { return this.raw(GS, 0x21, double ? 0x11 : 0x00); }
  rule() { return this.line('-'.repeat(this.cols)); }
  lr(l: string, r: string) {
    const space = Math.max(1, this.cols - l.length - r.length);
    if (l.length + r.length + 1 > this.cols) return this.line(l).line(r.padStart(this.cols));
    return this.line(l + ' '.repeat(space) + r);
  }
  feedCut() { return this.raw(ESC, 0x64, 4).raw(GS, 0x56, 0x42, 0x00); }
  bytes() { return new Uint8Array(this.parts); }
}

// =====================================================================
// Document layouts (same layout for Bluetooth ESC/POS and system print)
// =====================================================================
type Align = 'left' | 'center' | 'right';
type PLine =
  | { k: 'text'; text: string; align?: Align; bold?: boolean; big?: boolean }
  | { k: 'lr'; left: string; right: string; bold?: boolean }
  | { k: 'cols'; cols: string[]; widths: number[]; aligns: Align[]; bold?: boolean }
  | { k: 'rule'; dashed?: boolean }
  | { k: 'gap'; n?: number };

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

export interface ReceiptData {
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

/** Invoice / order / return — "Invoice" sample layout. */
function invoiceLayout(d: ReceiptData): PLine[] {
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
  const narrow = paperWidth() === 58;
  // 58mm: description on its own line, numbers below. 80mm: one row like the sample.
  const W = narrow ? [6, 6, 10, 10] : [16, 4, 6, 6];
  const A: Align[] = ['left', 'right', 'right', 'right'];
  L.push({ k: 'rule' });
  if (narrow) L.push({ k: 'text', text: 'SNO DESCRIPTION', bold: true }, { k: 'cols', cols: ['', 'QTY', 'PRICE', 'TOTAL'], widths: W, aligns: A, bold: true });
  else L.push({ k: 'cols', cols: ['SNO DESCRIPTION', 'QTY', 'PRICE', 'TOTAL'], widths: W, aligns: A, bold: true });
  L.push({ k: 'rule' });
  d.lines.forEach((l, i) => {
    L.push({ k: 'text', text: `${i + 1}  ${l.description}${l.uom ? `(${l.uom})` : ''}` });
    L.push({ k: 'cols', cols: ['', qtyFmt(l.qty), money(l.price), money(l.line_total)], widths: W, aligns: A });
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

/** Payment receipt — "Receipt" sample layout. */
function paymentLayout(d: PaymentReceiptData): PLine[] {
  const s = d.settings ?? {};
  const cur = s.currency ?? 'SGD';
  const L: PLine[] = [...header(s), { k: 'text', text: 'Receipt', align: 'center', bold: true }];
  L.push({ k: 'lr', left: `Receipt No: ${d.receipt.receipt_no}`, right: printDate(d.receipt.receipt_date) });
  L.push({ k: 'text', text: `Customer: ${d.customer?.name ?? ''}` });
  L.push({ k: 'lr', left: `CODE: ${d.customer?.code ?? ''}`, right: `Pay Mode: ${d.payMode.toUpperCase()}` });
  if (d.receipt.cheque_no) L.push({ k: 'text', text: `Cheque No: ${d.receipt.cheque_no}` });
  if (d.receipt.reference) L.push({ k: 'text', text: `Ref: ${d.receipt.reference}` });
  if (d.salesman) L.push({ k: 'text', text: `Collected by: ${d.salesman}` });
  const narrow = paperWidth() === 58;
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

// ---------- renderers ----------
/** widths are character widths for 32-column (58mm) paper; scaled up for 80mm. */
function fitCols(cols: string[], widths: number[], aligns: Align[], total: number) {
  const base = widths.reduce((a, b) => a + b, 0);
  const chars = widths.map((w) => Math.max(1, Math.round((w * total) / base)));
  chars[0] += total - chars.reduce((a, b) => a + b, 0);
  return cols
    .map((c, i) => {
      const room = chars[i] - 1; // keep one space between columns
      const t = c.length > room ? c.slice(0, room) : c;
      return aligns[i] === 'right' ? t.padStart(chars[i]) : t.padEnd(chars[i]);
    })
    .join('');
}

function toEscPos(lines: PLine[]) {
  const cols = paperWidth() === 80 ? 48 : 32;
  const b = new Builder(cols);
  for (const l of lines) {
    if (l.k === 'gap') { for (let i = 0; i < (l.n ?? 1); i++) b.line(''); continue; }
    if (l.k === 'rule') { b.align('left').line(l.dashed ? '- '.repeat(cols / 2) : '-'.repeat(cols)); continue; }
    if (l.k === 'text') {
      b.align(l.align ?? 'left').bold(!!l.bold).size(!!l.big);
      const width = l.big ? Math.floor(cols / 2) : cols;
      let cur = '';
      for (const w of l.text.split(' ')) {
        if ((cur + ' ' + w).trim().length > width) { b.line(cur); cur = w; } else cur = (cur + ' ' + w).trim();
      }
      b.line(cur).size(false).bold(false);
      continue;
    }
    if (l.k === 'lr') { b.align('left').bold(!!l.bold).lr(l.left, l.right).bold(false); continue; }
    b.align('left').bold(!!l.bold).line(fitCols(l.cols, l.widths, l.aligns, cols)).bold(false);
  }
  return b.feedCut().bytes();
}

function toHtml(lines: PLine[], logo?: string) {
  const w = paperWidth();
  const esc = (x: unknown) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const body = lines
    .map((l) => {
      if (l.k === 'gap') return `<div style="height:${10 * (l.n ?? 1)}px"></div>`;
      if (l.k === 'rule') return `<hr${l.dashed ? ' class=d' : ''}>`;
      if (l.k === 'text') return `<div style="text-align:${l.align ?? 'left'};${l.bold ? 'font-weight:bold;' : ''}${l.big ? 'font-size:15px;' : ''}">${esc(l.text)}</div>`;
      if (l.k === 'lr') return `<div class=lr${l.bold ? ' style="font-weight:bold"' : ''}><span>${esc(l.left)}</span><span>${esc(l.right)}</span></div>`;
      return `<table${l.bold ? ' style="font-weight:bold"' : ''}><tr>${l.cols.map((c, i) => `<td style="width:${l.widths[i]}%;text-align:${l.aligns[i]}">${esc(c)}</td>`).join('')}</tr></table>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset=utf-8><style>
    @page{size:${w}mm auto;margin:2mm} *{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000}
    body{width:${w - 6}mm;margin:0} table{width:100%;border-collapse:collapse} td{padding:1px 0;vertical-align:top}
    hr{border:0;border-top:1px solid #000;margin:4px 0} hr.d{border-top-style:dashed}
    .lr{display:flex;justify-content:space-between;gap:6px}
  </style></head><body>${logo ? `<div style="text-align:center"><img src="${esc(logo)}" style="max-width:55%;max-height:60px" onerror="this.remove()"></div>` : ''}${body}</body></html>`;
}

function printHtml(html: string) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  f.contentWindow!.document.write(html);
  f.contentWindow!.document.close();
  setTimeout(() => {
    f.contentWindow!.print();
    setTimeout(() => f.remove(), 1500);
  }, 300);
}

async function output(lines: PLine[], settings: Row | null) {
  if (bluetoothSupported() && printerName()) return printBluetooth(toEscPos(lines));
  printHtml(toHtml(lines, settings?.logo_url || `${location.origin}/logo.png`));
}

export async function printBluetooth(data: Uint8Array) {
  await ensureConnected();
  const chunk = 180;
  for (let i = 0; i < data.length; i += chunk) {
    const part = data.slice(i, i + chunk);
    if (characteristic!.properties.writeWithoutResponse) await characteristic!.writeValueWithoutResponse(part);
    else await characteristic!.writeValue(part);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Invoice / order / return printout. */
export const printReceipt = (d: ReceiptData) => output(invoiceLayout(d), d.settings);
/** Customer payment receipt printout. */
export const printPaymentReceipt = (d: PaymentReceiptData) => output(paymentLayout(d), d.settings);

// ---------- Customer statement ----------
export interface StatementData {
  settings: Row | null;
  customer: Row;
  from: string;
  to: string;
  rows: { tx_date: string | null; doc_no: string; kind: string; debit: number | null; credit: number | null; balance: number }[];
}

export function buildStatement(d: StatementData) {
  const cols = paperWidth() === 80 ? 48 : 32;
  const s = d.settings ?? {};
  const b = new Builder(cols);
  b.align('center').bold(true).line(String(s.company_name ?? '')).bold(false);
  if (s.phone) b.line(`Tel: ${s.phone}`);
  b.rule().bold(true).line('CUSTOMER STATEMENT').bold(false).align('left');
  b.line(d.customer.name);
  b.line(`${new Date(d.from).toLocaleDateString()} - ${new Date(d.to).toLocaleDateString()}`);
  b.rule();
  for (const r of d.rows) {
    if (r.kind === 'OPENING') { b.lr('Opening balance', money(r.balance)); continue; }
    const amt = r.debit ? money(r.debit) : `-${money(r.credit ?? 0)}`;
    b.lr(`${r.tx_date ? new Date(r.tx_date).toLocaleDateString() : ''} ${r.doc_no}`, amt);
    b.lr(`  ${r.kind.toLowerCase()}`, `bal ${money(r.balance)}`);
  }
  b.rule();
  const closing = d.rows.length ? Number(d.rows[d.rows.length - 1].balance) : 0;
  b.bold(true).lr('BALANCE DUE', `${s.currency ?? ''} ${money(closing)}`).bold(false);
  b.align('center').line('').line('Thank you for your business');
  return b.feedCut().bytes();
}

export async function printStatement(d: StatementData) {
  if (bluetoothSupported() && printerName()) return printBluetooth(buildStatement(d));
  const s = d.settings ?? {};
  const w = paperWidth();
  const esc = (x: unknown) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const rows = d.rows.map((r) => `<tr><td>${r.tx_date ? new Date(r.tx_date).toLocaleDateString() : ''}</td><td>${r.kind === 'OPENING' ? 'Opening' : esc(r.doc_no)}</td><td class=r>${r.debit ? money(r.debit) : r.credit ? '-' + money(r.credit) : ''}</td><td class=r>${money(r.balance)}</td></tr>`).join('');
  const closing = d.rows.length ? Number(d.rows[d.rows.length - 1].balance) : 0;
  const html = `<!doctype html><html><head><meta charset=utf-8><style>@page{size:${w}mm auto;margin:2mm}*{font-family:monospace;font-size:11px}body{width:${w - 6}mm;margin:0}.c{text-align:center}.r{text-align:right}table{width:100%;border-collapse:collapse}hr{border:0;border-top:1px dashed #000}</style></head><body>
  <div class=c><b>${esc(s.company_name)}</b><br>CUSTOMER STATEMENT</div><hr>${esc(d.customer.name)}<br>${new Date(d.from).toLocaleDateString()} - ${new Date(d.to).toLocaleDateString()}<hr>
  <table>${rows}</table><hr><b>BALANCE DUE: ${esc(s.currency)} ${money(closing)}</b></body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentWindow!.document.write(html);
  f.contentWindow!.document.close();
  setTimeout(() => { f.contentWindow!.print(); setTimeout(() => f.remove(), 1500); }, 250);
}
