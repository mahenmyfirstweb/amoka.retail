/** Live map: last known position of each salesman (sent by the salesman app while it is open) + day route. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink, MapPin, RefreshCw } from 'lucide-react';
import { supabase, rpc } from '../lib/supabase';
import type { Row } from '../lib/data';
import { dateTimeFmt, isoDate } from '../lib/format';
import { Empty, Field, Loading, PageHeader } from '../components/ui';

const ago = (t: string) => {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} day(s) ago`;
};
const fresh = (t: string) => Date.now() - new Date(t).getTime() < 15 * 60000;
const gmaps = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

function pin(color: string, label: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%)">
      <div style="background:${color};color:#fff;font:600 11px Inter,sans-serif;padding:3px 8px;border-radius:999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">${label}</div>
      <div style="width:2px;height:10px;background:${color}"></div><div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff"></div></div>`,
  });
}

export default function LiveMap() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [day, setDay] = useState(isoDate());

  const { data: people = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['latest-locations'],
    queryFn: () => rpc<Row[]>('latest_locations'),
    refetchInterval: 60_000,
  });
  const { data: route = [] } = useQuery({
    queryKey: ['route', selected, day],
    enabled: !!selected,
    queryFn: async () => {
      const { data } = await supabase.from('device_locations').select('lat, lng, recorded_at, event, speed')
        .eq('user_id', selected!).gte('recorded_at', `${day}T00:00:00+08:00`).lte('recorded_at', `${day}T23:59:59+08:00`).order('recorded_at');
      return (data ?? []) as Row[];
    },
  });

  // Create the map once.
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    map.current = L.map(mapEl.current, { zoomControl: true }).setView([1.3521, 103.8198], 11); // Singapore
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Draw markers / route.
  useEffect(() => {
    const lg = layer.current;
    if (!lg || !map.current) return;
    lg.clearLayers();
    const pts: L.LatLngExpression[] = [];
    if (selected && route.length) {
      const line = route.map((r) => [r.lat, r.lng] as [number, number]);
      L.polyline(line, { color: '#d98b22', weight: 4, opacity: 0.85 }).addTo(lg);
      route.forEach((r, i) => {
        if (r.event && r.event !== 'PING') {
          L.circleMarker([r.lat, r.lng], { radius: 6, color: '#211611', fillColor: '#f3c15e', fillOpacity: 1 })
            .bindPopup(`<b>${r.event}</b><br>${dateTimeFmt(r.recorded_at)}`).addTo(lg);
        } else if (i === 0) {
          L.circleMarker([r.lat, r.lng], { radius: 5, color: '#059669', fillOpacity: 1 }).bindPopup(`Start ${dateTimeFmt(r.recorded_at)}`).addTo(lg);
        }
      });
      pts.push(...line);
    }
    for (const p of people) {
      if (selected && p.user_id !== selected) continue;
      const m = L.marker([p.lat, p.lng], { icon: pin(fresh(p.recorded_at) ? '#211611' : '#9ca3af', `${p.full_name}${p.vehicle ? ` · ${p.vehicle}` : ''}`) })
        .bindPopup(`<b>${p.full_name}</b>${p.vehicle ? ` · ${p.vehicle}` : ''}<br>${dateTimeFmt(p.recorded_at)} (${ago(p.recorded_at)})<br>${p.speed ? `${Math.round(p.speed * 3.6)} km/h<br>` : ''}<a href="${gmaps(p.lat, p.lng)}" target="_blank">Open in Google Maps</a>`);
      m.addTo(lg);
      pts.push([p.lat, p.lng]);
    }
    if (pts.length) map.current.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
  }, [people, route, selected]);

  const sorted = useMemo(() => [...people].sort((a, b) => +new Date(b.recorded_at) - +new Date(a.recorded_at)), [people]);

  return (
    <div>
      <PageHeader title="Live Map" subtitle="Salesman positions from the salesman app (updated every 2 minutes while the app is open)"
        actions={<button className="btn-secondary" onClick={() => refetch()}><RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} /> Refresh</button>} />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="card overflow-hidden">
          <div className="space-y-2 border-b border-ink-100 p-3">
            <Field label="Route for day"><input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            {selected && <button className="btn-ghost btn-sm" onClick={() => setSelected(null)}>← Show everyone</button>}
          </div>
          {isLoading ? <Loading /> : !sorted.length ? <Empty>No locations yet. Positions appear once salesmen open the app and allow location.</Empty> : (
            <div className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto">
              {sorted.map((p) => (
                <div key={p.user_id} className={`flex items-start gap-3 px-4 py-3 ${selected === p.user_id ? 'bg-gold-50' : ''}`}>
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${fresh(p.recorded_at) ? 'bg-emerald-500' : 'bg-ink-300'}`} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(p.user_id)}>
                    <div className="truncate font-semibold text-ink-900">{p.full_name}</div>
                    <div className="text-xs text-ink-400">{p.vehicle ? `${p.vehicle} · ` : ''}{ago(p.recorded_at)}{p.speed ? ` · ${Math.round(p.speed * 3.6)} km/h` : ''}</div>
                    <div className="text-xs text-ink-400">Last: {String(p.event ?? 'PING').toLowerCase()}</div>
                  </button>
                  <a className="btn-ghost btn-sm" href={gmaps(p.lat, p.lng)} target="_blank" rel="noreferrer" title="Open in Google Maps"><ExternalLink size={14} /></a>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-ink-100 px-4 py-2 text-xs text-ink-400"><MapPin size={13} /> Green = updated in the last 15 minutes</div>
        </div>
        <div className="card overflow-hidden">
          <div ref={mapEl} className="h-[70vh] w-full" />
        </div>
      </div>
    </div>
  );
}
