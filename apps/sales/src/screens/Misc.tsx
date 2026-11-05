import { BrandLogo } from '../Brand';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bluetooth, ChevronRight, ClipboardList, CloudUpload, HandCoins, LayoutGrid, LogOut, Printer, RefreshCw, ScrollText, Store as StoreIcon, Undo2, Wallet } from 'lucide-react';
import { useStore } from '../lib/store';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { dateTimeFmt, longDate, money } from '../lib/format';
import { bluetoothSupported, connectPrinter, paperWidth, printReceipt, printerName, setPaperWidth } from '../lib/printer';
import { TopBar, useToast } from '../ui';

export function Home() {
  const { profile, customer, pending, online, products, customers, lastSync } = useStore();
  const nav = useNavigate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: stats } = useQuery({
    queryKey: ['my-today'],
    enabled: online && !!profile,
    queryFn: async () => {
      const [docs, rec] = await Promise.all([
        supabase.from('sales_docs').select('type, total').eq('user_id', profile!.id).neq('status', 'VOID').gte('doc_date', today.toISOString()),
        supabase.from('receipts').select('amount').eq('user_id', profile!.id).eq('status', 'ACTIVE').gte('receipt_date', today.toISOString()),
      ]);
      const d = docs.data ?? [];
      return {
        orders: d.filter((x) => x.type === 'ORDER').length,
        invoices: d.filter((x) => x.type === 'INVOICE').length,
        sales: d.reduce((s, x) => s + Number(x.total), 0),
        collected: (rec.data ?? []).reduce((s, x) => s + Number(x.amount), 0),
      };
    },
  });
  const hour = new Date().getHours();
  return (
    <div className="pb-6">
      <div className="relative overflow-hidden bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 px-5 pb-8 pt-6 text-white safe-top">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="flex items-start justify-between gap-3"><div className="min-w-0 pt-1 text-[11px] font-medium uppercase tracking-[0.25em] text-gold-300">{longDate()}</div><div className="shrink-0"><BrandLogo className="h-14 min-w-[80px]" light /></div></div>
        <h1 className="mt-2 font-display text-3xl">Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'},<br />{profile?.full_name?.split(' ')[0]}</h1>
        <div className="mt-1 text-sm text-ink-400">{profile?.location?.name ?? 'No location set'}</div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Stat label="Today's sales" value={money(stats?.sales ?? 0)} />
          <Stat label="Collected today" value={money(stats?.collected ?? 0)} />
          <Stat label="Orders" value={String(stats?.orders ?? 0)} />
          <Stat label="Invoices" value={String(stats?.invoices ?? 0)} />
        </div>
      </div>
      <div className="-mt-4 overflow-hidden rounded-t-3xl bg-ink-50">
        <div className="grid grid-cols-2 gap-3 p-4">
          <Tile icon={<StoreIcon size={22} />} title="Retail shops" sub={`${customers.length} shops`} onClick={() => nav('/customers')} />
          <Tile icon={<LayoutGrid size={22} />} title="Catalog" sub={`${products.length} products`} onClick={() => nav('/catalog')} />
          <Tile icon={<ClipboardList size={22} />} title="My orders" sub={pending.length ? `${pending.length} waiting to send` : 'History & print'} onClick={() => nav('/orders')} />
          <Tile icon={<Wallet size={22} />} title="Receive payment" sub="Receipt against invoices" onClick={() => nav('/pick/collect')} />
          <Tile icon={<Undo2 size={22} />} title="Sales return" sub="Expired / damaged goods" onClick={() => nav('/pick/return')} />
          <Tile icon={<ScrollText size={22} />} title="Statement" sub="Outstanding by date range" onClick={() => nav('/pick/statement')} />
          <Tile icon={<HandCoins size={22} />} title="My receipts" sub="Payments collected" onClick={() => nav('/receipts')} />
          <Tile icon={<ClipboardList size={22} />} title="Returns list" sub="Credit notes" onClick={() => nav('/orders')} />
        </div>
        <div className="px-4 text-center text-xs text-ink-400">{lastSync ? `Catalog updated ${dateTimeFmt(lastSync)}` : 'Catalog not downloaded yet'}</div>
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10"><div className="text-[11px] text-ink-400">{label}</div><div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div></div>
);
const Tile = ({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) => (
  <button onClick={onClick} className="card flex flex-col items-start gap-3 p-4 text-left active:scale-[0.98]">
    <div className="rounded-xl bg-ink-900 p-2.5 text-gold-300">{icon}</div>
    <div><div className="font-semibold text-ink-900">{title}</div><div className="truncate text-xs text-ink-400">{sub}</div></div>
  </button>
);

export function More() {
  const { profile, signOut, refreshData, syncing, lastSync, pending, syncPending, online, settings } = useStore();
  const toast = useToast();
  const [printer, setPrinter] = useState(printerName());
  const [paper, setPaper] = useState(paperWidth());
  const [auto, setAuto] = useState(localStorage.getItem('amoka.sales.autoprint') === '1');

  async function pair() {
    try { setPrinter(await connectPrinter()); toast('ok', 'Printer connected'); } catch (e) { toast('err', (e as Error).message); }
  }
  async function test() {
    try {
      await printReceipt({
        settings, customer: null, salesman: profile?.full_name, title: 'TEST PRINT',
        doc: { doc_no: 'TEST', doc_date: new Date().toISOString(), type: 'TEST', subtotal: 1, tax: 0, total: 1, discount: 0 },
        lines: [{ description: 'Printer test line', qty: 1, price: 1, line_total: 1 }],
      });
    } catch (e) { toast('err', (e as Error).message); }
  }

  return (
    <div className="pb-6">
      <TopBar title="More" />
      <div className="space-y-4 p-3">
        <div className="card flex items-center gap-3 p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-900 font-display text-xl text-gold-300">{profile?.full_name?.slice(0, 1)}</div>
          <div><div className="font-semibold">{profile?.full_name}</div><div className="text-xs text-ink-400">{profile?.role} · {profile?.location?.name}</div></div>
        </div>

        <Section title="Bluetooth printer">
          <Item icon={<Bluetooth size={18} />} label={printer ? `Paired: ${printer}` : 'Pair printer'} sub={bluetoothSupported() ? 'BLE thermal printer (ESC/POS)' : 'Not supported on this browser — system print is used'} onClick={pair} />
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span>Paper width</span>
            <div className="flex rounded-lg bg-ink-50 p-0.5 text-xs font-semibold">
              {([58, 80] as const).map((w) => <button key={w} className={`rounded-md px-3 py-1.5 ${paper === w ? 'bg-white shadow-sm' : 'text-ink-400'}`} onClick={() => { setPaperWidth(w); setPaper(w); }}>{w} mm</button>)}
            </div>
          </div>
          <label className="flex items-center justify-between px-4 py-3 text-sm">
            <span>Auto-print new invoices</span>
            <input type="checkbox" className="h-5 w-5 accent-ink-900" checked={auto} onChange={(e) => { setAuto(e.target.checked); localStorage.setItem('amoka.sales.autoprint', e.target.checked ? '1' : '0'); }} />
          </label>
          <Item icon={<Printer size={18} />} label="Test print" onClick={test} />
        </Section>

        <Section title="Data">
          <Item icon={<RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />} label="Refresh catalog & shops" sub={lastSync ? `Last: ${dateTimeFmt(lastSync)}` : undefined} onClick={() => refreshData().then(() => toast('ok', 'Updated')).catch((e) => toast('err', e.message))} />
          <Item icon={<CloudUpload size={18} />} label="Send offline orders" sub={`${pending.length} waiting${online ? '' : ' · offline'}`} onClick={() => syncPending()} />
        </Section>

        <Section title="Install on this device">
          <p className="px-4 py-3 text-xs leading-relaxed text-ink-500">
            Android (Chrome): tap ⋮ menu → <b>Install app</b> / <b>Add to Home screen</b>.<br />
            iPhone / iPad (Safari): tap Share → <b>Add to Home Screen</b>.
          </p>
        </Section>

        <button className="btn-secondary w-full text-rose-600" onClick={() => (pending.length && !confirm(`${pending.length} offline orders are not sent yet. Sign out anyway?`) ? null : signOut())}><LogOut size={17} /> Sign out</button>
      </div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div><div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-ink-400">{title}</div><div className="card divide-y divide-ink-100">{children}</div></div>
);
const Item = ({ icon, label, sub, onClick }: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) => (
  <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-50">
    <span className="text-ink-500">{icon}</span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span>{sub && <span className="block truncate text-xs text-ink-400">{sub}</span>}</span>
    <ChevronRight size={16} className="text-ink-300" />
  </button>
);

export function Login() {
  const { session, profile, permissions, signIn, signOut, ready } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (ready && session && profile?.is_active && permissions.has('mobile_app')) return <Navigate to="/" replace />;
  const blocked = ready && session && profile && (!profile.is_active || !permissions.has('mobile_app'));

  return (
    <div className="flex min-h-full flex-col bg-ink-950 bg-[radial-gradient(circle_at_30%_10%,rgba(234,168,58,0.25),transparent_55%),radial-gradient(circle_at_90%_100%,rgba(122,59,37,0.6),transparent_55%)] px-6 text-white safe-top">
      <div className="flex flex-1 flex-col justify-center">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 text-center">
            <BrandLogo className="mx-auto mb-5 h-32 drop-shadow-[0_16px_36px_rgba(0,0,0,0.5)]" light />
            <div className="mt-1 text-xs uppercase tracking-[0.3em] text-gold-300">Sales</div>
          </div>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setError(null);
            try { await signIn(email.trim(), password); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
          }}>
            {!supabaseConfigured && <div className="rounded-xl bg-rose-600/20 p-3 text-sm text-rose-200">Supabase is not configured (apps/sales/.env).</div>}
            {error && <div className="rounded-xl bg-rose-600/20 p-3 text-sm text-rose-200">{error}</div>}
            {blocked && (
              <div className="rounded-xl bg-amber-500/20 p-3 text-sm text-amber-100">
                {!profile!.is_active ? 'Your account is waiting for activation by the office.' : 'Your role does not have access to the sales app. Ask the admin to enable "salesman app" for your role.'}
                <button type="button" className="mt-2 block font-semibold underline" onClick={signOut}>Use another account</button>
              </div>
            )}
            <input className="input border-white/10 bg-white/5 text-white placeholder:text-ink-400" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input border-white/10 bg-white/5 text-white placeholder:text-ink-400" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn-gold w-full py-3.5 text-base" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </div>
      </div>
      <div className="pb-6 text-center text-xs text-ink-500 safe-bottom">© {new Date().getFullYear()} AMOKA TRADING PTE LTD</div>
    </div>
  );
}
