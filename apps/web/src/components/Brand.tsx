import { useState } from 'react';
import { useSettings } from '../lib/data';

/** Company logo: Settings → logo (uploaded) or /logo.png, else an elegant wordmark. */
export function BrandLogo({ className = 'h-12', light = false }: { className?: string; light?: boolean }) {
  const { data: settings } = useSettings();
  const [failed, setFailed] = useState<string[]>([]);
  const candidates = [settings?.logo_url, '/logo.png'].filter((s): s is string => !!s && !failed.includes(s));
  const src = candidates[0];
  if (src) {
    return <img src={src} alt={settings?.company_name ?? 'Amoka'} className={`${className} w-auto object-contain`} onError={() => setFailed((f) => [...f, src])} />;
  }
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="flex aspect-square h-full items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-600 font-display text-xl font-bold text-ink-950 shadow-inner">A</span>
      <span className={`font-display text-2xl tracking-wide ${light ? 'text-white' : 'text-ink-900'}`}>Amoka</span>
    </span>
  );
}

/** Thin gold divider used on luxury headers. */
export function GoldRule({ className = '' }: { className?: string }) {
  return <div className={`h-px bg-gradient-to-r from-transparent via-gold-400/70 to-transparent ${className}`} />;
}
