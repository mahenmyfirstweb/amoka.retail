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
}

const TITLES: Record<string, string> = { ORDER: 'SALES ORDER', INVOICE: 'TAX INVOICE', QUOTE: 'QUOTATION', RETURN: 'CREDIT NOTE', DELIVERY: 'DELIVERY ORDER', RECEIPT: 'OFFICIAL RECEIPT' };

export function buildReceipt(d: ReceiptData) {
  const cols = paperWidth() === 80 ? 48 : 32;
  const s = d.settings ?? {};
  const b = new Builder(cols);
  b.align('center').bold(true).size(true).line(String(s.company_name ?? '').slice(0, cols / 2)).size(false).bold(false);
  if (s.address) b.line(String(s.address).replace(/\n/g, ' '));
  if (s.phone) b.line(`Tel: ${s.phone}`);
  if (s.tax_reg_no) b.line(`${s.tax_name} Reg: ${s.tax_reg_no}`);
  b.rule().bold(true).line(d.title ?? TITLES[d.doc.type] ?? d.doc.type).bold(false).align('left');
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
  b.lr('Subtotal', money(d.doc.subtotal));
  b.lr(`${s.tax_name ?? 'Tax'} ${Number(s.tax_rate ?? 0)}%`, money(d.doc.tax));
  b.bold(true).size(cols >= 48).lr('TOTAL', `${s.currency ?? ''} ${money(d.doc.total)}`).size(false).bold(false);
  for (const p of d.payments ?? []) b.lr(`Paid (${p.name})`, money(p.amount));
  const bal = Number(d.doc.total) - Number(d.doc.paid ?? 0) - Number(d.doc.credited ?? 0);
  if (d.doc.type === 'INVOICE' && bal > 0.004) b.bold(true).lr('BALANCE DUE', money(bal)).bold(false);
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
  <div class=c><b>${esc(s.company_name)}</b><br>${esc(s.address)}<br>${s.phone ? 'Tel: ' + esc(s.phone) : ''}</div><hr>
  <div class=c><b>${d.title ?? TITLES[d.doc.type] ?? d.doc.type}</b></div>
  <div>${esc(d.doc.doc_no)} · ${dateTimeFmt(d.doc.doc_date)}<br>${d.customer ? 'Customer: ' + esc(d.customer.name) : ''}${d.salesman ? '<br>Salesman: ' + esc(d.salesman) : ''}</div><hr>
  <table>${rows}</table><hr><table>
  <tr><td>Subtotal</td><td class=r>${money(d.doc.subtotal)}</td></tr><tr><td>${esc(s.tax_name)} ${Number(s.tax_rate ?? 0)}%</td><td class=r>${money(d.doc.tax)}</td></tr>
  <tr><td><b>TOTAL</b></td><td class=r><b>${esc(s.currency)} ${money(d.doc.total)}</b></td></tr></table><hr>
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
