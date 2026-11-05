/**
 * Thermal receipt printing.
 *  - Bluetooth (BLE) ESC/POS printers through Web Bluetooth (Chrome on Android / desktop).
 *  - Fallback: normal print dialog (Android print service, AirPrint, RawBT, etc.).
 */
import type { Row } from './store';
import { dateTimeFmt, money, qtyFmt } from './format';

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

export interface ReceiptData {
  settings: Row | null;
  doc: Row; // sales_docs row
  customer: Row | null;
  lines: { description: string; qty: number; price: number; discount?: number; line_total: number; uom?: string }[];
  salesman?: string;
  payments?: { name: string; amount: number }[];
  title?: string;
  /** Customer's total outstanding after this document (all invoices - returns - receipts). */
  outstanding?: number;
  note?: string;
}

const TITLES: Record<string, string> = { ORDER: 'SALES ORDER', INVOICE: 'TAX INVOICE', QUOTE: 'QUOTATION', RETURN: 'CREDIT NOTE', DELIVERY: 'DELIVERY ORDER', RECEIPT: 'OFFICIAL RECEIPT' };
const docTitle =(type: string, s: Row) => (type === 'INVOICE' && !s.show_tax ? 'INVOICE' : TITLES[type] ?? type);

export function buildReceipt(d: ReceiptData) {
  const cols = paperWidth() === 80 ? 48 : 32;
  const s = d.settings ?? {};
  const b = new Builder(cols);
  b.align('center').bold(true).size(true).line(String(s.company_name ?? '').slice(0, cols / 2)).size(false).bold(false);
  if (s.address) b.line(String(s.address).replace(/\n/g, ' '));
  if (s.phone) b.line(`Tel: ${s.phone}`);
  if (s.show_tax && s.tax_reg_no) b.line(`${s.tax_name} Reg: ${s.tax_reg_no}`);
  b.rule().bold(true).line(d.title ?? docTitle(d.doc.type, s)).bold(false).align('left');
  b.lr(d.doc.doc_no, dateTimeFmt(d.doc.doc_date));
  if (d.customer) {
    b.line(`Customer: ${d.customer.name}`);
    if (d.customer.address) b.line(String(d.customer.address).replace(/\n/g, ' '));
  }
  if (d.salesman) b.line(`Salesman: ${d.salesman}`);
  if (d.doc.due_date) b.line(`Due: ${new Date(d.doc.due_date).toLocaleDateString()}`);
  b.rule();
  for (const l of d.lines) {
    b.line(l.description.slice(0, cols));
    b.lr(`  ${qtyFmt(l.qty)}${l.uom ? ' ' + l.uom : ''} x ${money(l.price)}${l.discount ? ` -${money(l.discount)}` : ''}`, money(l.line_total));
  }
  b.rule();
  if (Number(d.doc.discount)) b.lr('Discount', `-${money(d.doc.discount)}`);
  if (s.show_tax) {
    b.lr('Subtotal', money(d.doc.subtotal));
    b.lr(`${s.tax_name ?? 'Tax'} ${Number(s.tax_rate ?? 0)}%`, money(d.doc.tax));
  }
  b.bold(true).size(cols >= 48).lr('TOTAL', `${s.currency ?? ''} ${money(d.doc.total)}`).size(false).bold(false);
  for (const p of d.payments ?? []) b.lr(`Paid (${p.name})`, money(p.amount));
  const bal = Number(d.doc.total) - Number(d.doc.paid ?? 0) - Number(d.doc.credited ?? 0);
  if (d.doc.type === 'INVOICE' && bal > 0.004) b.lr('This invoice balance', money(bal));
  if (d.note) b.line(d.note);
  if (d.outstanding !== undefined) {
    b.rule().bold(true).lr('TOTAL OUTSTANDING', `${s.currency ?? ''} ${money(d.outstanding)}`).bold(false);
    b.line('(all invoices less returns & payments)');
  }
  b.rule().align('center');
  if (s.receipt_footer) b.line(String(s.receipt_footer));
  b.line('').line('Customer signature').line('').line('_'.repeat(Math.min(cols, 24)));
  return b.feedCut().bytes();
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

/** Fallback: opens the system print dialog with a thermal-width layout. */
export function printSystem(d: ReceiptData) {
  const w = paperWidth();
  const s = d.settings ?? {};
  const esc = (x: unknown) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const rows = d.lines.map((l) => `<tr><td colspan=2>${esc(l.description)}</td></tr><tr><td>&nbsp;${qtyFmt(l.qty)} x ${money(l.price)}</td><td class=r>${money(l.line_total)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset=utf-8><style>@page{size:${w}mm auto;margin:2mm}*{font-family:monospace;font-size:12px}body{width:${w - 6}mm;margin:0}.c{text-align:center}.r{text-align:right}table{width:100%;border-collapse:collapse}hr{border:0;border-top:1px dashed #000}</style></head><body>
  <div class=c><img src="${esc(s.logo_url || location.origin + '/logo.png')}" style="max-width:55%;max-height:70px" onerror="this.remove()"><br><b>${esc(s.company_name)}</b><br>${esc(s.address)}<br>${s.phone ? 'Tel: ' + esc(s.phone) : ''}</div><hr>
  <div class=c><b>${d.title ?? docTitle(d.doc.type, s)}</b></div>
  <div>${esc(d.doc.doc_no)} · ${dateTimeFmt(d.doc.doc_date)}<br>${d.customer ? 'Customer: ' + esc(d.customer.name) : ''}${d.salesman ? '<br>Salesman: ' + esc(d.salesman) : ''}</div><hr>
  <table>${rows}</table><hr><table>
  ${s.show_tax ? `<tr><td>Subtotal</td><td class=r>${money(d.doc.subtotal)}</td></tr><tr><td>${esc(s.tax_name)} ${Number(s.tax_rate ?? 0)}%</td><td class=r>${money(d.doc.tax)}</td></tr>` : ''}
  <tr><td><b>TOTAL</b></td><td class=r><b>${esc(s.currency)} ${money(d.doc.total)}</b></td></tr></table>
  ${d.note ? `<div>${esc(d.note)}</div>` : ''}
  ${d.outstanding !== undefined ? `<hr><table><tr><td><b>TOTAL OUTSTANDING</b></td><td class=r><b>${esc(s.currency)} ${money(d.outstanding)}</b></td></tr></table><div style="font-size:10px">(all invoices less returns &amp; payments)</div>` : ''}<hr>
  <div class=c>${esc(s.receipt_footer)}</div></body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  f.contentWindow!.document.write(html);
  f.contentWindow!.document.close();
  setTimeout(() => { f.contentWindow!.print(); setTimeout(() => f.remove(), 1500); }, 250);
}

export async function printReceipt(d: ReceiptData) {
  if (bluetoothSupported() && printerName()) {
    await printBluetooth(buildReceipt(d));
  } else {
    printSystem(d);
  }
}

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
