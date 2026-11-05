import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AlertCircle, CheckCircle2, ChevronLeft, ClipboardList, Home, LayoutGrid, Menu, ShoppingCart, Store as StoreIcon, WifiOff, X } from 'lucide-react';
import { useStore, type Row } from './lib/store';
import { money } from './lib/format';

// ---------- toast ----------
const ToastCtx = createContext<(kind: 'ok' | 'err', text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ id: number; kind: 'ok' | 'err'; text: string }[]>([]);
  const push = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = Date.now() + Math.random();
    setT((x) => [...x, { id, kind, text }]);
    setTimeout(() => setT((x) => x.filter((y) => y.id !== id)), kind === 'err' ? 5000 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4 safe-top">
        {t.map((x) => (
          <div key={x.id} className={`flex max-w-md items-start gap-2 rounded-2xl px-4 py-3 text-sm font-medium shadow-xl ${x.kind === 'ok' ? 'bg-ink-900 text-white' : 'bg-rose-600 text-white'}`}>
            {x.kind === 'ok' ? <CheckCircle2 size={18} className="text-gold-300" /> : <AlertCircle size={18} />}
            {x.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function TopBar({ title, back, right }: { title: ReactNode; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-30 bg-ink-950 text-white safe-top">
      <div className="flex h-14 items-center gap-2 px-3">
        {back && (
          <button className="-ml-1 rounded-full p-2 active:bg-white/10" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="min-w-0 flex-1 truncate font-display text-lg tracking-wide">{title}</div>
        {right}
      </div>
    </header>
  );
}

/** Shows the selected customer; tap to change. */
export function CustomerBar() {
  const { customer } = useStore();
  const nav = useNavigate();
  return (
    <button onClick={() => nav('/customers')} className="flex w-full items-center gap-3 border-b border-ink-100 bg-white px-4 py-2.5 text-left active:bg-ink-50">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${customer ? 'bg-gold-100 text-gold-700' : 'bg-ink-100 text-ink-400'}`}>
        <StoreIcon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        {customer ? (
          <>
            <div className="truncate text-sm font-semibold text-ink-900">{customer.name}</div>
            <div className="truncate text-xs text-ink-400">{[customer.area?.name, customer.group?.name, customer.phone].filter(Boolean).join(' · ')}</div>
          </>
        ) : (
          <div className="text-sm font-medium text-ink-500">Select a retail shop to start an order</div>
        )}
      </div>
      <span className="text-xs font-semibold text-gold-600">{customer ? 'Change' : 'Select'}</span>
    </button>
  );
}

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white sm:max-w-lg sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <div className="text-base font-semibold text-ink-900">{title}</div>
          <button className="rounded-full p-1.5 text-ink-400 active:bg-ink-100" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-ink-100 p-4 safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, step = 1, size = 'md' }: { value: number; onChange: (v: number) => void; step?: number; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  return (
    <div className="flex items-center rounded-full bg-ink-900 text-white shadow-sm">
      <button className={`${s} flex items-center justify-center rounded-full text-lg active:bg-white/10`} onClick={(e) => { e.stopPropagation(); onChange(Math.max(0, value - step)); }}>−</button>
      <input
        inputMode="decimal"
        className="w-10 bg-transparent text-center text-sm font-semibold outline-none"
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
      />
      <button className={`${s} flex items-center justify-center rounded-full text-lg active:bg-white/10`} onClick={(e) => { e.stopPropagation(); onChange(value + step); }}>+</button>
    </div>
  );
}

export function ProductImage({ p, className = '' }: { p: Row; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = p.image_url ?? p.images?.[0]?.url;
  if (src && !broken) return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-ink-50 via-white to-gold-50 ${className}`}>
      <span className="font-display text-4xl text-gold-400/70">{String(p.name ?? '?').slice(0, 1)}</span>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      {icon && <div className="mb-3 text-ink-200">{icon}</div>}
      <div className="font-semibold text-ink-700">{title}</div>
      {children && <div className="mt-1 text-sm text-ink-400">{children}</div>}
    </div>
  );
}

const TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/catalog', label: 'Catalog', icon: LayoutGrid },
  { to: '/cart', label: 'Cart', icon: ShoppingCart },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/more', label: 'More', icon: Menu },
];

export function AppShell() {
  const { cart, online, pending } = useStore();
  const loc = useLocation();
  const count = cart.length;
  const total = cart.reduce((s, l) => s + l.qty * l.price - l.discount, 0);
  const showCartBar = count > 0 && loc.pathname.startsWith('/catalog');
  return (
    <div className="flex h-full flex-col">
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-500 px-3 py-1 text-xs font-semibold text-ink-950 safe-top">
          <WifiOff size={13} /> Offline — orders are saved on this device and sent automatically{pending.length ? ` (${pending.length} waiting)` : ''}
        </div>
      )}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {showCartBar && (
        <NavLink to="/cart" className="mx-3 mb-2 flex items-center justify-between rounded-2xl bg-gradient-to-r from-ink-900 to-ink-800 px-5 py-3.5 text-white shadow-xl">
          <span className="text-sm"><b>{count}</b> item{count === 1 ? '' : 's'}</span>
          <span className="font-semibold">View cart · {money(total)}</span>
        </NavLink>
      )}
      <nav className="grid grid-cols-5 border-t border-ink-100 bg-white safe-bottom">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-ink-900' : 'text-ink-400'}`}>
            {({ isActive }) => (
              <>
                <t.icon size={22} strokeWidth={isActive ? 2.4 : 1.8} className={isActive ? 'text-gold-600' : ''} />
                {t.label}
                {t.to === '/cart' && count > 0 && <span className="absolute right-[22%] top-1 min-w-[18px] rounded-full bg-gold-500 px-1 text-center text-[10px] font-bold text-white">{count}</span>}
                {t.to === '/orders' && pending.length > 0 && <span className="absolute right-[22%] top-1 h-2.5 w-2.5 rounded-full bg-amber-500" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
