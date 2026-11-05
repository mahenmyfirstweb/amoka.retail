import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabaseConfigured } from '../lib/supabase';
import { ErrorBox } from '../components/ui';

export default function Login() {
  const { session, profile, profileError, loading, signIn, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && session && profile?.is_active) return <Navigate to="/" replace />;
  const inactive = !loading && session && profile && !profile.is_active;
  const [noProfile, setNoProfile] = useState(false);
  // Signed in but no profile row (login created before the database scripts were run).
  useEffect(() => {
    if (loading || !session || profile) return setNoProfile(false);
    const t = setTimeout(() => setNoProfile(true), 1500);
    return () => clearTimeout(t);
  }, [loading, session, profile]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.2fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink-950 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(212,171,90,0.25),transparent_55%),radial-gradient(circle_at_80%_90%,rgba(212,171,90,0.12),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-between p-14 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-600 font-display text-xl font-bold text-ink-950">
              a
            </div>
            <span className="font-display text-2xl tracking-wide">amoka.retail</span>
          </div>
          <div>
            <h1 className="max-w-md font-display text-5xl leading-tight">
              Retail, run <span className="text-gold-300">beautifully</span>.
            </h1>
            <p className="mt-5 max-w-md text-ink-300">
              Point of sale, inventory, purchasing, sales and accounts — one elegant platform for every outlet and every
              salesman on the road.
            </p>
          </div>
          <div className="text-xs text-ink-400">© {new Date().getFullYear()} AMOKA TRADING PTE LTD</div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-white p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <div className="mb-8 font-display text-2xl lg:hidden">amoka.retail</div>
            <h2 className="font-display text-3xl text-ink-900">Welcome back</h2>
            <p className="mt-1 text-sm text-ink-400">Sign in to the back-office portal</p>
          </div>
          {!supabaseConfigured && (
            <ErrorBox error="Supabase is not configured. Create apps/web/.env from .env.example with your project URL and anon key, then restart." />
          )}
          {noProfile && (
            <div className="space-y-2">
              <ErrorBox error={profileError ? `Password OK, but the database refused to load your profile: ${profileError}. Run supabase/migrations/20261107000008_grants.sql in the Supabase SQL Editor, then sign out and sign in again.` : 'Password OK, but this login has no staff profile. Run supabase/migrations/20261107000007_own_profile_and_owner_admin.sql in the Supabase SQL Editor, then sign out and sign in again.'} />
              <button type="button" className="btn-secondary w-full" onClick={signOut}>Sign out</button>
            </div>
          )}
          {inactive && (
            <div className="space-y-2">
              <ErrorBox error="Your account is waiting for an administrator to activate it." />
              <button type="button" className="btn-secondary w-full" onClick={signOut}>
                Use another account
              </button>
            </div>
          )}
          <ErrorBox error={error} />
          <label className="block">
            <span className="label">Email</span>
            <input className="input py-2.5" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input className="input py-2.5" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />} Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
