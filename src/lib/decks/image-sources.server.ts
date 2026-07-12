// Deck imagery sourcing — search openly-licensed providers (Openverse,
// Wikimedia Commons; both keyless) or generate via pollinations.ai (free,
// open service), then persist a copy into the site's own image store so deck
// slides never hotlink a third party. Storage rides the blog image pipeline
// (fs ↔ Azure behind one key, public GET /api/blog/images/<bucket>/<file>,
// deploy-safe, immutable-cached) under the reserved bucket `deck-media`.

import { createHash } from 'node:crypto';
import { readBlogImage, saveBlogImage } from '$lib/blog/image-store';

const BUCKET = 'deck-media';
const UA = 'strangeramblings.com deck editor (contact: site owner)';
const MAX_BYTES = 15 * 1024 * 1024;

export interface ImageCandidate {
  title: string;
  creator: string | null;
  license: string;
  source: 'openverse' | 'wikimedia';
  /** Human page for the work (attribution link target). */
  pageUrl: string;
  /** Small preview for the picker grid (hotlinked in the editor only). */
  thumbUrl: string;
  /** Full-size original — downloaded on import, never hotlinked in decks. */
  imageUrl: string;
  width?: number;
  height?: number;
}

export interface StoredImage {
  /** Site-relative, publicly served, safe in an image block. */
  src: string;
  alt: string;
  caption: string;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function searchOpenverse(q: string, limit: number): Promise<ImageCandidate[]> {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${limit}&mature=false`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`openverse ${res.status}`);
  const data = (await res.json()) as {
    results?: {
      title?: string;
      creator?: string;
      license?: string;
      license_version?: string;
      url?: string;
      thumbnail?: string;
      foreign_landing_url?: string;
      width?: number;
      height?: number;
    }[];
  };
  return (data.results ?? [])
    .filter((r) => r.url && r.thumbnail)
    .map((r) => {
      const lic = (r.license ?? '').toLowerCase();
      const license =
        lic === 'cc0' || lic === 'pdm'
          ? 'Public domain'
          : `CC ${lic.toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''}`;
      return {
        title: r.title || 'Untitled',
        creator: r.creator || null,
        license,
        source: 'openverse' as const,
        pageUrl: r.foreign_landing_url || r.url!,
        thumbUrl: r.thumbnail!,
        imageUrl: r.url!,
        width: r.width,
        height: r.height,
      };
    });
}

async function searchWikimedia(q: string, limit: number): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${q}`,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '480',
    origin: '*',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`wikimedia ${res.status}`);
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: {
            url?: string;
            thumburl?: string;
            width?: number;
            height?: number;
            extmetadata?: Record<string, { value?: string }>;
          }[];
        }
      >;
    };
  };
  return Object.values(data.query?.pages ?? {})
    .filter((p) => p.imageinfo?.[0]?.url && p.imageinfo[0].thumburl)
    .map((p) => {
      const info = p.imageinfo![0];
      const meta = info.extmetadata ?? {};
      return {
        title: (p.title ?? 'File:Untitled').replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
        creator: meta.Artist?.value ? stripTags(meta.Artist.value).slice(0, 80) || null : null,
        license: meta.LicenseShortName?.value ? stripTags(meta.LicenseShortName.value) : 'See source',
        source: 'wikimedia' as const,
        pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title ?? '')}`,
        thumbUrl: info.thumburl!,
        imageUrl: info.url!,
        width: info.width,
        height: info.height,
      };
    });
}

/** Search the open-licence providers in parallel; a failing provider drops
 *  out silently rather than failing the search. Interleaved so both voices
 *  show in the first row of results. */
export async function searchOpenImages(q: string, perProvider = 8): Promise<ImageCandidate[]> {
  const settled = await Promise.allSettled([searchOpenverse(q, perProvider), searchWikimedia(q, perProvider)]);
  const lists = settled.map((s) => (s.status === 'fulfilled' ? s.value : []));
  const out: ImageCandidate[] = [];
  for (let i = 0; i < perProvider; i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

async function fetchImageBytes(url: string, timeoutMs: number): Promise<{ buf: Buffer; ext: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('only https image sources are allowed');
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(parsed.hostname)) {
    throw new Error('refusing private-network host');
  }
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`image fetch failed (${res.status})`);
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`not an image (content-type ${mime || 'unknown'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('image too large (>15MB)');
  if (buf.length === 0) throw new Error('empty image response');
  return { buf, ext };
}

function slugish(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'image'
  );
}

async function store(buf: Buffer, ext: string, nameSeed: string): Promise<string> {
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 10);
  const filename = `${slugish(nameSeed)}-${hash}.${ext}`;
  await saveBlogImage(BUCKET, filename, buf);
  return `/api/blog/images/${BUCKET}/${filename}`;
}

/** Owner uploads (drag-drop / file picker in the editor). Images ride the
 *  same store as imports; short mp4/webm clips are allowed for video blocks. */
const UPLOAD_MIME: Record<string, { ext: string; kind: 'image' | 'video'; max: number }> = {
  'image/jpeg': { ext: 'jpg', kind: 'image', max: MAX_BYTES },
  'image/png': { ext: 'png', kind: 'image', max: MAX_BYTES },
  'image/gif': { ext: 'gif', kind: 'image', max: MAX_BYTES },
  'image/webp': { ext: 'webp', kind: 'image', max: MAX_BYTES },
  'video/mp4': { ext: 'mp4', kind: 'video', max: 60 * 1024 * 1024 },
  'video/webm': { ext: 'webm', kind: 'video', max: 60 * 1024 * 1024 },
};

export async function storeUpload(
  buf: Buffer,
  mime: string,
  originalName: string,
): Promise<StoredImage & { kind: 'image' | 'video' }> {
  const def = UPLOAD_MIME[mime.split(';')[0].trim()];
  if (!def) throw new Error(`unsupported upload type "${mime}" — jpg/png/gif/webp images or mp4/webm video`);
  if (buf.length === 0) throw new Error('empty file');
  if (buf.length > def.max) throw new Error(`file too large (max ${Math.round(def.max / 1024 / 1024)}MB)`);
  const base = originalName.replace(/\.[a-z0-9]+$/i, '') || 'upload';
  const src = await store(buf, def.ext, base);
  return { src, alt: base.replace(/[-_]+/g, ' ').trim() || 'Uploaded media', caption: '', kind: def.kind };
}

/** Import a provider result: download the original, persist a copy, return a
 *  ready image block payload with the attribution caption pre-written. */
export async function importImage(candidate: {
  imageUrl: string;
  title?: string;
  creator?: string | null;
  license?: string;
  source?: string;
}): Promise<StoredImage> {
  const { buf, ext } = await fetchImageBytes(candidate.imageUrl, 30_000);
  const src = await store(buf, ext, candidate.title ?? 'image');
  const attribution = [
    candidate.creator ? `PHOTO — ${candidate.creator.toUpperCase()}` : 'PHOTO',
    candidate.license?.toUpperCase(),
    candidate.source === 'wikimedia' ? 'WIKIMEDIA COMMONS' : candidate.source === 'openverse' ? 'VIA OPENVERSE' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return { src, alt: candidate.title || 'Sourced image', caption: attribution };
}

/** Generate via pollinations.ai (free open service; can take ~10–60s cold)
 *  and persist the result like any import. */
export async function generateImage(prompt: string, width = 1600, height = 900): Promise<StoredImage> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true`;
  const { buf, ext } = await fetchImageBytes(url, 90_000);
  const src = await store(buf, ext, prompt);
  return {
    src,
    alt: prompt.slice(0, 140),
    caption: 'IMAGE — AI-GENERATED · POLLINATIONS.AI',
  };
}
