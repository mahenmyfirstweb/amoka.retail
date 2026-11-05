import { BrandLogo } from '../components/Brand';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Clock4, Package, ShoppingBag, TrendingUp, Truck, Wallet } from 'lucide-react';
import { rpc, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useSettings, type Row } from '../lib/data';
import { dateFmt, money, qtyFmt } from '../lib/format';
import { Empty, Loading, PageHeader, Stat, StatusBadge } from '../components/ui';

function BarChart({ data }: { data: { date: string; total: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Number(d.total)));
  return (
    <div className="flex h-48 items-end gap-1">
      {data.map((d) => {
        const h = (Number(d.total) / max) * 100;
        const day = new Date(d.date);
        return (
          <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] text-white group-hover:block">
              {dateFmt(d.date)} · {money(d.total)}
            </div>
            <div
              className="rounded-t-md bg-gradient-to-t from-ink-800 to-ink-600 transition group-hover:from-gold-500 group-hover:to-gold-300"
              style={{ height: `${Math.max(h, Number(d.total) > 0 ? 3 : 1)}%` }}
            />
            <div className="mt-1 text-center text-[9px] text-ink-300">{day.getDate() % 5 === 0 ? day.getDate() : ''}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const { profile, locationId } = useAuth();
  const { data: settings } = useSettings();
  const { data: d, isLoading } = useQuery({
    queryKey: ['dashboard', locationId],
    queryFn: () => rpc<Row>('dashboard_summary', { p_location: null }),
  });
  const { data: recent = [] } = useQuery({
    queryKey: ['recent-invoices'],
    queryFn: async () =>
      (await supabase.from('sales_docs').select('id, doc_no, doc_date, total, paid, credited, status, customer:customers(name)').eq('type', 'INVOICE').order('id', { ascending: false }).limit(8)).data ?? [],
  });
  const cur = settings?.currency ?? '';
  const hour = new Date().getHours();

  if (isLoading || !d) return <Loading />;
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 p-8 text-white shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-gold-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-cocoa/50 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.35em] text-gold-300/90">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <h1 className="mt-2 font-display text-4xl">Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, {profile?.full_name?.split(' ')[0] ?? ''}</h1>
          </div>
          <BrandLogo className="h-24 drop-shadow-[0_12px_30px_rgba(0,0,0,0.5)]" light />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sales today" value={`${cur} ${money(d.sales.today)}`} sub={`${d.sales.today_count} invoices`} icon={<ShoppingBag size={18} />} />
        <Stat label="This week" value={`${cur} ${money(d.sales.week)}`} icon={<CalendarDays size={18} />} />
        <Stat label="This month" value={`${cur} ${money(d.sales.month)}`} sub={`${d.sales.month_count} invoices`} icon={<TrendingUp size={18} />} />
        <Stat label="Purchases this month" value={`${cur} ${money(d.purchase_month)}`} icon={<Truck size={18} />} />
        <Stat label="Receivable" value={`${cur} ${money(d.receivable.total)}`} sub={<span className={d.receivable.overdue > 0 ? 'text-rose-600' : ''}>{money(d.receivable.overdue)} overdue</span>} icon={<Wallet size={18} />} />
        <Stat label="Payable" value={`${cur} ${money(d.payable)}`} icon={<Wallet size={18} />} />
        <Stat label="Open sales orders" value={d.open_orders} sub={<Link to="/sales/ORDER" className="hover:text-gold-600">View orders →</Link>} icon={<Clock4 size={18} />} />
        <Stat label="Low stock items" value={d.low_stock.length} sub={<Link to="/products/stock" className="hover:text-gold-600">View stock →</Link>} icon={<AlertTriangle size={18} />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-ink-900">Sales — last 30 days</h3>
            <span className="text-xs text-ink-400">{cur}</span>
          </div>
          <BarChart data={d.sales_by_day} />
        </div>
        <div className="card p-5">
          <h3 className="mb-4 font-semibold text-ink-900">Top products this month</h3>
          {!d.top_products.length ? <Empty>No sales yet</Empty> : (
            <div className="space-y-3">
              {d.top_products.map((p: Row, i: number) => {
                const max = Number(d.top_products[0].amount) || 1;
                return (
                  <div key={p.product_id}>
                    <div className="flex justify-between text-sm"><span className="truncate"><span className="mr-2 text-ink-300">{i + 1}</span>{p.name}</span><span className="tabular-nums font-medium">{money(p.amount)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-ink-50"><div className="h-1.5 rounded-full bg-gradient-to-r from-gold-500 to-gold-300" style={{ width: `${(Number(p.amount) / max) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between px-5 py-4"><h3 className="font-semibold text-ink-900">Recent invoices</h3><Link to="/sales/INVOICE" className="text-xs font-medium text-gold-600">View all</Link></div>
          <table className="table">
            <thead><tr><th>No.</th><th>Date</th><th>Customer</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {recent.map((r: Row) => (
                <tr key={r.id}>
                  <td><Link to={`/sales/doc/${r.id}`} className="font-medium hover:text-gold-600">{r.doc_no}</Link></td>
                  <td>{dateFmt(r.doc_date)}</td>
                  <td>{r.customer?.name ?? 'Walk-in'}</td>
                  <td className="num">{money(r.total)}</td>
                  <td><StatusBadge status={r.status} outstanding={r.total - r.paid - r.credited} total={r.total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-900"><Package size={16} className="text-rose-500" /> Low stock</h3>
            {!d.low_stock.length ? <p className="text-sm text-ink-400">All products above minimum 👌</p> : (
              <div className="space-y-2 text-sm">
                {d.low_stock.map((p: Row) => (
                  <div key={p.id} className="flex justify-between"><span className="truncate">{p.name}</span><span className="tabular-nums font-medium text-rose-600">{qtyFmt(p.qty)} / {qtyFmt(p.min_stock)}</span></div>
                ))}
              </div>
            )}
          </div>
          <div className="card p-5">
            <h3 className="mb-3 font-semibold text-ink-900">Top salesmen this month</h3>
            {!d.top_salesmen.length ? <p className="text-sm text-ink-400">No sales yet</p> : (
              <div className="space-y-2 text-sm">
                {d.top_salesmen.map((s: Row) => (
                  <div key={s.name} className="flex justify-between"><span>{s.name} <span className="text-ink-400">({s.count})</span></span><span className="tabular-nums font-medium">{money(s.amount)}</span></div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
