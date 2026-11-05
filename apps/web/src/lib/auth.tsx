import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Role = 'ADMIN' | 'ACCOUNTS' | 'MANAGER' | 'CASHIER' | 'SALESMAN' | 'STOREKEEPER';

export interface Profile {
  id: string;
  username: string | null;
  full_name: string;
  role: Role;
  location_id: number | null;
  is_active: boolean;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Database error while loading the profile (e.g. missing grants). */
  profileError: string | null;
  permissions: Set<string>;
  /** Working location for new documents (defaults to the user's location). */
  locationId: number | null;
  setLocationId: (id: number) => void;
  can: (area: string) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const LOC_KEY = 'amoka.location';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [profileError, setProfileError] = useState<string | null>(null);
  const [locationId, setLoc] = useState<number | null>(() => Number(localStorage.getItem(LOC_KEY)) || null);

  async function loadProfile(s: Session | null) {
    if (!s) {
      setProfile(null);
      setPermissions(new Set());
      return;
    }
    const [{ data: p, error: pErr }, { data: perms, error: permErr }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('my_permissions'),
    ]);
    const err = pErr ?? permErr;
    setProfileError(err ? `${err.message}${err.code ? ` (${err.code})` : ''}` : null);
    setProfile((p as Profile) ?? null);
    setPermissions(new Set((perms as string[]) ?? []));
    if (p && !localStorage.getItem(LOC_KEY) && p.location_id) setLoc(p.location_id);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: Supabase recommends not awaiting other calls inside this callback.
        setTimeout(() => loadProfile(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    loading,
    session,
    profile,
    profileError,
    permissions,
    locationId: locationId ?? profile?.location_id ?? null,
    setLocationId: (id) => {
      localStorage.setItem(LOC_KEY, String(id));
      setLoc(id);
    },
    can: (area) => permissions.has(area),
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
    reload: () => loadProfile(session),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
