import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { like, type Row } from '../lib/data';
import { money, qtyFmt } from '../lib/format';

function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/**
 * Product search box. Type to search by code / name, or scan a barcode and press Enter
 * (an exact barcode/code match is added immediately).
 */
export function ProductPicker({
  onPick,
  locationId,
  placeholder = 'Scan barcode or search product…',
  autoFocus,
}: {
  onPick: (p: Row) => void;
  locationId?: number | null;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const q = useDebounced(term.trim());

  const { data: results = [] } = useQuery({
    queryKey: ['product-search', q, locationId],
    enabled: q.length >= 1,
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('id, code, barcode, name, sell_price, wholesale_price, cost_price, taxable, pcs_per_carton, uom:uoms(code), stocks(qty, location_id)')
        .eq('is_active', true)
        .or(`code.ilike.${like(q)},name.ilike.${like(q)},barcode.eq.${q.replace(/[,()]/g, '')}`)
        .order('name')
        .limit(20);
      return ((data ?? []) as Row[]).map((p: Row): Row => ({
        ...p,
        stock_qty: (p.stocks ?? []).filter((s: Row) => !locationId || s.location_id === locationId).reduce((a: number, s: Row) => a + Number(s.qty), 0),
      }));
    },
  });

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function pick(p: Row) {
    onPick(p);
    setTerm('');
    setOpen(false);
    setHi(0);
  }

  async function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = term.trim();
      if (!t) return;
      // Exact barcode / code lookup first (scanner input).
      const { data } = await supabase
        .from('products')
        .select('id, code, barcode, name, sell_price, wholesale_price, cost_price, taxable, pcs_per_carton, uom:uoms(code)')
        .eq('is_active', true)
        .or(`barcode.eq.${t.replace(/[,()]/g, '')},code.eq.${t.toUpperCase().replace(/[,()]/g, '')}`)
        .limit(1);
      if (data?.[0]) return pick(data[0]);
      if (results[hi]) pick(results[hi]);
    }
  }

  return (
    <div ref={ref} className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
      <input
        className="input pl-9"
        value={term}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && q && results.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-ink-100 bg-white py-1 shadow-xl">
          {results.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setHi(i)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === hi ? 'bg-gold-50' : ''}`}
            >
              <span className="min-w-0">
                <span className="font-medium text-ink-900">{p.name}</span>
                <span className="block text-xs text-ink-400">{p.code}{p.barcode ? ` · ${p.barcode}` : ''}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-medium tabular-nums">{money(p.sell_price)}</span>
                <span className={`block text-xs ${p.stock_qty <= 0 ? 'text-rose-500' : 'text-ink-400'}`}>Stock {qtyFmt(p.stock_qty)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Searchable customer / supplier selector. */
export function PartyPicker({
  table,
  value,
  onChange,
  disabled,
  placeholder,
  allowClear = true,
}: {
  table: 'customers' | 'suppliers';
  value: Row | null;
  onChange: (p: Row | null) => void;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useDebounced(term.trim());
  const { data: results = [] } = useQuery({
    queryKey: ['party-search', table, q],
    enabled: open,
    queryFn: async () => {
      let query = supabase.from(table).select('*').eq('is_active', true);
      if (q) query = query.or(`code.ilike.${like(q)},name.ilike.${like(q)},phone.ilike.${like(q)}`);
      const { data } = await query.order('name').limit(25);
      return (data ?? []) as Row[];
    },
  });
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (value && !open) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="input flex-1 text-left">
          <span className="font-medium text-ink-900">{value.name}</span>
          <span className="ml-2 text-xs text-ink-400">{value.code}</span>
        </button>
        {allowClear && !disabled && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(null)}>Clear</button>
        )}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative">
      <input
        className="input"
        autoFocus={open}
        disabled={disabled}
        placeholder={placeholder ?? `Search ${table === 'customers' ? 'customer' : 'supplier'}…`}
        value={term}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-ink-100 bg-white py-1 shadow-xl">
          {results.length === 0 && <div className="px-3 py-2 text-sm text-ink-400">No matches</div>}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(p); setOpen(false); setTerm(''); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-gold-50"
            >
              <span className="font-medium text-ink-900">{p.name}</span>
              <span className="ml-2 text-xs text-ink-400">{p.code}{p.phone ? ` · ${p.phone}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
