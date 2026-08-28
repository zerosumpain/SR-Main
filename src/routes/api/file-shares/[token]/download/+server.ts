import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { basename } from 'node:path';
import { readBuffer } from '$lib/file-store/storage';
import { downloadHeaders } from '$lib/file-serving';
import { resolveFileShare } from '$lib/file-shares';

/**
 * The one anonymous surface on the drive.
 *
 * Reachable without a session because `/api/file-shares` is in PUBLIC_PATHS —
 * the capability in the URL is the whole gate, so everything that matters is
 * enforced here and in resolveFileShare:
 *
 *   - 256 bits of entropy, compared as a SHA-256 hash, so the token is not
 *     guessable and is not recoverable from the database;
 *   - one file per token, by foreign key — no id, path or name is accepted
 *     from the request;
 *   - unknown, revoked and expired all return the SAME 404, so a probe learns
 *     nothing from the difference;
 *   - always an attachment, never inline, with `sandbox` and `nosniff` — a
 *     shared HTML or SVG file cannot run script on this origin.
 *
 * PUBLIC_PATHS matches by prefix, so anything added under /api/file-shares is
 * anonymous the moment the file exists. scripts/check-public-routes.mjs pins
 * that surface: a new route here shows up as a diff line in
 * .github/public-routes.txt and has to be accepted deliberately.
 */
export const GET: RequestHandler = async ({ params }) => {
  const row = await resolveFileShare(params.token);
  if (!row) throw error(404, 'not found');

  let bytes: Buffer;
  try {
    bytes = await readBuffer(row.diskPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw error(410, 'file content missing');
    throw err;
  }

  return new Response(new Uint8Array(bytes), {
    headers: downloadHeaders({
      mimeType: row.mimeType,
      sizeBytes: bytes.byteLength,
      filename: basename(row.name),
      inline: false,
    }),
  });
};
