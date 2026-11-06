import { createClient } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Shown in the browser console and on the login page.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy apps/web/.env.example to apps/web/.env');
}

export const supabaseConfigured =
  !!url && !!anonKey && !url.includes('YOUR-PROJECT') && anonKey !== 'your-anon-key';
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing');

/** Turns Postgres / PostgREST errors into a readable message. */
export function errorMessage(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  const err = e as { message?: string; details?: string; code?: string };
  if (err.code === '23505') return 'This code / number already exists';
  if (err.code === '23503') return 'This record is linked to other data and cannot be changed this way';
  if (err.code === '42501') return err.message ?? 'You do not have permission for this action';
  if (err.message?.startsWith('CREDIT_BLOCK')) return err.message.replace(/^CREDIT_BLOCK:\s*/, '⚠ Credit control: ');
  return err.message ?? 'Unexpected error';
}

/** Calls a database function and throws a readable error on failure. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errorMessage(error));
  return data as T;
}

/** React Query wrapper for RPC reads. */
export function useRpc<T = unknown>(fn: string | null, args?: Record<string, unknown>) {
  return useQuery<T>({
    queryKey: ['rpc', fn, args],
    queryFn: () => rpc<T>(fn!, args),
    enabled: !!fn,
  });
}

/** Mutation that calls an RPC and refreshes all cached data on success. */
export function useRpcMutation<TArgs extends Record<string, unknown>, TRes = unknown>(fn: string) {
  const qc = useQueryClient();
  return useMutation<TRes, Error, TArgs>({
    mutationFn: (args) => rpc<TRes>(fn, args),
    onSuccess: () => qc.invalidateQueries(),
  });
}
