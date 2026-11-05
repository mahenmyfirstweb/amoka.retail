import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, errorMessage } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

type Builder = ReturnType<ReturnType<typeof supabase.from>['select']>;

/** Generic table read with React Query. `build` can add filters / order / range. */
export function useTable<T = Row>(
  table: string | null,
  opts: { select?: string; build?: (q: Builder) => Builder; key?: unknown[]; enabled?: boolean } = {},
) {
  return useQuery<{ items: T[]; count: number }>({
    queryKey: ['table', table, opts.select, ...(opts.key ?? [])],
    enabled: !!table && opts.enabled !== false,
    queryFn: async () => {
      let q = supabase.from(table!).select(opts.select ?? '*', { count: 'exact' }) as Builder;
      if (opts.build) q = opts.build(q);
      const { data, error, count } = await q;
      if (error) throw new Error(errorMessage(error));
      return { items: (data ?? []) as T[], count: count ?? 0 };
    },
  });
}

export function useRecord<T = Row>(table: string, id: number | string | undefined | null, select = '*') {
  return useQuery<T | null>({
    queryKey: ['record', table, id, select],
    enabled: id !== undefined && id !== null && id !== '',
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select(select).eq('id', id!).maybeSingle();
      if (error) throw new Error(errorMessage(error));
      return data as T | null;
    },
  });
}

/** Insert or update a row (id present = update). */
export function useSave(table: string) {
  const qc = useQueryClient();
  return useMutation<Row, Error, Row>({
    mutationFn: async (row) => {
      const { id, ...rest } = row;
      const q = id
        ? supabase.from(table).update(rest).eq('id', id).select().single()
        : supabase.from(table).insert(rest).select().single();
      const { data, error } = await q;
      if (error) throw new Error(errorMessage(error));
      return data as Row;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Commonly used lookups, cached for the session. */
export function useLookup(table: string, select = 'id, code, name', activeOnly = true) {
  return useQuery<Row[]>({
    queryKey: ['lookup', table, select, activeOnly],
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from(table).select(select);
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q.order('name').limit(5000);
      if (error) throw new Error(errorMessage(error));
      return (data ?? []) as Row[];
    },
  });
}

export function useSettings() {
  return useQuery<Row>({
    queryKey: ['settings'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
      if (error) throw new Error(errorMessage(error));
      return data as Row;
    },
  });
}

export function usePaymodes() {
  return useQuery<Row[]>({
    queryKey: ['paymodes'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('paymodes').select('*').eq('is_active', true).order('sort_order');
      if (error) throw new Error(errorMessage(error));
      return (data ?? []) as Row[];
    },
  });
}

export function useBanks() {
  return useLookup('banks', 'id, code, name');
}

/** Escapes a search term for PostgREST .or() ilike filters. */
export const like = (s: string) => `%${s.replace(/[%,()]/g, ' ').trim()}%`;
