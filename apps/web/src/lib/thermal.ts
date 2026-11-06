/** 80mm invoice / receipt printing, PDF and WhatsApp for the admin portal (same layouts as the salesman app). */
import {
  invoiceLayout, paymentLayout, toHtml, printHtml, toPdf, downloadBlob, shareToWhatsApp, shareMessage,
  invoiceDataFromDoc, loadPaymentReceipt, type InvoiceData, type PaymentReceiptData, type Row,
} from '../../../../packages/shared/receipts';
import { supabase } from './supabase';

export { invoiceDataFromDoc };
export type { InvoiceData, PaymentReceiptData };

const PAPER = 80 as const;
const logoOf = (s: Row | null) => s?.logo_url || `${location.origin}/logo.png`;
const safe = (s: string) => s.replace(/[^\w-]+/g, '_');

export const printInvoice80 = (d: InvoiceData) => printHtml(toHtml(invoiceLayout(d, PAPER), PAPER, logoOf(d.settings)));
export const invoicePdf = (d: InvoiceData) => toPdf(invoiceLayout(d, PAPER), PAPER, logoOf(d.settings));
export async function downloadInvoicePdf(d: InvoiceData) {
  downloadBlob(await invoicePdf(d), `${safe(d.doc.doc_no)}.pdf`);
}
export async function whatsappInvoice(d: InvoiceData) {
  const extra = d.outstanding !== undefined ? `Total outstanding: ${d.settings?.currency ?? 'SGD'} ${d.outstanding.toFixed(2)}` : undefined;
  return shareToWhatsApp(await invoicePdf(d), `${safe(d.doc.doc_no)}.pdf`, shareMessage('invoice', d.settings, d.doc.doc_no, Number(d.doc.total), extra), d.customer?.phone);
}

export const loadReceipt = (id: number, settings: Row | null) => loadPaymentReceipt(supabase, id, settings);
export const printReceipt80 = (d: PaymentReceiptData) => printHtml(toHtml(paymentLayout(d, PAPER), PAPER, logoOf(d.settings)));
export const receiptPdf = (d: PaymentReceiptData) => toPdf(paymentLayout(d, PAPER), PAPER, logoOf(d.settings));
export async function downloadReceiptPdf(d: PaymentReceiptData) {
  downloadBlob(await receiptPdf(d), `${safe(d.receipt.receipt_no)}.pdf`);
}
export async function whatsappReceipt(d: PaymentReceiptData) {
  return shareToWhatsApp(await receiptPdf(d), `${safe(d.receipt.receipt_no)}.pdf`, shareMessage('receipt', d.settings, d.receipt.receipt_no, Number(d.receipt.amount)), d.customer?.phone);
}

/** HTML of the 80mm printouts, for the on-screen preview. */
export const invoiceHtml80 = (d: InvoiceData) => toHtml(invoiceLayout(d, PAPER), PAPER);
export const receiptHtml80 = (d: PaymentReceiptData) => toHtml(paymentLayout(d, PAPER), PAPER);
