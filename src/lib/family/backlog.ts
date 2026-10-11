// The family backlog — the pure half: reading what the share sheet sent,
// cleaning a link (tracking parameters off, one key per video), what kind of
// thing it is, reading a title and picture out of oEmbed or a page's <meta>
// tags, the status rules and the shape the phone reads. No database, no
// network, no clock of its own. Storage and fetching are ./backlog.server.
//
// Anyone in the family shares a link, a video or a line of text into the
// iPhone app ("Share → SR"); everyone in the family sees the list.

export type BacklogKind = 'video' | 'page' | 'idea';
export type BacklogProvider = 'youtube' | 'tiktok' | 'instagram' | 'web';
export type BacklogStatus = 'new' | 'done' | 'dismissed' | 'deleted';

export const NOT_FAMILY = 'The backlog is for the family.';
export const TITLE_MAX = 200;
export const NOTE_MAX = 500;
export const URL_MAX = 2000;
/** Done and dismissed items stay on the list this long. */
export const FINISHED_DAYS = 30;

/** An item as stored (the columns of `family_backlog_item`, camel-cased). */
export interface BacklogRecord {
  id: string;
  kind: string;
  url: string | null;
  canonicalUrl: string | null;
  provider: string | null;
  title: string | null;
  siteName: string | null;
  thumbnailUrl: string | null;
  note: string | null;
  forEmail: string | null;
  addedByEmail: string;
  status: string;
  doneByEmail: string | null;
  doneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Actor {
  email: string;
  parent: boolean;
}

export type Invalid = { ok: false; status: 400 | 403 | 404 | 409; error: string };
export type Valid<T> = { ok: true; value: T };

const bad = (error: string): Invalid => ({ ok: false, status: 400, error });

/** A trimmed string, null for empty/absent, or undefined when it is not a string at all. */
function text(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : null;
}

/** At most `max` characters (not UTF-16 units), with an ellipsis when cut. */
export function clip(s: string, max: number): string {
  const chars = [...s.replace(/\s+/gu, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** The first http(s) link in a piece of shared text, without trailing punctuation. */
export function findUrl(s: string): string | null {
  const m = /https?:\/\/[^\s<>"'`]+/iu.exec(s);
  if (!m) return null;
  return m[0].replace(/[).,;:!?'"\]]+$/u, '');
}

function parseHttp(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** The host without `www.` or `m.`, lower-cased. */
function bareHost(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(www|m)\./u, '');
}

export function providerOf(u: URL): BacklogProvider {
  const host = bareHost(u);
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  return 'web';
}

export function kindOf(u: URL): Exclude<BacklogKind, 'idea'> {
  const provider = providerOf(u);
  if (provider === 'youtube' || provider === 'tiktok') return 'video';
  if (provider === 'instagram' && /^\/(reels?|tv)\//u.test(u.pathname)) return 'video';
  return 'page';
}

/**
 * A TikTok short link (`vm.`/`vt.tiktok.com/…`, `tiktok.com/t/…`) — it names
 * no video until it is followed, so two shares of one video look different.
 */
export function isShortLink(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  return host === 'vm.tiktok.com' || host === 'vt.tiktok.com' || (providerOf(u) === 'tiktok' && /^\/t\//u.test(u.pathname));
}

// Parameters that say who shared a link, or which campaign it came from —
// never which page it is. YouTube's `si` and TikTok's share ids identify the
// person who shared; that is not the family's to keep.
const TRACKING = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'mc_cid', 'mc_eid', 'igshid', 'igsh', 'si', 'feature', 'pp', 'ref_src', 'ref_url',
  '_hsenc', '_hsmi', 'mkt_tok', 'share_id', 'share_app_id', 'sender_device', 'is_from_webapp',
]);

/** The YouTube video id a link names, or null. */
function youtubeId(u: URL): string | null {
  const host = bareHost(u);
  const id = /^[\w-]{6,20}$/u;
  if (host === 'youtu.be') {
    const v = u.pathname.split('/')[1] ?? '';
    return id.test(v) ? v : null;
  }
  const v = u.searchParams.get('v');
  if (u.pathname === '/watch' && v && id.test(v)) return v;
  const m = /^\/(shorts|live|embed)\/([\w-]{6,20})/u.exec(u.pathname);
  return m ? m[2] : null;
}

/**
 * The link to keep and open: tracking parameters off, YouTube reduced to the
 * video, TikTok and Instagram to their path (every query there is tracking).
 */
export function cleanUrl(u: URL): string {
  const out = new URL(u.toString());
  out.hash = '';
  const provider = providerOf(out);
  if (provider === 'youtube') {
    const v = youtubeId(out);
    if (v) {
      const short = /^\/shorts\//u.test(out.pathname);
      return short ? `https://www.youtube.com/shorts/${v}` : `https://www.youtube.com/watch?v=${v}`;
    }
  }
  if (provider === 'tiktok' || provider === 'instagram') {
    out.search = '';
    out.protocol = 'https:';
    return out.toString();
  }
  for (const key of [...out.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING.has(key.toLowerCase())) out.searchParams.delete(key);
  }
  return out.toString().replace(/\?$/u, '');
}

/**
 * The TikTok video id a link names, or null. A followed short link names no
 * author (`/@/video/<id>`), so the id is the only thing two shares of one
 * video are sure to have in common.
 */
function tiktokId(u: URL): string | null {
  return /\/(?:video|photo)\/(\d{5,25})(?:\/|$)/u.exec(u.pathname)?.[1] ?? null;
}

/** The key two shares of the same thing have in common: scheme, `www.`, case of host and a trailing slash ignored. */
export function canonicalKey(cleaned: string): string {
  const u = new URL(cleaned);
  const v = providerOf(u) === 'youtube' ? youtubeId(u) : null;
  if (v) return `youtube:${v}`;
  const t = providerOf(u) === 'tiktok' ? tiktokId(u) : null;
  if (t) return `tiktok:${t}`;
  const path = u.pathname.replace(/\/+$/u, '');
  return `${bareHost(u)}${path}${u.search}`;
}

/** What the share sheet sent, read. */
export type Share =
  | { kind: 'link'; url: URL; hint: string | null; note: string | null; forId: string | null }
  | { kind: 'idea'; title: string; note: string | null; forId: string | null };

/**
 * `{ url?, text?, note?, forId? }` from the share extension. A link is `url`,
 * or the first link in `text` (TikTok shares a caption with the link in it);
 * the rest of `text` is a title to fall back on. No link at all and `text` is
 * an idea. PURE.
 */
export function parseShare(input: unknown): Valid<Share> | Invalid {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('Body must be JSON');
  const b = input as Record<string, unknown>;
  const url = text(b.url);
  const body = text(b.text);
  const note = text(b.note);
  if (url === undefined || body === undefined || note === undefined) return bad('Send text.');
  if (note && [...note].length > NOTE_MAX) return bad(`Keep the note under ${NOTE_MAX} characters.`);
  let forId: string | null = null;
  if (b.forId !== undefined && b.forId !== null && b.forId !== '') {
    if (typeof b.forId !== 'string') return bad('That person is not in the family.');
    forId = b.forId;
  }

  const raw = url ?? (body ? findUrl(body) : null);
  if (raw) {
    if (raw.length > URL_MAX) return bad('That link is too long.');
    const parsed = parseHttp(raw);
    if (!parsed) return bad('Only web links can be shared.');
    const rest = body ? body.replace(raw, '').trim() : '';
    return { ok: true, value: { kind: 'link', url: parsed, hint: rest ? clip(rest, TITLE_MAX) : null, note, forId } };
  }
  if (!body) return bad('Share a link or write an idea.');
  return { ok: true, value: { kind: 'idea', title: clip(body, TITLE_MAX), note, forId } };
}

// ── What a link is called ───────────────────────────────────────────────────

export interface LinkMeta {
  title: string | null;
  siteName: string | null;
  thumbnailUrl: string | null;
}

export const NO_META: LinkMeta = { title: null, siteName: null, thumbnailUrl: null };

/** The oEmbed endpoint that describes this link without a page fetch, or null. */
export function oembedUrl(cleaned: string): string | null {
  const u = new URL(cleaned);
  const provider = providerOf(u);
  if (provider === 'youtube') {
    // The endpoint wants a watch link; a Short is the same video.
    const v = youtubeId(u);
    const target = v ? `https://www.youtube.com/watch?v=${v}` : cleaned;
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`;
  }
  if (provider === 'tiktok') return `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleaned)}`;
  return null;
}

/** An https picture URL we are willing to hand the phone, or null. */
function picture(raw: unknown, base?: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim(), base);
    if (u.protocol !== 'https:') return null;
    const s = u.toString();
    return s.length <= URL_MAX ? s : null;
  } catch {
    return null;
  }
}

function label(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = clip(decodeEntities(raw), TITLE_MAX);
  return t || null;
}

/** An oEmbed reply (YouTube, TikTok). A TikTok with no caption is named after its author. PURE. */
export function parseOembed(json: unknown, provider: BacklogProvider): LinkMeta {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return NO_META;
  const o = json as Record<string, unknown>;
  const author = label(o.author_name);
  let title = label(o.title);
  if (!title && author) title = provider === 'tiktok' ? `TikTok from ${author}` : author;
  return { title, siteName: label(o.provider_name), thumbnailUrl: picture(o.thumbnail_url) };
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/giu, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/giu;
  for (let m = re.exec(tag); m; m = re.exec(tag)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

/** A page's Open Graph / Twitter card / <title>, with the picture made absolute against `pageUrl`. PURE. */
export function parsePageMeta(html: string, pageUrl: string): LinkMeta {
  const head = html.slice(0, 300_000);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/giu)) {
    const a = attributes(m[0]);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  const titleTag = /<title\b[^>]*>([^<]*)<\/title>/iu.exec(head)?.[1];
  return {
    title: label(meta['og:title'] ?? meta['twitter:title'] ?? titleTag),
    siteName: label(meta['og:site_name']),
    thumbnailUrl: picture(meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'], pageUrl),
  };
}

// ── The list and its rules ─────────────────────────────────────────────────

export const ACTIONS = ['done', 'dismiss', 'reopen', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

export function isAction(v: unknown): v is Action {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v);
}

export interface Transition {
  from: string;
  patch: Partial<Pick<BacklogRecord, 'status' | 'doneByEmail' | 'doneAt'>>;
}

/**
 * Who may do what, from which state. Anyone in the family marks something
 * watched (done), not for us (dismiss) or back on the list (reopen); only
 * whoever shared it, or a parent, deletes it. PURE.
 */
export function transition(item: BacklogRecord, action: Action, actor: Actor, now: Date): Valid<Transition> | Invalid {
  const from = item.status;
  switch (action) {
    case 'done':
    case 'dismiss':
      if (from !== 'new') return { ok: false, status: 409, error: 'That is already off the list.' };
      return { ok: true, value: { from, patch: { status: action === 'done' ? 'done' : 'dismissed', doneByEmail: actor.email, doneAt: now } } };
    case 'reopen':
      if (from !== 'done' && from !== 'dismissed') return { ok: false, status: 409, error: 'That is already on the list.' };
      return { ok: true, value: { from, patch: { status: 'new', doneByEmail: null, doneAt: null } } };
    case 'delete':
      if (item.addedByEmail !== actor.email && !actor.parent) {
        return { ok: false, status: 403, error: 'Only whoever shared it, or a parent, can delete it.' };
      }
      return { ok: true, value: { from, patch: { status: 'deleted' } } };
  }
}

/** The two lists: still to do (newest first), and done or dismissed in the last 30 days. PURE. */
export function listsOf(items: BacklogRecord[], now: Date): { items: BacklogRecord[]; finished: BacklogRecord[] } {
  const since = now.getTime() - FINISHED_DAYS * 86_400_000;
  const newest = (a: BacklogRecord, b: BacklogRecord) => b.createdAt.getTime() - a.createdAt.getTime();
  return {
    items: items.filter((i) => i.status === 'new').sort(newest),
    finished: items
      .filter((i) => (i.status === 'done' || i.status === 'dismissed') && (i.doneAt ?? i.updatedAt).getTime() >= since)
      .sort((a, b) => (b.doneAt ?? b.updatedAt).getTime() - (a.doneAt ?? a.updatedAt).getTime()),
  };
}

export interface BacklogWire {
  id: string;
  kind: BacklogKind;
  url: string | null;
  provider: BacklogProvider | null;
  title: string | null;
  siteName: string | null;
  thumbnailUrl: string | null;
  note: string | null;
  forId: string | null;
  addedById: string;
  status: 'new' | 'done' | 'dismissed';
  doneById: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the phone gets: people as ids, never an address. PURE. */
export function toWire(item: BacklogRecord, idOf: (email: string) => string): BacklogWire {
  return {
    id: item.id,
    kind: item.kind as BacklogKind,
    url: item.url,
    provider: item.provider as BacklogProvider | null,
    title: item.title,
    siteName: item.siteName,
    thumbnailUrl: item.thumbnailUrl,
    note: item.note,
    forId: item.forEmail ? idOf(item.forEmail) : null,
    addedById: idOf(item.addedByEmail),
    status: item.status as BacklogWire['status'],
    doneById: item.doneByEmail ? idOf(item.doneByEmail) : null,
    doneAt: item.doneAt ? item.doneAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
