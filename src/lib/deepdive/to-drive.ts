/**
 * Putting the material a run found into /drive, so it can be read again.
 *
 * A research run collects the documents that mattered and then keeps only a URL
 * to each of them. That is fine until the page moves, the PDF goes behind a
 * login, or you want to ask a question of the paper itself rather than of the
 * summary someone wrote from it. /drive already does all three things worth
 * having — it stores the bytes, it embeds them into the @files index, and
 * (when the folder says so) it feeds them to entity resolution — so this module
 * is a bridge, not a new capability.
 *
 * Everything lands under `research/<topic>/`, one folder per run, which is the
 * unit somebody would actually go looking for.
 *
 * Two rules worth stating because they are easy to get wrong:
 *
 *  - **A document is saved as itself.** A PDF is stored as a PDF, not as
 *    whatever text a scraper managed to lift off the landing page. `fileToText`
 *    reads PDF, docx, doc, pptx and spreadsheets, so the index gets the real
 *    contents either way, and the copy on disk is the thing you can open.
 *  - **A web page is saved as markdown with its provenance in the file.** Bare
 *    extracted text with no URL and no date is unciteable a month later.
 */
import { createHash } from 'node:crypto';
import { db } from '$lib/db';
import { workflowFiles, driveFolderSettings, type WorkflowFilePermissions } from '$lib/db/schema';
import { eq, like } from 'drizzle-orm';
import { newDiskPath, saveBuffer, deleteFile } from '$lib/file-store/storage';
import { reindexFileInBackground } from '$lib/file-index/store';
import { syncSourcePolicy } from '$lib/jkai/intel/source-policy.server';
import { assertPublicUrl } from '$lib/server/ssrf-guard';
import { fetchPageText } from './fetch-page-text';
import { readableFromHtml } from './extract-local';

/** Matches `MAX_INDEXABLE_BYTES` in `$lib/file-index/store` — anything larger
 *  would be stored and then skipped by the indexer, which is a download nobody
 *  benefits from. */
const MAX_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Saved files are read-only from workflows: they are evidence, not scratch. */
const PERMISSIONS: WorkflowFilePermissions = { read: true, write: false, append: false, delete: false };

/**
 * Content types worth keeping byte-for-byte, and the extension to keep them
 * under. Everything absent from this map is treated as a web page.
 */
const DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv',
  'application/json': 'json',
};

/** Extension in the URL, for servers that answer with a generic content type. */
const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
};

export function slug(text: string, max = 60): string {
  const s = text
    .normalize('NFKD')
    // Strip combining marks so "Château" becomes "chateau" rather than losing
    // the vowel entirely.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return s || 'untitled';
}

/** The folder one run's material lives in. */
export function researchFolder(topic: string): string {
  return `research/${slug(topic, 70)}`;
}

/**
 * A stable path for a source, without its extension.
 *
 * Derived from the URL rather than allocated, so "have I already saved this?"
 * is a lookup and not a provenance column that would have to be added,
 * backfilled and kept in step. The six-hex suffix separates two sources with
 * the same title — and, more often, the same untitled fallback.
 *
 * The extension is deliberately not part of it: whether a URL turns out to be a
 * PDF or a web page is only known after fetching it, so the stem is the part
 * that can be computed up front and matched against later.
 */
export function driveFileStem(
  folder: string,
  source: { url: string; title?: string | null; domain?: string | null },
): string {
  const stem = slug(source.title?.trim() || source.domain?.trim() || source.url, 60);
  const hash = createHash('sha1').update(source.url).digest('hex').slice(0, 6);
  return `${folder}/${stem}-${hash}`;
}

export function driveFileName(
  folder: string,
  source: { url: string; title?: string | null; domain?: string | null },
  ext: string,
): string {
  return `${driveFileStem(folder, source)}.${ext}`;
}

/** The stem of a stored file name, i.e. everything before the final dot. */
export function stemOf(name: string): string {
  const cut = name.lastIndexOf('.');
  return cut > name.lastIndexOf('/') ? name.slice(0, cut) : name;
}

/** Which extension a URL and content type imply, and whether it is a document. */
export function classifyDownload(
  url: string,
  contentType: string | null,
): { mime: string; ext: string; isDocument: boolean } {
  const declared = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (DOCUMENT_TYPES[declared]) {
    return { mime: declared, ext: DOCUMENT_TYPES[declared], isDocument: true };
  }
  // Content type first, extension second: a server that says `text/html` for a
  // URL ending `.pdf` is serving an interstitial, not a paper.
  if (!declared || declared === 'application/octet-stream') {
    let path = '';
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      path = '';
    }
    const ext = path.split('.').pop() ?? '';
    if (EXTENSION_TYPES[ext]) return { mime: EXTENSION_TYPES[ext], ext, isDocument: true };
  }
  return { mime: 'text/markdown', ext: 'md', isDocument: false };
}

/**
 * The markdown wrapper a saved web page gets. The header is the whole reason
 * the page is worth saving as a file rather than a bookmark: it survives the
 * page being edited, and it is what a citation is built from later.
 */
export function pageMarkdown(
  source: { url: string; title?: string | null; domain?: string | null },
  topic: string,
  text: string,
  savedAt: Date,
): string {
  const title = source.title?.trim() || source.url;
  return [
    `# ${title}`,
    '',
    `- Source: ${source.url}`,
    source.domain ? `- Publisher: ${source.domain}` : null,
    `- Gathered for: ${topic}`,
    `- Saved: ${savedAt.toISOString().slice(0, 10)}`,
    '',
    '---',
    '',
    text.trim(),
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export interface SaveOutcome {
  sourceId: string;
  name: string;
  status: 'saved' | 'already-there' | 'failed';
  /** Set on 'saved' — how the bytes were obtained, so the UI can say so. */
  kind?: 'document' | 'page';
  bytes?: number;
  reason?: string;
}

async function download(url: string): Promise<{ buf: Buffer; contentType: string | null } | null> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: {
      // Some publishers serve a challenge page to an unidentified client, and a
      // challenge page saved as a paper is worse than no file at all.
      'User-Agent': 'Mozilla/5.0 (compatible; strangeramblings-research/1.0)',
      Accept: '*/*',
    },
  });
  if (!res.ok) return null;

  const declaredLength = Number(res.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BYTES) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  // A server may under-declare or omit content-length, so the real size is
  // checked too rather than trusted from the header alone.
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
  return { buf, contentType: res.headers.get('content-type') };
}

/**
 * Save one source into the run's folder.
 *
 * Never throws: a batch of twelve sources will contain a dead link and a
 * paywall, and one of those must not take the other eleven with it.
 */
export async function saveSourceToDrive(
  source: { id: string; url: string; title?: string | null; domain?: string | null },
  topic: string,
  folder = researchFolder(topic),
): Promise<SaveOutcome> {
  const stem = driveFileStem(folder, source);
  let name = `${stem}.md`;
  /** Improved in place when Readability recovers the real page title. */
  let title = source.title ?? null;
  try {
    await assertPublicUrl(source.url);

    /**
     * Already saved? Matched on the stem, before anything is downloaded — the
     * extension depends on what the server sends back, so a check on the full
     * name would re-fetch a PDF every time in order to discover it was already
     * there.
     */
    const already = await existingStems(folder);
    if (already.has(stem)) return { sourceId: source.id, name, status: 'already-there' };

    const got = await download(source.url);
    const classified = got
      ? classifyDownload(source.url, got.contentType)
      : { mime: 'text/markdown', ext: 'md', isDocument: false };
    name = `${stem}.${classified.ext}`;

    let buf: Buffer;
    let mime: string;
    let kind: 'document' | 'page';

    if (got && classified.isDocument) {
      buf = got.buf;
      mime = classified.mime;
      kind = 'document';
    } else {
      /**
       * Read the bytes we already downloaded before paying anyone to fetch them
       * again.
       *
       * This used to go straight to `fetchPageText`, which tries **Tavily
       * Extract first** — so archiving a page cost a Tavily credit to re-fetch
       * a page the line above had just downloaded in full. Readability over the
       * HTML in hand costs nothing and needs no network at all.
       *
       * `fetchPageText` is still the fallback, and earns its keep: a paywall, a
       * JavaScript-rendered page or a 403 to our user-agent are exactly what
       * Tavily and the residential scraper are for. It just should not be the
       * FIRST thing tried against a page that came back fine.
       */
      const local = got ? readableFromHtml(got.buf.toString('utf8'), source.url) : null;
      let text = local?.content ?? '';
      // Readability also recovers the real page title, which beats the slug the
      // file name is built from.
      if (local?.title?.trim()) title = local.title.trim();

      if (!text.trim()) {
        const page = await fetchPageText(source.url);
        text = page.text;
      }
      if (!text.trim()) {
        return { sourceId: source.id, name, status: 'failed', reason: 'No readable text at that URL' };
      }
      buf = Buffer.from(pageMarkdown({ ...source, title }, topic, text, new Date()), 'utf8');
      mime = 'text/markdown';
      kind = 'page';
    }

    const diskPath = newDiskPath(name);
    await saveBuffer(diskPath, buf);

    let inserted: { id: string } | undefined;
    try {
      [inserted] = await db
        .insert(workflowFiles)
        .values({
          name,
          description: `Research: ${topic} — ${source.url}`,
          mimeType: mime,
          sizeBytes: buf.byteLength,
          diskPath,
          permissions: PERMISSIONS,
          uploadedBy: 'research',
        })
        .returning({ id: workflowFiles.id });
    } catch (err) {
      // The existence check above is not atomic. Losing the race is not an
      // error — the file is there, which is what was asked for — but the blob
      // just written is now an orphan.
      await deleteFile(diskPath).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      if (/workflow_files_name_idx|unique|duplicate key|23505/i.test(msg)) {
        return { sourceId: source.id, name, status: 'already-there' };
      }
      throw err;
    }

    if (!inserted) {
      await deleteFile(diskPath).catch(() => {});
      return { sourceId: source.id, name, status: 'failed', reason: 'Could not record the file' };
    }

    // Embeds into the @files index and — subject to the folder policy set below
    // — queues entity extraction. Background and hash-gated, so it never holds
    // up the response.
    reindexFileInBackground(inserted.id);

    return { sourceId: source.id, name, status: 'saved', kind, bytes: buf.byteLength };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      sourceId: source.id,
      name,
      status: 'failed',
      // `ssrf_blocked:` prefixes are for logs, not for a person reading a page.
      reason: msg.replace(/^ssrf_blocked:\s*/, '').slice(0, 200),
    };
  }
}

/**
 * Mark the run's folder as feeding entity resolution.
 *
 * Without this the files would be searchable and invisible to the intel graph,
 * which is half the reason for putting them there. `syncSourcePolicy` then
 * applies the policy to everything already beneath the path, so it does not
 * matter whether the folder is created before or after the files.
 */
export async function ensureResearchFolderPolicy(folder: string): Promise<void> {
  const [existing] = await db
    .select({ id: driveFolderSettings.id, intelMode: driveFolderSettings.intelMode })
    .from(driveFolderSettings)
    .where(eq(driveFolderSettings.path, folder))
    .limit(1);

  if (!existing) {
    await db.insert(driveFolderSettings).values({ path: folder, intelMode: 'include' });
  } else if (existing.intelMode === 'inherit') {
    // An explicit `exclude` is a decision somebody made about this folder, and
    // saving another file into it is not a reason to overturn it.
    await db
      .update(driveFolderSettings)
      .set({ intelMode: 'include', updatedAt: new Date() })
      .where(eq(driveFolderSettings.id, existing.id));
  }

  await syncSourcePolicy(folder);
}

/**
 * The stems already stored under a folder, for rendering saved state and for
 * the pre-download existence check. One query per folder rather than one per
 * source: a run's folder holds tens of files, not thousands.
 */
export async function existingStems(folder: string): Promise<Set<string>> {
  const rows = await db
    .select({ name: workflowFiles.name })
    .from(workflowFiles)
    .where(like(workflowFiles.name, `${folder}/%`));
  return new Set(rows.map((r) => stemOf(r.name)));
}
