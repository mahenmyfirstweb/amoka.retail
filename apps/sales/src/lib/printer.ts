/**
 * Thermal receipt printing.
 *  - Bluetooth (BLE) ESC/POS printers through Web Bluetooth (Chrome on Android / desktop).
 *  - Fallback: normal print dialog (Android print service, AirPrint, RawBT, etc.).
 */

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
/** 80mm is the default; 58mm can be chosen in More. */
export const paperWidth = (): Paper => (localStorage.getItem('amoka.sales.paper') === '58' ? 58 : 80);
export const setPaperWidth = (w: Paper) => localStorage.setItem('amoka.sales.paper', String(w));

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

// ---------- printing / PDF / WhatsApp (layouts are shared with the admin portal) ----------
import {
  invoiceLayout, paymentLayout, statementLayout, toEscPos, toHtml, printHtml, toPdf, downloadBlob, shareToWhatsApp, shareMessage,
  type InvoiceData, type PaymentReceiptData, type StatementData, type PLine, type Paper, type Row,
} from '../../../../packages/shared/receipts';
export { printDate, printDateTime, loadPaymentReceipt, invoiceDataFromDoc } from '../../../../packages/shared/receipts';
export type { InvoiceData, PaymentReceiptData, StatementData };
/** @deprecated name kept for older screens */
export type ReceiptData = InvoiceData;

const logoOf = (s: Row | null) => s?.logo_url || `${location.origin}/logo.png`;

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

async function output(lines: PLine[], settings: Row | null) {
  if (bluetoothSupported() && printerName()) return printBluetooth(toEscPos(lines, paperWidth()));
  printHtml(toHtml(lines, paperWidth(), logoOf(settings)));
}

export const printReceipt = (d: InvoiceData) => output(invoiceLayout(d, paperWidth()), d.settings);
export const printPaymentReceipt = (d: PaymentReceiptData) => output(paymentLayout(d, paperWidth()), d.settings);
export const printStatement = (d: StatementData) => output(statementLayout(d), d.settings);

// PDFs are always 80mm wide (looks right on phones and when printed later).
export const invoicePdf = (d: InvoiceData) => toPdf(invoiceLayout(d, 80), 80, logoOf(d.settings));
export const receiptPdf = (d: PaymentReceiptData) => toPdf(paymentLayout(d, 80), 80, logoOf(d.settings));
export const statementPdf = (d: StatementData) => toPdf(statementLayout(d), 80, logoOf(d.settings));

const safe = (s: string) => s.replace(/[^\w-]+/g, '_');

export async function downloadInvoicePdf(d: InvoiceData) {
  downloadBlob(await invoicePdf(d), `${safe(d.doc.doc_no)}.pdf`);
}
export async function downloadReceiptPdf(d: PaymentReceiptData) {
  downloadBlob(await receiptPdf(d), `${safe(d.receipt.receipt_no)}.pdf`);
}
export async function downloadStatementPdf(d: StatementData) {
  downloadBlob(await statementPdf(d), `Statement_${safe(d.customer.name)}.pdf`);
}

export async function whatsappInvoice(d: InvoiceData) {
  const extra = d.outstanding !== undefined ? `Total outstanding: ${d.settings?.currency ?? 'SGD'} ${d.outstanding.toFixed(2)}` : undefined;
  return shareToWhatsApp(await invoicePdf(d), `${safe(d.doc.doc_no)}.pdf`, shareMessage('invoice', d.settings, d.doc.doc_no, Number(d.doc.total), extra), d.customer?.phone);
}
export async function whatsappReceipt(d: PaymentReceiptData) {
  return shareToWhatsApp(await receiptPdf(d), `${safe(d.receipt.receipt_no)}.pdf`, shareMessage('receipt', d.settings, d.receipt.receipt_no, Number(d.receipt.amount)), d.customer?.phone);
}
export async function whatsappStatement(d: StatementData) {
  const closing = d.rows.length ? Number(d.rows[d.rows.length - 1].balance) : 0;
  return shareToWhatsApp(await statementPdf(d), `Statement_${safe(d.customer.name)}.pdf`, shareMessage('statement', d.settings, d.customer.name, closing, 'Balance due'), d.customer?.phone);
}
