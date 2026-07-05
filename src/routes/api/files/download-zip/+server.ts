import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { inArray } from 'drizzle-orm';
import { readBuffer } from '$lib/file-store/storage';
import archiver from 'archiver';

// POST { ids: string[] } -> a zip of the requested file-store files.
// Used by the /drive "Download selected" action when more than one file is picked.
// Owner-gated by hooks (all /api/* require an owner session unless explicitly bypassed).
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? (body!.ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  if (ids.length === 0) throw error(400, 'ids required');

  const rows = await db.select().from(workflowFiles).where(inArray(workflowFiles.id, ids));
  if (rows.length === 0) throw error(404, 'no files found');

  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('warning', (err: unknown) => {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);
  });

  const used = new Set<string>();
  for (const row of rows) {
    let buf: Buffer;
    try {
      buf = await readBuffer(row.diskPath);
    } catch {
      continue; // skip files whose content is missing on disk
    }
    // Preserve folder-style names; de-dupe collisions with " (n)".
    let entry = row.name.replace(/^\/+/, '') || 'file';
    if (used.has(entry)) {
      const dot = entry.lastIndexOf('.');
      const stem = dot > 0 ? entry.slice(0, dot) : entry;
      const ext = dot > 0 ? entry.slice(dot) : '';
      let i = 2;
      while (used.has(`${stem} (${i})${ext}`)) i++;
      entry = `${stem} (${i})${ext}`;
    }
    used.add(entry);
    archive.append(buf, { name: entry });
  }

  await archive.finalize();
  await done;

  const zip = Buffer.concat(chunks);
  return new Response(new Uint8Array(zip), {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(zip.byteLength),
      'content-disposition': 'attachment; filename="drive-files.zip"',
      'cache-control': 'private, no-store',
    },
  });
};
