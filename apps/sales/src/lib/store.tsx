/**
 * App state for the salesman app:
 *  - auth / profile / permissions
 *  - master data (products, categories, customers, paymodes, settings) cached in localStorage for offline use
 *  - the current customer + cart
 *  - an offline queue of orders that are synced automatically when the device is back online
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, rpc } from './supabase';
import { round2 } from './format';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface CartLine {
  product_id: number;
  code: string;
  name: string;
  image_url?: string | null;
  uom?: string;
  qty: number;
  price: number;
  list_price: number;
  discount: number;
  taxable: boolean;
}

export interface PendingOrder {
  client_ref: string;
  created_at: string;
  customer: Row;
  payload: Row; // body for create_sales_document
  error?: string;
}

interface Store {
  ready: boolean;
  session: Session | null;
  profile: Row | null;
  permissions: Set<string>;
  online: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;

  settings: Row | null;
  products: Row[];
  categories: Row[];
  customers: Row[];
  paymodes: Row[];
  lastSync: string | null;
  syncing: boolean;
  refreshData: (force?: boolean) => Promise<void>;
  refreshStock: () => Promise<void>;

  customer: Row | null;
  setCustomer: (c: Row | null) => Promise<void>;
  priceFor: (p: Row) => number;

  cart: CartLine[];
  addToCart: (p: Row, qty?: number) => void;
  setQty: (productId: number, qty: number) => void;
  updateLine: (productId: number, patch: Partial<CartLine>) => void;
  clearCart: () => void;
  cartQty: (productId: number) => number;

  pending: PendingOrder[];
  queueOrder: (o: PendingOrder) => void;
  syncPending: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
const LS = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`amoka.sales.${k}`);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    localStorage.setItem(`amoka.sales.${k}`, JSON.stringify(v));
  },
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Row | null>(LS.get('profile', null));
  const [permissions, setPermissions] = useState<Set<string>>(new Set(LS.get<string[]>('perms', [])));
  const [online, setOnline] = useState(navigator.onLine);

  const [settings, setSettings] = useState<Row | null>(LS.get('settings', null));
  const [products, setProducts] = useState<Row[]>(LS.get('products', []));
  const [categories, setCategories] = useState<Row[]>(LS.get('categories', []));
  const [customers, setCustomers] = useState<Row[]>(LS.get('customers', []));
  const [paymodes, setPaymodes] = useState<Row[]>(LS.get('paymodes', []));
  const [lastSync, setLastSync] = useState<string | null>(LS.get('lastSync', null));
  const [syncing, setSyncing] = useState(false);

  const [customer, setCustomerState] = useState<Row | null>(LS.get('customer', null));
  const [special, setSpecial] = useState<Record<number, number>>(LS.get('special', {}));
  const [cart, setCart] = useState<CartLine[]>(LS.get('cart', []));
  const [pending, setPending] = useState<PendingOrder[]>(LS.get('pending', []));

  useEffect(() => LS.set('cart', cart), [cart]);
  useEffect(() => LS.set('pending', pending), [pending]);

  // ---------- auth ----------
  async function loadProfile(s: Session | null) {
    if (!s) return;
    const [{ data: p }, { data: perms }] = await Promise.all([
      supabase.from('profiles').select('*, location:locations(id, name)').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('my_permissions'),
    ]);
    if (p) {
      setProfile(p);
      LS.set('profile', p);
    }
    if (perms) {
      setPermissions(new Set(perms as string[]));
      LS.set('perms', perms);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      const cached = LS.get<Row | null>('profile', null);
      if (data.session && cached?.id === data.session.user.id) {
        // Returning user: open instantly from the saved profile, refresh it in the background.
        setReady(true);
        if (navigator.onLine) loadProfile(data.session).catch(() => {});
        return;
      }
      if (data.session && navigator.onLine) await loadProfile(data.session).catch(() => {});
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // ---------- master data ----------
  /** Downloads catalog, shops etc. Skipped if the copy on the device is recent, unless `force`. */
  /** Quick refresh of stock quantities only (all locations) — keeps the catalog stock up to date. */
  const refreshStock = useCallback(async () => {
    if (!navigator.onLine) return;
    const { data, error } = await supabase.from('stocks').select('product_id, location_id, qty').limit(100000);
    if (error || !data) return;
    const by = new Map<number, Row[]>();
    for (const s of data) by.set(s.product_id, [...(by.get(s.product_id) ?? []), { location_id: s.location_id, qty: s.qty }]);
    setProducts((ps) => {
      const next = ps.map((p) => ({ ...p, stocks: by.get(p.id) ?? [] }));
      LS.set('products', next);
      return next;
    });
  }, []);

  const refreshData = useCallback(async (force = true) => {
    if (!navigator.onLine) return;
    const last = LS.get<string | null>('lastSync', null);
    const fresh = last && Date.now() - new Date(last).getTime() < 15 * 60 * 1000 && LS.get<Row[]>('products', []).length > 0;
    if (!force && fresh) return;
    setSyncing(true);
    try {
      const [s, prod, cats, cust, pm] = await Promise.all([
        supabase.from('settings').select('*').eq('id', 1).single(),
        supabase
          .from('products')
          .select('id, code, barcode, name, description, sell_price, wholesale_price, taxable, image_url, category_id, pcs_per_carton, uom:uoms(code), brand:brands(name), stocks(qty, location_id), images:product_images(url, sort_order)')
          .eq('is_active', true)
          .order('name')
          .limit(10000),
        supabase.from('categories').select('id, code, name, parent_id').eq('is_active', true).order('name'),
        supabase
          .from('customers')
          .select('id, code, name, contact_person, phone, email, address, delivery_address, terms_days, credit_limit, salesman_id, group_id, latitude, longitude, group:customer_groups(name, discount_pct), area:areas(name)')
          .eq('is_active', true)
          .order('name')
          .limit(10000),
        supabase.from('paymodes').select('*').eq('is_active', true).order('sort_order'),
      ]);
      const err = s.error ?? prod.error ?? cats.error ?? cust.error ?? pm.error;
      if (err) throw err;
      setSettings(s.data); LS.set('settings', s.data);
      setProducts(prod.data ?? []); LS.set('products', prod.data ?? []);
      setCategories(cats.data ?? []); LS.set('categories', cats.data ?? []);
      setCustomers(cust.data ?? []); LS.set('customers', cust.data ?? []);
      setPaymodes(pm.data ?? []); LS.set('paymodes', pm.data ?? []);
      const now = new Date().toISOString();
      setLastSync(now); LS.set('lastSync', now);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    // Background refresh after login / reconnect; the app works from the saved copy meanwhile.
    if (session && online) refreshData(false).catch(() => {});
  }, [session, online, refreshData]);

  // ---------- customer & pricing ----------
  const setCustomer = useCallback(async (c: Row | null) => {
    setCustomerState(c);
    LS.set('customer', c);
    let map: Record<number, number> = {};
    if (c && navigator.onLine) {
      const { data } = await supabase.from('customer_prices').select('product_id, price').eq('customer_id', c.id);
      map = Object.fromEntries((data ?? []).map((r) => [r.product_id, Number(r.price)]));
    }
    setSpecial(map);
    LS.set('special', map);
    // Re-price an existing cart for the new customer.
    setCart((cs) =>
      cs.map((l) => {
        const p = { id: l.product_id, sell_price: l.list_price };
        const price = map[p.id] ?? round2(p.sell_price * (1 - Number(c?.group?.discount_pct ?? 0) / 100));
        return { ...l, price };
      }),
    );
  }, []);

  /** Same rule as the database get_price(): special price, else group discount, else retail price. */
  const priceFor = useCallback(
    (p: Row) => special[p.id] ?? round2(Number(p.sell_price) * (1 - Number(customer?.group?.discount_pct ?? 0) / 100)),
    [special, customer],
  );

  // ---------- cart ----------
  const addToCart = useCallback(
    (p: Row, qty = 1) =>
      setCart((cs) => {
        const i = cs.findIndex((l) => l.product_id === p.id);
        if (i >= 0) return cs.map((l, j) => (j === i ? { ...l, qty: round2(l.qty + qty) } : l));
        return [
          ...cs,
          {
            product_id: p.id,
            code: p.code,
            name: p.name,
            image_url: p.image_url,
            uom: p.uom?.code,
            qty,
            price: priceFor(p),
            list_price: Number(p.sell_price),
            discount: 0,
            taxable: p.taxable,
          },
        ];
      }),
    [priceFor],
  );
  const setQty = useCallback((id: number, qty: number) => {
    setCart((cs) => (qty <= 0 ? cs.filter((l) => l.product_id !== id) : cs.map((l) => (l.product_id === id ? { ...l, qty } : l))));
  }, []);
  const updateLine = useCallback((id: number, patch: Partial<CartLine>) => {
    setCart((cs) => cs.map((l) => (l.product_id === id ? { ...l, ...patch } : l)));
  }, []);
  const clearCart = useCallback(() => setCart([]), []);
  const cartQty = useCallback((id: number) => cart.find((l) => l.product_id === id)?.qty ?? 0, [cart]);

  // ---------- offline queue ----------
  const queueOrder = useCallback((o: PendingOrder) => setPending((p) => [...p, o]), []);
  const syncPending = useCallback(async () => {
    if (!navigator.onLine) return;
    const list: PendingOrder[] = LS.get('pending', []);
    const left: PendingOrder[] = [];
    for (const o of list) {
      try {
        await rpc('create_sales_document', { p: o.payload }); // client_ref makes this safe to retry
      } catch (e) {
        left.push({ ...o, error: (e as Error).message });
      }
    }
    setPending(left);
  }, []);
  useEffect(() => {
    if (session && online && pending.length) syncPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, online]);

  const value = useMemo<Store>(
    () => ({
      ready, session, profile, permissions, online,
      signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message);
        setSession(data.session);
        await loadProfile(data.session); // go to Home as soon as the profile is in
      },
      signOut: async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('amoka.sales.profile');
        localStorage.removeItem('amoka.sales.perms');
        setProfile(null);
        setPermissions(new Set());
      },
      settings, products, categories, customers, paymodes, lastSync, syncing, refreshData, refreshStock,
      customer, setCustomer, priceFor,
      cart, addToCart, setQty, updateLine, clearCart, cartQty,
      pending, queueOrder, syncPending,
    }),
    [ready, session, profile, permissions, online, settings, products, categories, customers, paymodes, lastSync, syncing, refreshData, refreshStock,
      customer, setCustomer, priceFor, cart, addToCart, setQty, updateLine, clearCart, cartQty, pending, queueOrder, syncPending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStore outside provider');
  return c;
}

export const stockAt = (p: Row, locationId?: number | null) =>
  (p.stocks ?? []).filter((s: Row) => !locationId || s.location_id === locationId).reduce((a: number, s: Row) => a + Number(s.qty), 0);

export const newClientRef = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
