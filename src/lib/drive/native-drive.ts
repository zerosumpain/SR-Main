// The SR app's Drive, as Main relays it.
//
// Main verifies the PHONE — the device credential and `drive:self`, in
// `withNativeAccess('drive', …)` — and SR-Drive does everything else: which
// rows the person reaches (Drive's $lib/drive/app-lane), the bytes, the
// stores, the quota, the index and the intel jobs. Main calls Drive's
// owner-only /api/files/app/* over the gateway's service lane and names the
// person on the phone in `x-sr-app-for`; Drive refuses anyone who is not a
// drive member right now, and can only NARROW the owner identity it is given.
//
// Why a relay and not the table: the store's bytes are Drive's. In production
// Main's `sr-main` user cannot read WORKFLOW_FILES_ROOT at all (its ACL entry
// sits under an empty mask), and connected Azure/S3 stores are Drive's job.
// The first cut of this lane read the table and the disk itself and answered
// EACCES on the first download.
//
// What Main adds on the way back: the shared folder's uploader emails become
// first names from the household roster, and the emails are dropped — a
// phone never receives anyone's address.

import { error, isHttpError } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { householdMember } from '$lib/db/schema';
import { requestExtracted, type RawExtractedResponse } from '$lib/server/extracted-app';

export type DriveSpace = 'mine' | 'shared';

export function parseSpace(raw: string | null | undefined): DriveSpace | null {
  return raw === 'mine' || raw === 'shared' ? raw : null;
}

/** Who is asking: established by `withNativeAccess('drive', …)`, never by the request. */
export type AppDriveCaller =
  | { kind: 'owner'; email: string }
  | { kind: 'member'; email: string; principalId: string };

/** Per file — SR-Drive's limit; checked here too so a refusal is cheap. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

const APP_FOR_HEADER = 'x-sr-app-for';

/** Who the drive answers, from what the gate set up — never from the request. */
export async function driveCaller(
  event: { locals: App.Locals },
  identity: { ownerEmail: string },
  role: 'owner' | 'member',
): Promise<AppDriveCaller> {
  if (role === 'owner') return { kind: 'owner', email: identity.ownerEmail.trim().toLowerCase() };
  const { viewerOf } = await import('$lib/server/viewer');
  const viewer = await viewerOf(event);
  if (viewer.kind !== 'member') throw error(403, 'Your access does not include that.');
  return { kind: 'member', email: viewer.email, principalId: viewer.principalId };
}

/** The owner's own phone sends no header: Drive then answers for the owner. */
function forHeaders(caller: AppDriveCaller): Record<string, string> {
  return caller.kind === 'member' ? { [APP_FOR_HEADER]: caller.email } : {};
}

function query(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Drive's refusal, in its own words and status; anything unreadable is a plain 502. */
function refusal(res: RawExtractedResponse): never {
  let message = 'Drive is not answering. Try again.';
  try {
    const body = JSON.parse(res.body.toString('utf8')) as { message?: string; error?: string };
    message = body.message || body.error || message;
  } catch {
    /* keep the plain sentence */
  }
  const status = res.status >= 400 && res.status < 600 ? res.status : 502;
  // A 401/403 from Drive's gateway is about the SERVICE lane, not the phone;
  // a 401 would sign the phone out, so it is never passed on as one.
  throw error(status === 401 ? 502 : status, message);
}

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  caller: AppDriveCaller,
  options: { body?: Buffer; contentType?: string; timeoutMs?: number } = {},
): Promise<RawExtractedResponse> {
  let res: RawExtractedResponse;
  try {
    res = await requestExtracted('drive', method, path, {
      // `accept` decides how SvelteKit renders Drive's `error()`: without it a
      // refusal comes back as an HTML page, and the phone heard "Drive is not
      // answering" for a 404 or a 400 that had a sentence of its own.
      headers: {
        accept: 'application/json',
        ...forHeaders(caller),
        ...(options.contentType ? { 'content-type': options.contentType } : {}),
      },
      body: options.body,
      timeoutMs: options.timeoutMs ?? 15_000,
    });
  } catch (err) {
    if (isHttpError(err)) throw err;
    console.error('[native-drive] Drive unreachable:', (err as Error).message);
    throw error(502, 'Drive is not answering. Try again.');
  }
  if (res.status < 200 || res.status >= 300) refusal(res);
  return res;
}

function parse<T>(res: RawExtractedResponse): T {
  try {
    return JSON.parse(res.body.toString('utf8')) as T;
  } catch {
    throw error(502, 'Drive sent something unreadable.');
  }
}

interface DriveFileWire {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  uploadedBy: string | null;
  canDelete: boolean;
}

export interface NativeDriveFile extends Omit<DriveFileWire, 'uploadedBy'> {
  /** Who put it there, by first name, in the shared folder only. Never an email. */
  addedBy: string | null;
}

interface ListingWire {
  space: DriveSpace;
  folder: string;
  folders: { name: string; path: string; items: number }[];
  files: DriveFileWire[];
  usage: { bytes: number; quotaBytes: number | null };
  maxUploadBytes: number;
}

/** First names for the shared folder's "added by", from the household roster. */
async function firstNames(emails: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return new Map();
  const rows: { email: string | null; displayName: string }[] = await db
    .select({ email: householdMember.email, displayName: householdMember.displayName })
    .from(householdMember)
    .where(inArray(householdMember.email, wanted))
    .catch(() => []);
  const names = new Map<string, string>();
  for (const r of rows) {
    if (r.email) names.set(r.email.toLowerCase(), r.displayName.trim().split(/\s+/)[0] || 'Family');
  }
  return names;
}

/** Drive's file as the phone receives it: the uploader's email becomes a first name, or goes. */
export function forPhone(file: DriveFileWire, space: DriveSpace, names: Map<string, string>): NativeDriveFile {
  const { uploadedBy, ...rest } = file;
  const by = (uploadedBy ?? '').trim().toLowerCase();
  return {
    ...rest,
    addedBy: space === 'shared' ? (file.mine ? 'You' : (names.get(by) ?? 'Family')) : null,
  };
}

export async function listSpace(caller: AppDriveCaller, space: DriveSpace, folder: string | null) {
  const res = await call('GET', `/api/files/app${query({ space, folder })}`, caller);
  const listing = parse<ListingWire>(res);
  const names = space === 'shared' ? await firstNames(listing.files.map((f) => f.uploadedBy ?? '')) : new Map<string, string>();
  return { ...listing, files: listing.files.map((f) => forPhone(f, space, names)) };
}

export async function uploadFile(
  caller: AppDriveCaller,
  input: { space: DriveSpace; folder: string | null; filename: string | null; mimeType: string; bytes: Buffer },
): Promise<NativeDriveFile> {
  if (input.bytes.byteLength === 0) throw error(400, 'The upload was empty.');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw error(413, `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const path = `/api/files/app/files${query({ space: input.space, folder: input.folder, filename: input.filename, type: input.mimeType })}`;
  // octet-stream on the wire whatever the file is: SvelteKit refuses a
  // text/plain POST without a matching Origin as a cross-site form.
  const res = await call('POST', path, caller, { body: input.bytes, contentType: 'application/octet-stream', timeoutMs: 120_000 });
  const { file } = parse<{ file: DriveFileWire }>(res);
  return forPhone(file, input.space, new Map());
}

export async function makeFolder(caller: AppDriveCaller, space: DriveSpace, parent: string | null, name: string | null) {
  const body = Buffer.from(JSON.stringify({ space, parent: parent ?? '', name }));
  return parse<{ space: DriveSpace; path: string }>(
    await call('POST', '/api/files/app/folders', caller, { body, contentType: 'application/json' }),
  );
}

export async function deleteFolder(caller: AppDriveCaller, space: DriveSpace, folder: string | null) {
  return parse<{ deleted: number }>(await call('DELETE', `/api/files/app/folders${query({ space, folder })}`, caller));
}

export async function deleteOne(caller: AppDriveCaller, id: string): Promise<void> {
  await call('DELETE', `/api/files/app/files/${encodeURIComponent(id)}`, caller);
}

/** The bytes, with the headers Drive set (attachment, sandbox CSP, nosniff). */
export async function download(caller: AppDriveCaller, id: string): Promise<Response> {
  const res = await call('GET', `/api/files/app/files/${encodeURIComponent(id)}`, caller, { timeoutMs: 120_000 });
  const pass = (name: string, fallback?: string) => {
    const v = res.headers[name];
    return (Array.isArray(v) ? v[0] : v) ?? fallback;
  };
  const headers: Record<string, string> = {
    'Content-Type': pass('content-type', 'application/octet-stream')!,
    'Content-Length': String(res.body.byteLength),
    'Content-Security-Policy': 'sandbox',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300',
  };
  const disposition = pass('content-disposition');
  headers['Content-Disposition'] = disposition?.startsWith('attachment') ? disposition : 'attachment';
  return new Response(new Uint8Array(res.body), { status: 200, headers });
}
