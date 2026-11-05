import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Loader2, Star, Trash2 } from 'lucide-react';
import { supabase, errorMessage } from '../lib/supabase';
import type { Row } from '../lib/data';
import { useToast } from './ui';

const BUCKET = 'product-images';

/** Resizes to max 1200px and converts to JPEG/WebP to keep the catalog fast on mobile data. */
async function compress(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/webp', 0.85));
}

async function upload(productCode: string, file: File) {
  const blob = await compress(file);
  const path = `${productCode.replace(/[^A-Za-z0-9_-]/g, '_')}/${Date.now()}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw new Error(error.message.includes('Bucket not found') ? 'Run supabase/migrations/…09_product_images_storage.sql first' : error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Main photo + gallery for a product. Main photo is products.image_url; extra photos go to product_images.
 * `onMainChange` updates the form value; it is saved with the product.
 */
export function ProductImages({ product, editable, onMainChange }: { product: Row; editable: boolean; onMainChange: (url: string | null) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data: gallery = [], refetch } = useQuery({
    queryKey: ['product-images', product.id],
    enabled: !!product.id,
    queryFn: async () => (await supabase.from('product_images').select('*').eq('product_id', product.id).order('sort_order')).data ?? [],
  });

  async function onFiles(files: FileList | null, asMain: boolean) {
    if (!files?.length) return;
    if (!product.code) return toast('err', 'Enter the product code first');
    setBusy(true);
    try {
      for (const [i, f] of [...files].entries()) {
        const url = await upload(product.code, f);
        if (asMain && i === 0) onMainChange(url);
        else if (product.id) {
          const { error } = await supabase.from('product_images').insert({ product_id: product.id, url, sort_order: gallery.length + i });
          if (error) throw new Error(errorMessage(error));
        }
      }
      refetch();
      toast('ok', asMain ? 'Photo uploaded — click Save' : 'Photos added');
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 flex flex-wrap items-start gap-3">
      <label className={`relative flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed ${editable ? 'cursor-pointer border-ink-200 hover:border-gold-400' : 'border-transparent'} bg-ink-50`}>
        {product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : (
          <span className="flex flex-col items-center gap-1 text-xs text-ink-400"><ImagePlus size={22} /> Main photo</span>
        )}
        {busy && <span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="animate-spin" /></span>}
        {editable && <input type="file" accept="image/*" className="hidden" onChange={(e) => onFiles(e.target.files, true)} />}
      </label>
      {gallery.map((g: Row) => (
        <div key={g.id} className="group relative h-20 w-20 overflow-hidden rounded-xl bg-ink-50">
          <img src={g.url} alt="" className="h-full w-full object-cover" />
          {editable && (
            <div className="absolute inset-0 hidden items-center justify-center gap-1 bg-ink-950/50 group-hover:flex">
              <button type="button" title="Make main photo" className="rounded-md bg-white p-1" onClick={() => onMainChange(g.url)}><Star size={13} /></button>
              <button type="button" title="Remove" className="rounded-md bg-white p-1 text-rose-600" onClick={async () => { await supabase.from('product_images').delete().eq('id', g.id); refetch(); }}><Trash2 size={13} /></button>
            </div>
          )}
        </div>
      ))}
      {editable && product.id && (
        <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink-200 text-[11px] text-ink-400 hover:border-gold-400">
          <ImagePlus size={18} /> More
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files, false)} />
        </label>
      )}
      {editable && !product.id && <p className="self-center text-xs text-ink-400">Save the product to add more gallery photos.</p>}
    </div>
  );
}
