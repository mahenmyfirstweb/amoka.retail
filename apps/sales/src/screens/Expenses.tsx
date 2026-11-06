/** Salesman expense claims: add with receipt photo, track status (Submitted → Approved → Paid). */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Image as ImageIcon, Plus, Receipt, Trash2 } from 'lucide-react';
import { useStore, type Row } from '../lib/store';
import { supabase } from '../lib/supabase';
import { dateFmt, isoDate, price } from '../lib/format';
import { Empty, Sheet, TopBar, useToast } from '../ui';

export const EXPENSE_CATEGORIES: [string, string, string][] = [
  ['TOPUP', 'Transport card top-up', '🚇'],
  ['FUEL', 'Fuel', '⛽'],
  ['PARKING', 'Parking / ERP', '🅿️'],
  ['STATIONERY', 'Stationery (notebook, pen)', '✏️'],
  ['MEALS', 'Meals', '🍱'],
  ['PHONE', 'Phone / data', '📱'],
  ['OTHER', 'Other', '🧾'],
];
const PAID_BY = [['CASH', 'Cash'], ['CARD', 'Card'], ['NETS', 'NETS'], ['PAYNOW', 'PayNow']];
const catLabel = (k: string) => EXPENSE_CATEGORIES.find((c) => c[0] === k)?.[1] ?? k;
const catIcon = (k: string) => EXPENSE_CATEGORIES.find((c) => c[0] === k)?.[2] ?? '🧾';

const STATUS: Record<string, string> = {
  SUBMITTED: 'bg-gold-50 text-gold-700',
  APPROVED: 'bg-sky-50 text-sky-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-rose-50 text-rose-600',
};

/** Shrinks photos to max 1600px JPEG so uploads are fast on mobile data. */
async function compress(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.82));
  } catch {
    return file;
  }
}

export default function Expenses() {
  const { profile, online } = useStore();
  const toast = useToast();
  const qc = useQueryClient();
  const [month, setMonth] = useState(isoDate().slice(0, 7));
  const [editing, setEditing] = useState<Row | null>(null);
  const [view, setView] = useState<Row | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['my-claims', month],
    enabled: online && !!profile,
    queryFn: async () => {
      const [y, m] = month.split('-').map(Number);
      const from = `${month}-01`;
      const to = isoDate(new Date(y, m, 0));
      const { data, error } = await supabase.from('expense_claims').select('*').eq('user_id', profile!.id)
        .gte('claim_date', from).lte('claim_date', to).order('claim_date', { ascending: false }).order('id', { ascending: false });
      if (error) throw new Error(error.message);
      return data as Row[];
    },
  });

  const totals = useMemo(() => {
    const t: Record<string, number> = { SUBMITTED: 0, APPROVED: 0, PAID: 0, REJECTED: 0 };
    for (const c of data) t[c.status] += Number(c.amount);
    return t;
  }, [data]);
  const claimable = totals.SUBMITTED + totals.APPROVED + totals.PAID;

  return (
    <div className="pb-24">
      <TopBar title="My expenses" back />
      <div className="space-y-3 p-3">
        <div className="rounded-2xl bg-gradient-to-br from-ink-800 to-ink-950 p-5 text-white">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.25em] text-gold-300">Claims for</div>
            <input type="month" className="rounded-lg bg-white/10 px-2 py-1 text-sm text-white" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="mt-2 font-display text-3xl font-semibold tabular-nums">{price(claimable)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-white/5 py-2"><div className="text-ink-400">Waiting</div><div className="font-semibold">{price(totals.SUBMITTED)}</div></div>
            <div className="rounded-xl bg-white/5 py-2"><div className="text-ink-400">Approved</div><div className="font-semibold">{price(totals.APPROVED)}</div></div>
            <div className="rounded-xl bg-white/5 py-2"><div className="text-ink-400">Refunded</div><div className="font-semibold text-emerald-300">{price(totals.PAID)}</div></div>
          </div>
        </div>

        {!online ? <Empty icon={<Receipt size={44} />} title="Offline">Connect to the internet to add or view expenses.</Empty>
          : isLoading ? <div className="p-6 text-center text-sm text-ink-400">Loading…</div>
          : !data.length ? <Empty icon={<Receipt size={44} />} title="No expenses this month">Tap + to add your first claim.</Empty>
          : (
            <div className="card divide-y divide-ink-100">
              {data.map((c) => (
                <button key={c.id} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-50" onClick={() => (c.status === 'SUBMITTED' ? setEditing(c) : setView(c))}>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-50 text-xl">{catIcon(c.category)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink-900">{catLabel(c.category)}</div>
                    <div className="truncate text-xs text-ink-400">{dateFmt(c.claim_date)} · {c.claim_no}{c.description ? ` · ${c.description}` : ''}</div>
                    {c.status === 'REJECTED' && c.review_note && <div className="text-xs text-rose-600">Reason: {c.review_note}</div>}
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{price(c.amount)}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[c.status]}`}>{c.status === 'PAID' ? 'Refunded' : c.status.charAt(0) + c.status.slice(1).toLowerCase()}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
      </div>

      {online && (
        <button className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950 shadow-xl active:scale-95" onClick={() => setEditing({ claim_date: isoDate(), category: '', paid_by: 'CASH' })}>
          <Plus size={26} />
        </button>
      )}

      <ClaimForm claim={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['my-claims'] }); toast('ok', 'Expense saved'); }} />
      <ClaimView claim={view} onClose={() => setView(null)} />
    </div>
  );
}

function useReceiptUrl(path?: string | null) {
  return useQuery({
    queryKey: ['receipt-url', path],
    enabled: !!path,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => (await supabase.storage.from('expense-receipts').createSignedUrl(path!, 3600)).data?.signedUrl ?? null,
  });
}

function ClaimForm({ claim, onClose, onSaved }: { claim: Row | null; onClose: () => void; onSaved: () => void }) {
  const { profile } = useStore();
  const toast = useToast();
  const [f, setF] = useState<Row>({});
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<unknown>(undefined);
  const { data: existingUrl } = useReceiptUrl(claim?.receipt_path);

  if (claim && lastId !== (claim.id ?? 'new')) {
    setLastId(claim.id ?? 'new');
    setF({ ...claim });
    setFile(null);
    setPreview(null);
  }
  if (!claim) return null;

  function pick(fl: FileList | null) {
    const x = fl?.[0];
    if (!x) return;
    setFile(x);
    setPreview(x.type.startsWith('image/') ? URL.createObjectURL(x) : null);
  }

  async function save() {
    if (!f.category) return toast('err', 'Choose the expense type');
    if (!(Number(f.amount) > 0)) return toast('err', 'Enter the amount');
    if (!file && !f.receipt_path) return toast('err', 'Attach the receipt photo');
    setBusy(true);
    try {
      let receipt_path = f.receipt_path ?? null;
      if (file) {
        const blob = await compress(file);
        const ext = blob.type === 'application/pdf' ? 'pdf' : 'jpg';
        const path = `${profile!.id}/${Date.now()}.${ext}`;
        const up = await supabase.storage.from('expense-receipts').upload(path, blob, { contentType: blob.type || 'image/jpeg' });
        if (up.error) throw new Error(up.error.message.includes('Bucket not found') ? 'Ask the admin to run SQL file 15 (expense claims)' : up.error.message);
        receipt_path = path;
      }
      const row = {
        claim_date: f.claim_date,
        category: f.category,
        description: f.description?.trim() || null,
        amount: Number(f.amount),
        paid_by: f.paid_by ?? 'CASH',
        receipt_path,
      };
      const q = f.id ? supabase.from('expense_claims').update(row).eq('id', f.id) : supabase.from('expense_claims').insert(row);
      const { error } = await q;
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!f.id || !confirm('Delete this expense claim?')) return;
    const { error } = await supabase.from('expense_claims').delete().eq('id', f.id);
    if (error) return toast('err', error.message);
    if (f.receipt_path) await supabase.storage.from('expense-receipts').remove([f.receipt_path]);
    onSaved();
  }

  const shown = preview ?? (file ? null : existingUrl);
  return (
    <Sheet open onClose={onClose} title={f.id ? `Edit ${f.claim_no}` : 'New expense'} footer={
      <div className="flex gap-2">
        {f.id && <button className="btn-secondary !text-rose-600" onClick={remove}><Trash2 size={16} /></button>}
        <button className="btn-gold flex-1 py-3.5" disabled={busy} onClick={save}>{busy ? 'Saving…' : f.id ? 'Save changes' : 'Submit claim'}</button>
      </div>
    }>
      <div className="space-y-4">
        <div>
          <span className="label">Expense type</span>
          <div className="grid grid-cols-2 gap-2">
            {EXPENSE_CATEGORIES.map(([k, l, i]) => (
              <button key={k} type="button" className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium ${f.category === k ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-700'}`} onClick={() => setF({ ...f, category: k })}>
                <span className="text-base">{i}</span>{l}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Date</span><input type="date" className="input" value={f.claim_date ?? ''} max={isoDate()} onChange={(e) => setF({ ...f, claim_date: e.target.value })} /></label>
          <label className="block"><span className="label">Amount ($)</span><input className="input text-lg font-semibold" inputMode="decimal" placeholder="0.00" value={f.amount ?? ''} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
        </div>
        <label className="block"><span className="label">Description</span><input className="input" placeholder="e.g. EZ-link top-up, 2 notebooks + pens" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div>
          <span className="label">I paid by</span>
          <div className="grid grid-cols-4 gap-2">
            {PAID_BY.map(([k, l]) => (
              <button key={k} type="button" className={`rounded-xl py-2 text-xs font-semibold ${f.paid_by === k ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600'}`} onClick={() => setF({ ...f, paid_by: k })}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Receipt photo *</span>
          {shown ? (
            <img src={shown} alt="receipt" className="mb-2 max-h-64 w-full rounded-xl bg-ink-50 object-contain" />
          ) : file ? (
            <div className="mb-2 rounded-xl bg-ink-50 p-3 text-sm">{file.name}</div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label className="btn-secondary cursor-pointer"><Camera size={16} /> Take photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files)} /></label>
            <label className="btn-secondary cursor-pointer"><ImageIcon size={16} /> Gallery / PDF<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => pick(e.target.files)} /></label>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function ClaimView({ claim, onClose }: { claim: Row | null; onClose: () => void }) {
  const { data: url } = useReceiptUrl(claim?.receipt_path);
  if (!claim) return null;
  return (
    <Sheet open onClose={onClose} title={claim.claim_no}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <div><div className="font-semibold">{catIcon(claim.category)} {catLabel(claim.category)}</div><div className="text-xs text-ink-400">{dateFmt(claim.claim_date)} · paid by {String(claim.paid_by).toLowerCase()}</div></div>
          <div className="text-right"><div className="text-xl font-semibold tabular-nums">{price(claim.amount)}</div><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[claim.status]}`}>{claim.status === 'PAID' ? 'Refunded' : claim.status}</span></div>
        </div>
        {claim.description && <p className="text-ink-600">{claim.description}</p>}
        {claim.review_note && <p className={`rounded-xl p-2 text-xs ${claim.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-ink-50 text-ink-600'}`}>Accounts: {claim.review_note}</p>}
        {claim.status === 'PAID' && <p className="rounded-xl bg-emerald-50 p-2 text-xs text-emerald-700">Refunded {claim.paid_at ? dateFmt(claim.paid_at) : ''}{claim.paid_ref ? ` · Ref ${claim.paid_ref}` : ''}</p>}
        {url && (claim.receipt_path?.endsWith('.pdf')
          ? <a className="btn-secondary w-full" href={url} target="_blank" rel="noreferrer">Open receipt PDF</a>
          : <img src={url} alt="receipt" className="w-full rounded-xl bg-ink-50 object-contain" />)}
      </div>
    </Sheet>
  );
}
