import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
  BarChart3,
  Boxes,
  ChevronDown,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Package,
  Receipt,
  Repeat,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useLookup } from '../lib/data';

interface Item {
  to: string;
  label: string;
  need?: string;
}
interface Group {
  label: string;
  icon: ReactNode;
  items: Item[];
  need?: string;
}

export const MENU: Group[] = [
  {
    label: 'Master',
    icon: <Database size={17} />,
    items: [
      { to: '/settings', label: 'Company', need: 'settings' },
      { to: '/m/locations', label: 'Location' },
      { to: '/m/customers', label: 'Customer' },
      { to: '/m/customer_groups', label: 'Customer Group' },
      { to: '/m/suppliers', label: 'Supplier', need: 'suppliers' },
      { to: '/m/terms', label: 'Terms' },
      { to: '/m/currencies', label: 'Currency' },
      { to: '/m/banks', label: 'Bank' },
      { to: '/m/paymodes', label: 'Paymode' },
      { to: '/m/taxes', label: 'Tax' },
      { to: '/m/areas', label: 'Area' },
      { to: '/m/bins', label: 'Bin' },
    ],
  },
  {
    label: 'Products',
    icon: <Package size={17} />,
    items: [
      { to: '/m/categories', label: 'Category & Sub Category' },
      { to: '/m/uoms', label: 'UOM' },
      { to: '/m/brands', label: 'Brand' },
      { to: '/products', label: 'Products' },
      { to: '/products/stock', label: 'Product Stock' },
      { to: '/products/price-changes', label: 'Price Change' },
      { to: '/prices/customer', label: 'Customer Price', need: 'prices' },
      { to: '/prices/supplier', label: 'Supplier Price', need: 'prices' },
    ],
  },
  {
    label: 'Purchase',
    icon: <Truck size={17} />,
    need: 'purchase',
    items: [
      { to: '/purchase/QUOTE', label: 'Purchase Quote' },
      { to: '/purchase/ORDER', label: 'Purchase Order' },
      { to: '/purchase/GRN', label: 'Goods Receive' },
      { to: '/purchase/RETURN', label: 'Purchase Return / CN' },
      { to: '/payments', label: 'Payments' },
      { to: '/reports/payable', label: 'Account Payable' },
    ],
  },
  {
    label: 'Sales',
    icon: <ShoppingCart size={17} />,
    items: [
      { to: '/sales/QUOTE', label: 'Sales Quote' },
      { to: '/sales/ORDER', label: 'Sales Order' },
      { to: '/sales/INVOICE', label: 'Sales Invoice' },
      { to: '/sales/DELIVERY', label: 'Delivery Order' },
      { to: '/sales/RETURN', label: 'Sales Return' },
      { to: '/receipts', label: 'Receipts' },
      { to: '/reports/receivable', label: 'Account Receivable' },
      { to: '/statement', label: 'Customer Statement' },
    ],
  },
  {
    label: 'Transfers',
    icon: <Repeat size={17} />,
    items: [
      { to: '/stock/requests', label: 'Stock Request' },
      { to: '/stock/transfers', label: 'Product Transfer', need: 'stock' },
    ],
  },
  {
    label: 'Stock Update',
    icon: <Boxes size={17} />,
    need: 'stock',
    items: [
      { to: '/stock/ADJUST', label: 'Stock Adjustment' },
      { to: '/stock/STOCKTAKE', label: 'Stock Take' },
      { to: '/stock/movements', label: 'Stock Movements' },
    ],
  },
  {
    label: 'Accounts',
    icon: <Wallet size={17} />,
    need: 'vouchers',
    items: [
      { to: '/m/accounts', label: 'Chart of Accounts' },
      { to: '/vouchers/PAYMENT', label: 'Payment Voucher' },
      { to: '/vouchers/RECEIPT', label: 'Receipt Voucher' },
      { to: '/vouchers/EXPENSE', label: 'Expense Voucher' },
    ],
  },
  {
    label: 'Security',
    icon: <ShieldCheck size={17} />,
    need: 'users',
    items: [
      { to: '/users', label: 'User Master' },
      { to: '/roles', label: 'User Roles & Permissions' },
    ],
  },
  {
    label: 'Utility',
    icon: <Wrench size={17} />,
    items: [
      { to: '/import', label: 'Data Import', need: 'masters' },
      { to: '/opening-balances', label: 'Opening Balance', need: 'opening_balance' },
      { to: '/deleted', label: 'Deleted Invoices', need: 'void_docs' },
      { to: '/pos/sessions', label: 'POS Settlements', need: 'pos' },
    ],
  },
  {
    label: 'Reports',
    icon: <BarChart3 size={17} />,
    need: 'reports',
    items: [
      { to: '/reports/sales', label: 'Sales Report' },
      { to: '/reports/profit', label: 'Profit Analysis' },
      { to: '/reports/receivable', label: 'Receivable Aging' },
      { to: '/reports/payable', label: 'Payable Aging' },
    ],
  },
];

function NavGroup({ g, onNavigate }: { g: Group; onNavigate: () => void }) {
  const { can } = useAuth();
  const loc = useLocation();
  const items = g.items.filter((i) => !i.need || can(i.need));
  const active = items.some((i) => loc.pathname.startsWith(i.to));
  const [open, setOpen] = useState(active);
  if (!items.length) return null;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
          active ? 'text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white'
        }`}
      >
        <span className={active ? 'text-gold-300' : ''}>{g.icon}</span>
        <span className="flex-1 text-left">{g.label}</span>
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mb-1 ml-[22px] border-l border-white/10 pl-3">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `block rounded-md px-2.5 py-1.5 text-[13px] transition ${
                  isActive ? 'bg-gold-400/15 font-medium text-gold-200' : 'text-ink-300 hover:text-white'
                }`
              }
            >
              {i.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { profile, can, signOut, locationId, setLocationId } = useAuth();
  const { data: locations } = useLookup('locations');
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-ink-950 text-white">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 font-display text-lg font-bold text-ink-950">
          a
        </div>
        <div>
          <div className="font-display text-lg leading-none tracking-wide">amoka.retail</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-gold-300/80">ERP · POS</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        <NavLink
          to="/"
          end
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white'
            }`
          }
        >
          <LayoutDashboard size={17} /> Dashboard
        </NavLink>
        {can('pos') && (
          <NavLink
            to="/pos"
            className="my-1 flex items-center gap-3 rounded-lg bg-gradient-to-r from-gold-400 to-gold-300 px-3 py-2 text-sm font-semibold text-ink-950 shadow"
          >
            <MonitorSmartphone size={17} /> Web POS
          </NavLink>
        )}
        {MENU.filter((g) => !g.need || can(g.need)).map((g) => (
          <NavGroup key={g.label} g={g} onNavigate={() => setMobileOpen(false)} />
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-gold-200">
            {(profile?.full_name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{profile?.full_name}</div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400">{profile?.role}</div>
          </div>
          <NavLink to="/account" className="rounded-lg p-1.5 text-ink-400 hover:bg-white/10 hover:text-white" title="My account">
            <Settings2 size={16} />
          </NavLink>
          <button onClick={signOut} className="rounded-lg p-1.5 text-ink-400 hover:bg-white/10 hover:text-white" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="no-print hidden lg:block">{sidebar}</div>
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 flex lg:hidden">
          {sidebar}
          <button className="flex-1 bg-ink-950/50" onClick={() => setMobileOpen(false)} aria-label="Close menu" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-ink-100 bg-white/80 px-4 backdrop-blur lg:px-8">
          <button className="btn-ghost p-1.5 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex-1" />
          <Receipt size={15} className="text-ink-300" />
          <select
            className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm"
            value={locationId ?? ''}
            onChange={(e) => setLocationId(Number(e.target.value))}
            title="Working location"
          >
            {!locationId && <option value="">Select location</option>}
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
