import { BrandLogo, GoldRule } from '../components/Brand';
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

  const [noProfile, setNoProfile] = useState(false);
  // Signed in but no profile row (login created before the database scripts were run).
  useEffect(() => {
    if (loading || !session || profile) return setNoProfile(false);
    const t = setTimeout(() => setNoProfile(true), 1500);
    return () => clearTimeout(t);
  }, [loading, session, profile]);

  // All hooks must run before any early return.
  if (!loading && session && profile?.is_active) return <Navigate to="/" replace />;
  const inactive = !loading && session && profile && !profile.is_active;

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
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(234,168,58,0.28),transparent_55%),radial-gradient(circle_at_85%_95%,rgba(122,59,37,0.55),transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:repeating-linear-gradient(45deg,#fff_0,#fff_1px,transparent_1px,transparent_14px)]" />
        <div className="relative flex h-full flex-col justify-between p-14 text-white">
          <div className="text-[11px] font-medium uppercase tracking-[0.4em] text-gold-300/80">amoka.retail · ERP & POS</div>
          <div>
            <BrandLogo className="mb-10 h-40 drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)]" light />
            <h1 className="max-w-lg font-display text-5xl leading-[1.1]">
              Tasty, healthy — and <span className="bg-gradient-to-r from-gold-200 to-gold-400 bg-clip-text text-transparent">beautifully run</span>.
            </h1>
            <GoldRule className="my-6 max-w-sm" />
            <p className="max-w-md text-ink-300">
              Point of sale, inventory, purchasing, sales and accounts — one refined platform for every outlet and every
              salesman on the road.
            </p>
          </div>
          <div className="text-xs text-ink-400">© {new Date().getFullYear()} AMOKA TRADING PTE LTD</div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-ink-50 p-6">
        <form onSubmit={submit} className="card w-full max-w-sm space-y-5 p-8">
          <div>
            <div className="mb-6 flex justify-center lg:hidden"><BrandLogo className="h-20" /></div>
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
