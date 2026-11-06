/** Diesel / fuel top-ups per vehicle with proof photo; optional refund claim when paid with own money. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Fuel as FuelIcon, Image as ImageIcon, Plus } from 'lucide-react';
import { useStore, type Row } from '../lib/store';
import { supabase } from '../lib/supabase';
import { dateTimeFmt, isoDate, price } from '../lib/format';
import { Empty, Sheet, TopBar, useToast } from '../ui';

const PAID_BY = [['COMPANY_CARD', 'Company fuel card'], ['CASH', 'Own cash'], ['CARD', 'Own card'], ['PAYNOW', 'PayNow']];

async function compress(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const img = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s);
    c.height = Math.round(img.height * s);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b ?? file), 'image/jpeg', 0.82));
  } catch {
    return file;
  }
}

const localDateTime = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Fuel() {
  const { profile, online } = useStore();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Row | null>(null);
  const [view, setView] = useState<Row | null>(null);

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    enabled: online,
    queryFn: async () => (await supabase.from('vehicles').select('*').eq('is_active', true).order('code')).data ?? [],
  });
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['my-fuel'],
    enabled: online && !!profile,
    queryFn: async () => (await supabase.from('fuel_logs').select('*, vehicle:vehicles(code, name)').eq('user_id', profile!.id).order('filled_at', { ascending: false }).limit(100)).data ?? [],
  });
  const month = isoDate().slice(0, 7);
  const thisMonth = logs.filter((l: Row) => String(l.filled_at).slice(0, 7) === month);
  const litres = thisMonth.reduce((s: number, l: Row) => s + Number(l.litres), 0);
  const amount = thisMonth.reduce((s: number, l: Row) => s + Number(l.amount), 0);
  const myVehicle = vehicles.find((v: Row) => v.assigned_to === profile?.id) ?? vehicles[0];

  return (
    <div className="pb-24">
      <TopBar title="Diesel top-up" back />
      <div className="space-y-3 p-3">
        <div className="rounded-2xl bg-gradient-to-br from-ink-800 to-ink-950 p-5 text-white">
          <div className="text-[11px] uppercase tracking-[0.25em] text-gold-300">This month</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div><div className="text-xs text-ink-400">Top-ups</div><div className="text-xl font-semibold">{thisMonth.length}</div></div>
            <div><div className="text-xs text-ink-400">Litres</div><div className="text-xl font-semibold tabular-nums">{litres.toFixed(1)}</div></div>
            <div><div className="text-xs text-ink-400">Amount</div><div className="text-xl font-semibold tabular-nums">{price(amount)}</div></div>
          </div>
        </div>

        {!online ? <Empty icon={<FuelIcon size={44} />} title="Offline">Connect to the internet to record a top-up.</Empty>
          : !vehicles.length ? <Empty icon={<FuelIcon size={44} />} title="No vehicles yet">Ask the office to add your vehicle in Master → Vehicles.</Empty>
          : isLoading ? <div className="p-6 text-center text-sm text-ink-400">Loading…</div>
          : !logs.length ? <Empty icon={<FuelIcon size={44} />} title="No top-ups recorded">Tap + after filling diesel.</Empty>
          : (
            <div className="card divide-y divide-ink-100">
              {logs.map((l: Row) => (
                <button key={l.id} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-50" onClick={() => setView(l)}>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-700"><FuelIcon size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink-900">{l.vehicle?.code} · {Number(l.litres).toFixed(2)} L</div>
                    <div className="truncate text-xs text-ink-400">{dateTimeFmt(l.filled_at)}{l.station ? ` · ${l.station}` : ''}{l.odometer ? ` · ${l.odometer.toLocaleString()} km` : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{price(l.amount)}</div>
                    <div className="text-[10px] text-ink-400">{l.claim_id ? 'claimed' : String(l.paid_by).replace('_', ' ').toLowerCase()}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
      </div>

      {online && vehicles.length > 0 && (
        <button className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950 shadow-xl active:scale-95"
          onClick={() => setForm({ vehicle_id: myVehicle?.id, filled_at: localDateTime(), paid_by: 'COMPANY_CARD', claim: false })}>
          <Plus size={26} />
        </button>
      )}

      {form && <FuelForm init={form} vehicles={vehicles} onClose={() => setForm(null)} onSaved={() => { setForm(null); qc.invalidateQueries({ queryKey: ['my-fuel'] }); qc.invalidateQueries({ queryKey: ['my-claims'] }); toast('ok', 'Top-up saved'); }} />}
      <FuelView log={view} onClose={() => setView(null)} />
    </div>
  );
}

function FuelForm({ init, vehicles, onClose, onSaved }: { init: Row; vehicles: Row[]; onClose: () => void; onSaved: () => void }) {
  const { profile } = useStore();
  const toast = useToast();
  const [f, setF] = useState<Row>(init);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const perL = Number(f.litres) > 0 && Number(f.amount) > 0 ? Number(f.amount) / Number(f.litres) : 0;
  const ownMoney = f.paid_by !== 'COMPANY_CARD';

  async function save() {
    if (!f.vehicle_id) return toast('err', 'Choose the vehicle');
    if (!(Number(f.litres) > 0)) return toast('err', 'Enter the litres');
    if (!(Number(f.amount) > 0)) return toast('err', 'Enter the amount');
    if (!file) return toast('err', 'Attach the proof (receipt / pump photo)');
    setBusy(true);
    try {
      const blob = await compress(file);
      const path = `${profile!.id}/fuel-${Date.now()}.${blob.type === 'application/pdf' ? 'pdf' : 'jpg'}`;
      const up = await supabase.storage.from('expense-receipts').upload(path, blob, { contentType: blob.type || 'image/jpeg' });
      if (up.error) throw new Error(up.error.message.includes('Bucket not found') ? 'Ask the admin to run SQL files 15 and 16' : up.error.message);
      const vehicle = vehicles.find((v) => v.id === Number(f.vehicle_id));
      let claim_id: number | null = null;
      if (ownMoney && f.claim) {
        const { data: c, error: ce } = await supabase.from('expense_claims').insert({
          claim_date: String(f.filled_at).slice(0, 10), category: 'FUEL',
          description: `Diesel ${vehicle?.code ?? ''} ${Number(f.litres).toFixed(2)} L${f.station ? ` @ ${f.station}` : ''}`,
          amount: Number(f.amount), paid_by: f.paid_by === 'CASH' ? 'CASH' : f.paid_by === 'PAYNOW' ? 'PAYNOW' : 'CARD', receipt_path: path,
        }).select('id').single();
        if (ce) throw new Error(ce.message);
        claim_id = c.id;
      }
      const { error } = await supabase.from('fuel_logs').insert({
        vehicle_id: Number(f.vehicle_id), filled_at: new Date(f.filled_at).toISOString(), litres: Number(f.litres), amount: Number(f.amount),
        odometer: f.odometer ? Number(f.odometer) : null, station: f.station?.trim() || null, paid_by: f.paid_by,
        receipt_path: path, notes: f.notes?.trim() || null, claim_id,
      });
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="New diesel top-up" footer={<button className="btn-gold w-full py-3.5" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save top-up'}</button>}>
      <div className="space-y-4">
        <label className="block"><span className="label">Vehicle</span>
          <select className="input" value={f.vehicle_id ?? ''} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">When</span><input type="datetime-local" className="input" value={f.filled_at} max={localDateTime()} onChange={(e) => setF({ ...f, filled_at: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Litres</span><input className="input text-lg font-semibold" inputMode="decimal" placeholder="0.00" value={f.litres ?? ''} onChange={(e) => setF({ ...f, litres: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
          <label className="block"><span className="label">Amount ($)</span><input className="input text-lg font-semibold" inputMode="decimal" placeholder="0.00" value={f.amount ?? ''} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
        </div>
        {perL > 0 && <div className="-mt-2 text-xs text-ink-400">≈ {price(perL)} per litre</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">Odometer (km)</span><input className="input" inputMode="numeric" placeholder="optional" value={f.odometer ?? ''} onChange={(e) => setF({ ...f, odometer: e.target.value.replace(/[^0-9]/g, '') })} /></label>
          <label className="block"><span className="label">Station</span><input className="input" placeholder="e.g. Shell Tuas" value={f.station ?? ''} onChange={(e) => setF({ ...f, station: e.target.value })} /></label>
        </div>
        <div>
          <span className="label">Paid by</span>
          <div className="grid grid-cols-2 gap-2">
            {PAID_BY.map(([k, l]) => (
              <button key={k} type="button" className={`rounded-xl py-2.5 text-xs font-semibold ${f.paid_by === k ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600'}`} onClick={() => setF({ ...f, paid_by: k, claim: k !== 'COMPANY_CARD' })}>{l}</button>
            ))}
          </div>
          {ownMoney && (
            <label className="mt-2 flex items-center justify-between rounded-xl bg-gold-50 px-3 py-2.5 text-sm">
              <span>Claim refund (adds to my expenses)</span>
              <input type="checkbox" className="h-5 w-5 accent-ink-900" checked={!!f.claim} onChange={(e) => setF({ ...f, claim: e.target.checked })} />
            </label>
          )}
        </div>
        <div>
          <span className="label">Proof of top-up *</span>
          {preview && <img src={preview} alt="proof" className="mb-2 max-h-60 w-full rounded-xl bg-ink-50 object-contain" />}
          {file && !preview && <div className="mb-2 rounded-xl bg-ink-50 p-3 text-sm">{file.name}</div>}
          <div className="grid grid-cols-2 gap-2">
            <label className="btn-secondary cursor-pointer"><Camera size={16} /> Take photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) { setFile(x); setPreview(x.type.startsWith('image/') ? URL.createObjectURL(x) : null); } }} /></label>
            <label className="btn-secondary cursor-pointer"><ImageIcon size={16} /> Gallery / PDF<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) { setFile(x); setPreview(x.type.startsWith('image/') ? URL.createObjectURL(x) : null); } }} /></label>
          </div>
        </div>
        <label className="block"><span className="label">Notes</span><input className="input" value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
    </Sheet>
  );
}

function FuelView({ log, onClose }: { log: Row | null; onClose: () => void }) {
  const { data: url } = useQuery({
    queryKey: ['receipt-url', log?.receipt_path],
    enabled: !!log?.receipt_path,
    queryFn: async () => (await supabase.storage.from('expense-receipts').createSignedUrl(log!.receipt_path, 3600)).data?.signedUrl ?? null,
  });
  if (!log) return null;
  return (
    <Sheet open onClose={onClose} title={log.log_no}>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-ink-500">Vehicle</span><b>{log.vehicle?.code} · {log.vehicle?.name}</b></div>
        <div className="flex justify-between"><span className="text-ink-500">When</span><b>{dateTimeFmt(log.filled_at)}</b></div>
        <div className="flex justify-between"><span className="text-ink-500">Litres</span><b>{Number(log.litres).toFixed(2)} L</b></div>
        <div className="flex justify-between"><span className="text-ink-500">Amount</span><b>{price(log.amount)} ({price(Number(log.amount) / Number(log.litres))}/L)</b></div>
        {log.odometer && <div className="flex justify-between"><span className="text-ink-500">Odometer</span><b>{Number(log.odometer).toLocaleString()} km</b></div>}
        {log.station && <div className="flex justify-between"><span className="text-ink-500">Station</span><b>{log.station}</b></div>}
        <div className="flex justify-between"><span className="text-ink-500">Paid by</span><b>{String(log.paid_by).replace('_', ' ').toLowerCase()}{log.claim_id ? ' · refund claimed' : ''}</b></div>
        {url && (log.receipt_path?.endsWith('.pdf')
          ? <a className="btn-secondary mt-2 w-full" href={url} target="_blank" rel="noreferrer">Open proof PDF</a>
          : <img src={url} alt="proof" className="mt-2 w-full rounded-xl bg-ink-50 object-contain" />)}
      </div>
    </Sheet>
  );
}
