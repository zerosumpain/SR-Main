import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Readable } from 'node:stream';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { and, eq, like, sql } from 'drizzle-orm';
import {
  newDiskPath,
  saveBuffer,
  deleteFile,
  saveStream,
  readStream,
  copyFile,
} from '$lib/file-store/storage';
import {
  urlToRel,
  relToName,
  nameToRel,
  folderMarkerName,
  isFolderMarker,
  descendantPattern,
  DRIVE_PREFIX,
  FOLDER_MARKER,
} from '$lib/webdav/paths';
import { buildPropfindXml, type PropfindEntry } from '$lib/webdav/propfind';
import { isJunkPath } from '$lib/webdav/filters';

const MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

// WebDAV clients distinguish `/dav/` (the root collection) from `/dav`
// (a non-collection resource); SvelteKit's default 'never' trailing-slash
// policy would 308 redirect them. 'ignore' lets the verb handlers see
// both URL forms unchanged.
export const trailingSlash = 'ignore';

// Guess MIME from extension when the client didn't send one.
function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    json: 'application/json', xml: 'application/xml',
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript',
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime',
    wav: 'audio/wav',
    zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

// ──────── lookup helpers ───────────────────────────────────────────────

type Row = typeof workflowFiles.$inferSelect;

async function rowByName(name: string): Promise<Row | null> {
  const [r] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, name)).limit(1);
  return r ?? null;
}

async function descendants(rel: string): Promise<Row[]> {
  const pattern = descendantPattern(rel);
  return db
    .select()
    .from(workflowFiles)
    .where(sql`${workflowFiles.name} LIKE ${pattern} ESCAPE '\\'`);
}

// True when the rel exists as a "virtual folder" — at least one row's
// name has it as a path prefix. The mount root ("") is always a folder.
async function isVirtualFolder(rel: string): Promise<boolean> {
  if (rel === '') return true;
  const pattern = descendantPattern(rel);
  const [hit] = await db
    .select({ n: sql<number>`1` })
    .from(workflowFiles)
    .where(sql`${workflowFiles.name} LIKE ${pattern} ESCAPE '\\'`)
    .limit(1);
  return !!hit;
}

// ──────── verb: OPTIONS ────────────────────────────────────────────────

export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    status: 200,
    headers: {
      DAV: '1, 2',
      'MS-Author-Via': 'DAV',
      Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, LOCK, UNLOCK',
      'Accept-Ranges': 'bytes',
    },
  });
};

// ──────── verb: GET / HEAD ─────────────────────────────────────────────

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Browser-friendly index page for a collection. WebDAV clients use
// PROPFIND, not GET, so this is purely for humans who paste the URL into
// a browser tab — gives them a directory listing and a hint that the URL
// is meant to be mounted, not browsed.
async function renderCollectionIndex(rel: string): Promise<string> {
  const all = await descendants(rel);
  const baseName = relToName(rel);
  const stripLen = baseName === DRIVE_PREFIX.replace(/\/$/, '') ? DRIVE_PREFIX.length : baseName.length + 1;
  const seenFolders = new Set<string>();
  const folders: string[] = [];
  const files: { name: string; size: number; updated: Date; mime: string }[] = [];
  for (const r of all) {
    const after = r.name.slice(stripLen);
    if (!after) continue;
    const slash = after.indexOf('/');
    if (slash === -1) {
      if (after === FOLDER_MARKER) continue;
      files.push({ name: after, size: r.sizeBytes, updated: new Date(r.updatedAt), mime: r.mimeType });
    } else {
      const sub = after.slice(0, slash);
      if (!seenFolders.has(sub)) {
        seenFolders.add(sub);
        folders.push(sub);
      }
    }
  }
  folders.sort();
  files.sort((a, b) => a.name.localeCompare(b.name));

  const crumbs = rel ? rel.split('/').filter(Boolean) : [];
  const breadcrumb = ['<a href="/dav/">/</a>']
    .concat(crumbs.map((seg, i) => {
      const path = crumbs.slice(0, i + 1).map(encodeURIComponent).join('/');
      return `<a href="/dav/${path}/">${htmlEscape(seg)}</a>`;
    }))
    .join(' / ');

  const parentLink = rel
    ? `<a href="/dav/${crumbs.slice(0, -1).map(encodeURIComponent).join('/')}${crumbs.length > 1 ? '/' : ''}">..</a>`
    : '';

  const folderRows = folders.map((f) =>
    `<tr><td><a href="/dav/${rel ? encodeURIComponent(rel) + '/' : ''}${encodeURIComponent(f)}/">${htmlEscape(f)}/</a></td><td>—</td><td>folder</td></tr>`
  ).join('');
  const fileRows = files.map((f) =>
    `<tr><td><a href="/dav/${rel ? encodeURIComponent(rel) + '/' : ''}${encodeURIComponent(f.name)}">${htmlEscape(f.name)}</a></td><td>${fmtSize(f.size)}</td><td>${htmlEscape(f.mime)}</td></tr>`
  ).join('');
  const emptyRow = !folders.length && !files.length
    ? '<tr><td colspan="3" class="empty">empty</td></tr>'
    : '';

  return `<!doctype html>
<html><head><title>WebDAV — /dav/${htmlEscape(rel)}</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 880px; margin: 2rem auto; padding: 0 1rem; color: #1a1008; }
  h1 { font-size: 1.2rem; font-weight: 500; margin: 0 0 0.5rem; }
  .hint { background: #fff8e8; border-left: 3px solid #d99836; padding: 0.6rem 0.9rem; font-size: 13px; margin: 0 0 1rem; }
  .crumb { font-family: ui-monospace, Menlo, monospace; font-size: 12px; margin: 0 0 1rem; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; font-size: 13px; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #999; }
  td.empty { color: #999; font-style: italic; text-align: center; }
  a { color: #b8500e; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .parent { font-family: ui-monospace, Menlo, monospace; }
</style></head><body>
<h1>/dav/${htmlEscape(rel)}</h1>
<div class="hint">This URL is a WebDAV mount, not a browser destination. Mount it in Finder (⌘K), Windows Explorer (Add a network location), or <code>davs://strangeramblings.com/dav/</code> in Linux. Manage credentials at <a href="/drive">/drive</a>.</div>
<div class="crumb">${breadcrumb}</div>
${parentLink ? `<div class="parent">${parentLink}</div>` : ''}
<table>
  <thead><tr><th>Name</th><th>Size</th><th>Type</th></tr></thead>
  <tbody>${folderRows}${fileRows}${emptyRow}</tbody>
</table>
</body></html>`;
}

export const GET: RequestHandler = async ({ params, request }) => {
  const headOnly = request.method === 'HEAD';
  const { rel, isCollection: trailingSlash } = urlToRel('/dav/' + (params.path ?? ''));
  const name = relToName(rel);
  const row = rel ? await rowByName(name) : null;
  const isFile = row && !isFolderMarker(row.name);

  // Resolve as a collection when: it's the mount root, the URL has a
  // trailing slash, or no file row exists but there are descendants
  // (virtual folder).
  if (!isFile) {
    const folder = rel === '' || trailingSlash || (await isVirtualFolder(rel));
    if (!folder) throw error(404, 'not found');
    if (headOnly) {
      return new Response(null, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    const html = await renderCollectionIndex(rel);
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
    });
  }

  if (headOnly) {
    return new Response(null, {
      status: 200,
      headers: {
        'content-type': row!.mimeType || 'application/octet-stream',
        'content-length': String(row!.sizeBytes),
        'last-modified': new Date(row!.updatedAt).toUTCString(),
        etag: `"${row!.id}-${new Date(row!.updatedAt).getTime()}"`,
      },
    });
  }

  // Stream file from disk to avoid buffering big files in RAM.
  let stream: Readable;
  try {
    stream = await readStream(row!.diskPath);
  } catch {
    throw error(410, 'file content missing');
  }

  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'content-type': row!.mimeType || 'application/octet-stream',
      'content-length': String(row!.sizeBytes),
      'last-modified': new Date(row!.updatedAt).toUTCString(),
      etag: `"${row!.id}-${new Date(row!.updatedAt).getTime()}"`,
      'cache-control': 'private, no-store',
    },
  });
};

// SvelteKit derives HEAD from GET when both fall under [...path], but only
// for HEAD requests on a route that exports GET. Be explicit so HEAD never
// surprises us by hitting fallback.
export const HEAD = GET;

// ──────── verb: PUT ────────────────────────────────────────────────────

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const { rel, isCollection } = urlToRel('/dav/' + (params.path ?? ''));
  if (!rel) return new Response('cannot PUT to root', { status: 405 });
  if (isCollection) return new Response('PUT to collection', { status: 405 });
  if (isJunkPath(rel)) return new Response(null, { status: 201 }); // swallow OS junk

  const name = relToName(rel);
  const declaredLen = Number(request.headers.get('content-length') ?? 0);
  if (declaredLen > MAX_BYTES) return new Response('too large', { status: 413 });

  const mime = request.headers.get('content-type')?.split(';')[0]?.trim() || guessMime(rel);
  const newDisk = newDiskPath(rel);

  // Empty body fast-path (Office apps PUT a 0-byte placeholder before the
  // real save).
  let finalSize: number;
  if (declaredLen === 0 && !request.body) {
    await saveBuffer(newDisk, Buffer.alloc(0));
    finalSize = 0;
  } else {
    try {
      finalSize = await saveStream(
        newDisk,
        Readable.fromWeb(request.body as unknown as import('node:stream/web').ReadableStream),
      );
    } catch (err) {
      await deleteFile(newDisk).catch(() => {});
      return new Response(`write failed: ${(err as Error).message}`, { status: 500 });
    }
  }

  if (finalSize > MAX_BYTES) {
    await deleteFile(newDisk).catch(() => {});
    return new Response('too large', { status: 413 });
  }

  const existing = await rowByName(name);
  const owner = locals.davAuth?.ownerEmail ?? null;

  if (existing) {
    await db
      .update(workflowFiles)
      .set({
        diskPath: newDisk,
        sizeBytes: finalSize,
        mimeType: mime,
        updatedAt: new Date(),
      })
      .where(eq(workflowFiles.id, existing.id));
    void deleteFile(existing.diskPath).catch(() => {});
    return new Response(null, { status: 204 });
  }

  await db.insert(workflowFiles).values({
    name,
    description: null,
    mimeType: mime,
    sizeBytes: finalSize,
    diskPath: newDisk,
    permissions: { read: true, write: true, append: true, delete: true },
    uploadedBy: owner,
  });
  return new Response(null, { status: 201, headers: { 'content-length': '0' } });
};

// ──────── verb: DELETE ─────────────────────────────────────────────────

export const DELETE: RequestHandler = async ({ params, request }) => {
  const urlPath = '/dav/' + (params.path ?? '');
  const { rel, isCollection: trailingSlash } = urlToRel(urlPath);
  if (!rel) return new Response('cannot delete root', { status: 403 });

  const name = relToName(rel);
  const row = await rowByName(name);
  const folder = trailingSlash || (!row && (await isVirtualFolder(rel)));

  if (folder) {
    const all = await descendants(rel);
    // Best-effort disk cleanup; row delete is the source of truth.
    await db
      .delete(workflowFiles)
      .where(sql`${workflowFiles.name} LIKE ${descendantPattern(rel)} ESCAPE '\\'`);
    for (const r of all) {
      void deleteFile(r.diskPath).catch(() => {});
    }
    return new Response(null, { status: 204 });
  }

  if (!row) return new Response('not found', { status: 404 });
  await db.delete(workflowFiles).where(eq(workflowFiles.id, row.id));
  void deleteFile(row.diskPath).catch(() => {});
  return new Response(null, { status: 204 });
};

// ──────── verb: PROPFIND ───────────────────────────────────────────────

async function handlePropfind(req: Request, urlPath: string): Promise<Response> {
  const { rel } = urlToRel(urlPath);
  const depth = (req.headers.get('depth') ?? 'infinity').toLowerCase();
  const name = relToName(rel);

  // Resolve target: file, folder, or 404.
  const fileRow = rel ? await rowByName(name) : null;
  const isFile = fileRow && !isFolderMarker(fileRow.name);
  const folderExists = rel === '' || (await isVirtualFolder(rel));

  if (!isFile && !folderExists) {
    return new Response('not found', { status: 404 });
  }

  const entries: PropfindEntry[] = [];

  if (isFile) {
    entries.push({
      rel,
      isCollection: false,
      sizeBytes: fileRow!.sizeBytes,
      mimeType: fileRow!.mimeType,
      createdAt: new Date(fileRow!.createdAt),
      updatedAt: new Date(fileRow!.updatedAt),
      etag: `${fileRow!.id}-${new Date(fileRow!.updatedAt).getTime()}`,
    });
  } else {
    // The collection itself.
    const now = new Date();
    entries.push({
      rel,
      isCollection: true,
      sizeBytes: 0,
      mimeType: 'httpd/unix-directory',
      createdAt: now,
      updatedAt: now,
      etag: null,
    });

    if (depth !== '0') {
      // Direct descendants only. Fetch all then group by next-segment.
      const all = await descendants(rel);
      const seenFolders = new Set<string>();
      const baseName = relToName(rel); // e.g. 'drive' or 'drive/foo'
      const baseRel = rel; // '' or 'foo' or 'foo/bar'
      const stripLen = (baseName === DRIVE_PREFIX.replace(/\/$/, '')) ? DRIVE_PREFIX.length : baseName.length + 1;

      for (const r of all) {
        const after = r.name.slice(stripLen); // path under this collection
        if (!after) continue;
        const slash = after.indexOf('/');
        if (slash === -1) {
          if (after === FOLDER_MARKER) continue; // hide folder markers
          // Direct file child.
          entries.push({
            rel: baseRel ? `${baseRel}/${after}` : after,
            isCollection: false,
            sizeBytes: r.sizeBytes,
            mimeType: r.mimeType,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
            etag: `${r.id}-${new Date(r.updatedAt).getTime()}`,
          });
        } else {
          // Descendant — implies a virtual subfolder named `after.slice(0, slash)`.
          const sub = after.slice(0, slash);
          if (seenFolders.has(sub)) continue;
          seenFolders.add(sub);
          entries.push({
            rel: baseRel ? `${baseRel}/${sub}` : sub,
            isCollection: true,
            sizeBytes: 0,
            mimeType: 'httpd/unix-directory',
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
            etag: null,
          });
        }
      }
    }
  }

  const xml = buildPropfindXml(entries);
  return new Response(xml, {
    status: 207,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      DAV: '1, 2',
    },
  });
}

// ──────── verb: MKCOL ──────────────────────────────────────────────────

async function handleMkcol(urlPath: string): Promise<Response> {
  const { rel } = urlToRel(urlPath);
  if (!rel) return new Response('root exists', { status: 405 });
  // 415 if request had a body — MKCOL isn't allowed to carry an entity body.
  // Most clients send empty body so we don't enforce.

  // Already a folder or file at this path?
  if (await isVirtualFolder(rel)) return new Response('already exists', { status: 405 });
  const name = relToName(rel);
  if (await rowByName(name)) return new Response('already exists', { status: 405 });

  const markerName = folderMarkerName(rel);
  const newDisk = newDiskPath(`${rel}/${FOLDER_MARKER}`);
  await saveBuffer(newDisk, Buffer.alloc(0));
  await db.insert(workflowFiles).values({
    name: markerName,
    description: 'webdav folder marker',
    mimeType: 'application/x-empty',
    sizeBytes: 0,
    diskPath: newDisk,
    permissions: { read: true, write: false, append: false, delete: true },
    uploadedBy: null,
  });
  return new Response(null, { status: 201 });
}

// ──────── verb: MOVE / COPY ────────────────────────────────────────────

function parseDestination(req: Request, eventOrigin: string): { rel: string } | null {
  const dest = req.headers.get('destination');
  if (!dest) return null;
  let dPath: string;
  try {
    const u = new URL(dest, eventOrigin);
    dPath = u.pathname;
  } catch {
    return null;
  }
  if (!dPath.startsWith('/dav')) return null;
  const { rel } = urlToRel(dPath);
  return { rel };
}

async function handleMoveOrCopy(req: Request, urlPath: string, eventOrigin: string, kind: 'MOVE' | 'COPY'): Promise<Response> {
  const { rel: srcRel } = urlToRel(urlPath);
  if (!srcRel) return new Response('cannot move root', { status: 403 });
  const dest = parseDestination(req, eventOrigin);
  if (!dest) return new Response('Destination header required', { status: 400 });
  if (dest.rel === srcRel) return new Response('source = destination', { status: 403 });

  const overwrite = (req.headers.get('overwrite') ?? 'T').toUpperCase() !== 'F';
  const srcName = relToName(srcRel);
  const destName = relToName(dest.rel);

  const srcRow = await rowByName(srcName);
  const srcIsFolder = !srcRow && (await isVirtualFolder(srcRel));
  if (!srcRow && !srcIsFolder) return new Response('source not found', { status: 404 });

  if (srcRow) {
    // File source.
    const existing = await rowByName(destName);
    const replaced = !!existing;
    if (existing) {
      if (!overwrite) return new Response('overwrite=F and dest exists', { status: 412 });
      await db.delete(workflowFiles).where(eq(workflowFiles.id, existing.id));
      void deleteFile(existing.diskPath).catch(() => {});
    }

    if (kind === 'MOVE') {
      await db.update(workflowFiles).set({ name: destName, updatedAt: new Date() }).where(eq(workflowFiles.id, srcRow.id));
    } else {
      const newDisk = newDiskPath(dest.rel);
      await copyFile(srcRow.diskPath, newDisk);
      await db.insert(workflowFiles).values({
        name: destName,
        description: srcRow.description,
        mimeType: srcRow.mimeType,
        sizeBytes: srcRow.sizeBytes,
        diskPath: newDisk,
        permissions: srcRow.permissions,
        uploadedBy: srcRow.uploadedBy,
      });
    }
    return new Response(null, { status: replaced ? 204 : 201 });
  }

  // Folder source — rewrite all descendants' names in one statement.
  const srcPattern = descendantPattern(srcRel);
  const all = await descendants(srcRel);

  if (kind === 'MOVE') {
    // Postgres `replace(name, srcPrefix, destPrefix)` once we've matched.
    const oldPrefix = `${srcName}/`;
    const newPrefix = `${destName}/`;
    await db
      .update(workflowFiles)
      .set({ name: sql`overlay(${workflowFiles.name} placing ${newPrefix} from 1 for ${oldPrefix.length})`, updatedAt: new Date() })
      .where(sql`${workflowFiles.name} LIKE ${srcPattern} ESCAPE '\\'`);
    return new Response(null, { status: 201 });
  }

  // COPY folder — duplicate every descendant via streaming.
  const oldPrefix2 = `${srcName}/`;
  const newPrefix2 = `${destName}/`;
  for (const r of all) {
    const newName = newPrefix2 + r.name.slice(oldPrefix2.length);
    const newRel = newName.slice(DRIVE_PREFIX.length);
    const newDisk = newDiskPath(newRel);
    await copyFile(r.diskPath, newDisk);
    await db.insert(workflowFiles).values({
      name: newName,
      description: r.description,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      diskPath: newDisk,
      permissions: r.permissions,
      uploadedBy: r.uploadedBy,
    });
  }
  return new Response(null, { status: 201 });
}

// ──────── fallback (PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK) ─────────

export const fallback: RequestHandler = async ({ request, params, url }) => {
  const method = request.method.toUpperCase();
  const urlPath = '/dav/' + (params.path ?? '');

  switch (method) {
    case 'PROPFIND':
      return handlePropfind(request, urlPath);
    case 'MKCOL':
      return handleMkcol(urlPath);
    case 'MOVE':
    case 'COPY':
      return handleMoveOrCopy(request, urlPath, url.origin, method);
    case 'LOCK':
      // No-op fake lock — keeps Office happy without enforcing concurrency.
      return new Response(
        `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery><D:activelock>
    <D:locktype><D:write/></D:locktype>
    <D:lockscope><D:exclusive/></D:lockscope>
    <D:depth>infinity</D:depth>
    <D:timeout>Second-3600</D:timeout>
    <D:locktoken><D:href>opaquelocktoken:webdav-noop-${Date.now()}</D:href></D:locktoken>
  </D:activelock></D:lockdiscovery>
</D:prop>`,
        {
          status: 200,
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'lock-token': `<opaquelocktoken:webdav-noop-${Date.now()}>`,
          },
        },
      );
    case 'UNLOCK':
      return new Response(null, { status: 204 });
    default:
      return new Response('Method Not Allowed', { status: 405 });
  }
};
