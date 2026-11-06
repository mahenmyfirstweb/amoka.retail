import { useState } from 'react';
import { FileDown, MessageCircle, Printer, X } from 'lucide-react';
import { daysSince, overdueAge } from '../../../../packages/shared/receipts';
import type { Row } from '../lib/data';
import { money } from '../lib/format';
import { useToast } from './ui';

/** On-screen preview of the 80mm printout (exactly what will print); Print / PDF / WhatsApp from here. */
export function PrintPreview({ html, title = 'Print preview', onClose, onPrint, onPdf, onWhatsapp }: {
  html: string | null;
  title?: string;
  onClose: () => void;
  onPrint: () => Promise<unknown> | void;
  onPdf?: () => Promise<unknown> | void;
  onWhatsapp?: () => Promise<unknown> | void;
}) {
  const toast = useToast();
  const [height, setHeight] = useState(700);
  const [busy, setBusy] = useState('');
  if (!html) return null;
  const run = async (key: string, fn?: () => Promise<unknown> | void) => {
    if (!fn) return;
    setBusy(key);
    try { await fn(); } catch (e) { toast('err', (e as Error).message); } finally { setBusy(''); }
  };
  return (
    <div className="no-print fixed inset-0 z-50 flex bg-ink-950/70 backdrop-blur-sm" onClick={onClose}>
      <div className="m-auto flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-ink-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-white px-5 py-3">
          <div className="font-semibold text-ink-900">{title}</div>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto w-fit bg-white p-2 shadow-lg">
            <iframe
              title="preview"
              srcDoc={html.replace('<body>', '<body style="margin:0 auto">')}
              className="block w-[310px] border-0"
              style={{ height }}
              onLoad={(e) => {
                const d = e.currentTarget.contentDocument;
                if (d) setHeight(Math.max(300, d.documentElement.scrollHeight + 8));
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 bg-white p-3">
          <button className="btn-primary" disabled={!!busy} onClick={() => run('print', onPrint)}><Printer size={15} /> Print</button>
          <button className="btn-secondary" disabled={!!busy || !onPdf} onClick={() => run('pdf', onPdf)}><FileDown size={15} /> PDF</button>
          <button className="btn-secondary !text-emerald-700" disabled={!!busy || !onWhatsapp} onClick={() => run('wa', onWhatsapp)}><MessageCircle size={15} /> WhatsApp</button>
        </div>
      </div>
    </div>
  );
}

/** Highlighted shop outstanding + overdue (amount, invoices, months / weeks / days). */
export function OutstandingPanel({ status, currency = 'SGD' }: { status: Row | null | undefined; currency?: string }) {
  if (!status) return null;
  const overdue = Number(status.overdue_amount) > 0.004;
  return (
    <div className={`no-print mb-5 overflow-hidden rounded-2xl ring-1 ${overdue ? 'ring-rose-200' : 'ring-ink-100'}`}>
      <div className={`flex flex-wrap items-end justify-between gap-4 px-5 py-4 text-white ${overdue ? 'bg-gradient-to-r from-rose-700 to-rose-500' : 'bg-gradient-to-r from-ink-900 to-ink-700'}`}>
        <div>
          <div className="text-[11px] uppercase tracking-wider opacity-80">Shop total outstanding</div>
          <div className="font-display text-3xl font-semibold tabular-nums">{currency} {money(status.outstanding)}</div>
        </div>
        {Number(status.credit_limit) > 0 && (
          <div className="text-right text-sm opacity-90">
            Credit limit {currency} {money(status.credit_limit)}<br />Available {currency} {money(status.available)}
          </div>
        )}
      </div>
      {overdue ? (
        <div className="grid gap-4 bg-rose-50 px-5 py-4 text-rose-900 sm:grid-cols-4">
          <div><div className="text-xs text-rose-500">Overdue amount</div><div className="text-xl font-semibold tabular-nums">{currency} {money(status.overdue_amount)}</div></div>
          <div><div className="text-xs text-rose-500">Overdue invoices</div><div className="text-xl font-semibold">{status.overdue_count}</div></div>
          <div className="sm:col-span-2">
            <div className="text-xs text-rose-500">Overdue for (oldest due {status.oldest_due ? new Date(status.oldest_due).toLocaleDateString('en-GB') : '—'})</div>
            <div className="text-xl font-bold">{overdueAge(status.oldest_due)} <span className="text-sm font-medium text-rose-500">({daysSince(status.oldest_due)} days)</span></div>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50 px-5 py-2.5 text-sm font-medium text-emerald-700">No overdue invoices</div>
      )}
    </div>
  );
}
