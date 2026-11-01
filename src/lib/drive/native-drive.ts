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

import { error, isHttpError, json } from '@sveltejs/kit';
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

/** `scripts/server-with-ws.mjs` sets `BODY_SIZE_LIMIT ??= '12M'`; the same default here. */
const DEFAULT_BODY_LIMIT = '12M';

/**
 * Main's own request-body limit, in bytes, read the way adapter-node reads
 * `BODY_SIZE_LIMIT` (a number, optionally K/M/G in powers of 1024; `Infinity`
 * for none). Unreadable means the default, never "no limit".
 *
 * Why the phone needs it: a body over this limit is refused by SvelteKit
 * before any handler runs, so a 20 MB photo against a 12M limit failed with a
 * bare 413 instead of the friendly one — the phone believed Drive's 30 MB.
 */
export function bodyLimitBytes(raw: string | undefined = process.env.BODY_SIZE_LIMIT): number {
  const parse = (v: string): number | null => {
    const t = v.trim();
    if (/^infinity$/i.test(t)) return Number.POSITIVE_INFINITY;
    const m = /^(\d+(?:\.\d+)?)\s*([KMG])?$/i.exec(t);
    if (!m) return null;
    const mult = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'G'] ?? 1;
    const n = Math.floor(Number(m[1]) * mult);
    return n > 0 ? n : null;
  };
  return (raw ? parse(raw) : null) ?? parse(DEFAULT_BODY_LIMIT)!;
}

/** The largest file the phone may send through Main: Drive's figure, held to Main's own limits. */
export function clampUploadBytes(driveValue: number, bodyLimit: number = bodyLimitBytes()): number {
  const drive = Number.isFinite(driveValue) && driveValue > 0 ? driveValue : MAX_UPLOAD_BYTES;
  return Math.max(0, Math.min(drive, MAX_UPLOAD_BYTES, bodyLimit));
}

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

type CallOptions = { body?: Buffer; contentType?: string; timeoutMs?: number };

/** One request to Drive, answered with any status; only an unreachable Drive throws (502). */
async function send(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  caller: AppDriveCaller,
  options: CallOptions = {},
): Promise<RawExtractedResponse> {
  try {
    return await requestExtracted('drive', method, path, {
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
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  caller: AppDriveCaller,
  options: CallOptions = {},
): Promise<RawExtractedResponse> {
  const res = await send(method, path, caller, options);
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
  /** Chunked uploads (a Drive that has them): the largest file, and the piece size. */
  maxLargeUploadBytes?: number;
  chunkBytes?: number;
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
  const { maxLargeUploadBytes, chunkBytes, ...rest } = listing;
  return {
    ...rest,
    files: listing.files.map((f) => forPhone(f, space, names)),
    maxUploadBytes: clampUploadBytes(listing.maxUploadBytes),
    ...chunkedLimits(maxLargeUploadBytes, chunkBytes),
  };
}

/** The most Main relays in one chunk PUT: the contract's 8 MiB piece. */
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * The chunked lane's figures for the phone, or nothing. Their absence is how
 * the app knows the lane is unavailable — an older Drive that does not send
 * them, or a piece Main could not relay (over 8 MiB or over its body limit).
 */
export function chunkedLimits(
  maxLargeUploadBytes: unknown,
  chunkBytes: unknown,
  bodyLimit: number = bodyLimitBytes(),
): { maxLargeUploadBytes?: number; chunkBytes?: number } {
  if (!positiveInt(maxLargeUploadBytes) || !positiveInt(chunkBytes)) return {};
  if (chunkBytes > Math.min(MAX_CHUNK_BYTES, bodyLimit)) return {};
  return { maxLargeUploadBytes, chunkBytes };
}

/** `sha256` as Drive accepts it: absent, or 64 hex characters (lower-cased). */
export function parseSha256(raw: string | null | undefined): string | null | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return null;
  return /^[0-9a-f]{64}$/.test(v) ? v : undefined;
}

/** `takenAt` as an ISO-looking date-time, or nothing: it only ever names a photo. */
export function parseTakenAt(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || v.length > 40) return null;
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}

export async function uploadFile(
  caller: AppDriveCaller,
  input: {
    space: DriveSpace;
    folder: string | null;
    filename: string | null;
    mimeType: string;
    bytes: Buffer;
    /** The phone's hash of the bytes: Drive verifies it, and answers an existing file for the same bytes. */
    sha256?: string | null;
    /** When the photo was taken: names an unnamed or `IMG_…` image. */
    takenAt?: string | null;
  },
): Promise<{ file: NativeDriveFile; duplicate: boolean }> {
  if (input.bytes.byteLength === 0) throw error(400, 'The upload was empty.');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw error(413, `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const sha256 = parseSha256(input.sha256);
  if (sha256 === undefined) throw error(400, 'sha256 must be 64 hex characters.');
  const path = `/api/files/app/files${query({
    space: input.space,
    folder: input.folder,
    filename: input.filename,
    type: input.mimeType,
    sha256,
    takenAt: parseTakenAt(input.takenAt),
  })}`;
  // octet-stream on the wire whatever the file is: SvelteKit refuses a
  // text/plain POST without a matching Origin as a cross-site form.
  const res = await call('POST', path, caller, { body: input.bytes, contentType: 'application/octet-stream', timeoutMs: 120_000 });
  const { file, duplicate } = parse<{ file: DriveFileWire; duplicate?: boolean }>(res);
  // 200 + duplicate:true is "already safely stored"; only that or a 201 lets
  // the phone's "move from phone" delete the original.
  return { file: forPhone(file, input.space, new Map()), duplicate: duplicate === true && res.status === 200 };
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

// ── The phone's Info screen, rename/move, search and jkai (build map §2.2) ──

/**
 * What jkai concluded about one file (build map §2.3) — the same wire shape in
 * Drive, here, Core and the app. Passed through as Drive sent it.
 */
export interface FileAnalysis {
  fileId: string;
  contentHash: string | null;
  source: 'drive' | 'mail-rule';
  model: string;
  summary: string;
  docType: string;
  keyFacts: { label: string; value: string }[];
  dates: { label: string; date: string }[];
  amounts: { label: string; value: number; currency: string }[];
  actionNeeded: string | null;
  createdAt: string;
}

export interface IntelStatus {
  status: string;
  outcome: string | null;
  entityCount: number;
  attempts?: number;
  error?: string | null;
}

interface MetaWire {
  file: DriveFileWire & { folder: string; description: string | null };
  analysis: FileAnalysis | null;
  intel: { status: string; outcome: string | null; entityCount: number } | null;
  mail: { from: string; subject: string | null; receivedAt: string } | null;
}

export interface NativeDriveMeta {
  file: NativeDriveFile & { folder: string; description: string | null };
  analysis: FileAnalysis | null;
  intel: { status: string; outcome: string | null; entityCount: number } | null;
  mail: { from: string; subject: string | null; receivedAt: string } | null;
}

const OWNER_ONLY_JKAI = 'Only the owner can use jkai on files.';

/** jkai on files is the owner's, from his own phone — never a member's, nor the owner viewing as one. */
function requireOwner(caller: AppDriveCaller): void {
  if (caller.kind !== 'owner') throw error(403, OWNER_ONLY_JKAI);
}

/** A sender as the phone may show them: a name, or the domain — never the address. */
export function senderForPhone(from: string): string {
  const v = (from ?? '').trim();
  if (!v.includes('@')) return v.slice(0, 120) || 'Unknown sender';
  const domain = v.split('@').pop()?.replace(/[>\s].*$/, '').trim();
  return domain || 'Unknown sender';
}

async function namesFor(space: DriveSpace, files: DriveFileWire[]): Promise<Map<string, string>> {
  return space === 'shared' ? firstNames(files.map((f) => f.uploadedBy ?? '')) : new Map<string, string>();
}

/** GET files/:id/meta — Drive decides what a member sees; Main still never passes jkai fields to one. */
export async function fileMeta(caller: AppDriveCaller, id: string, space: DriveSpace): Promise<NativeDriveMeta> {
  const res = await call('GET', `/api/files/app/files/${encodeURIComponent(id)}/meta${query({ space })}`, caller);
  const meta = parse<MetaWire>(res);
  const names = await namesFor(space, [meta.file]);
  const file = forPhone(meta.file, space, names) as NativeDriveMeta['file'];
  if (caller.kind !== 'owner') return { file, analysis: null, intel: null, mail: null };
  return {
    file,
    analysis: meta.analysis ?? null,
    intel: meta.intel ?? null,
    mail: meta.mail ? { from: senderForPhone(meta.mail.from), subject: meta.mail.subject ?? null, receivedAt: meta.mail.receivedAt } : null,
  };
}

/** PATCH files/:id `{space, name?, folder?}` — rename and/or move within the space. */
export async function renameOrMove(
  caller: AppDriveCaller,
  id: string,
  input: { space: DriveSpace; name?: string | null; folder?: string | null },
): Promise<{ file: NativeDriveFile }> {
  const name = typeof input.name === 'string' ? input.name.trim() : null;
  const folder = typeof input.folder === 'string' ? input.folder : null;
  if (!name && folder === null) throw error(400, 'Say a new name or a folder.');
  if (name && name.length > 255) throw error(400, 'That name is too long.');
  const body: Record<string, string> = { space: input.space };
  if (name) body.name = name;
  if (folder !== null) body.folder = folder;
  const res = await call('PATCH', `/api/files/app/files/${encodeURIComponent(id)}`, caller, {
    body: Buffer.from(JSON.stringify(body)),
    contentType: 'application/json',
  });
  const { file } = parse<{ file: DriveFileWire }>(res);
  return { file: forPhone(file, input.space, await namesFor(input.space, [file])) };
}

export const SEARCH_MAX_QUERY = 200;

/** GET search — names for everyone; contents hits for the owner, in his own space only. */
export async function searchSpace(caller: AppDriveCaller, space: DriveSpace, rawQ: string | null) {
  const q = (rawQ ?? '').trim();
  if (!q) throw error(400, 'Say what to look for.');
  if (q.length > SEARCH_MAX_QUERY) throw error(400, `Keep the search under ${SEARCH_MAX_QUERY} characters.`);
  const res = await call('GET', `/api/files/app/search${query({ space, q })}`, caller, { timeoutMs: 20_000 });
  const wire = parse<{ files: DriveFileWire[]; semantic?: { file: DriveFileWire; score: number; passage: string }[] }>(res);
  const files = (wire.files ?? []).slice(0, 100);
  const semanticWire = caller.kind === 'owner' && space === 'mine' ? (wire.semantic ?? []) : [];
  const names = await namesFor(space, [...files, ...semanticWire.map((s) => s.file)]);
  const out: {
    files: NativeDriveFile[];
    semantic?: { file: NativeDriveFile; score: number; passage: string }[];
  } = { files: files.map((f) => forPhone(f, space, names)) };
  if (caller.kind === 'owner' && space === 'mine') {
    out.semantic = semanticWire.map((s) => ({
      file: forPhone(s.file, space, names),
      score: s.score,
      passage: String(s.passage ?? '').slice(0, 300),
    }));
  }
  return out;
}

/** POST files/:id/analyse `{refresh?}` — jkai's summary. Owner only; the model call can take a while. */
export async function analyseFile(caller: AppDriveCaller, id: string, refresh: boolean): Promise<FileAnalysis> {
  requireOwner(caller);
  const res = await call('POST', `/api/files/app/files/${encodeURIComponent(id)}/analyse`, caller, {
    body: Buffer.from(JSON.stringify({ refresh: refresh === true })),
    contentType: 'application/json',
    timeoutMs: 120_000,
  });
  return parse<FileAnalysis>(res);
}

/** POST files/:id/intel — queue "Extract entities". Owner only; Drive answers 202. */
export async function intelFile(caller: AppDriveCaller, id: string): Promise<{ jobId: number; status: 'queued' }> {
  requireOwner(caller);
  const res = await call('POST', `/api/files/app/files/${encodeURIComponent(id)}/intel`, caller, {
    body: Buffer.from('{}'),
    contentType: 'application/json',
    timeoutMs: 75_000,
  });
  const { jobId, status } = parse<{ jobId: number; status: 'queued' }>(res);
  return { jobId, status };
}

/** GET files/:id/intel?job= — that job's state. Owner only; never the note id. */
export async function intelStatus(caller: AppDriveCaller, id: string, job: number | null): Promise<IntelStatus> {
  requireOwner(caller);
  const res = await call('GET', `/api/files/app/files/${encodeURIComponent(id)}/intel${query({ job: job === null ? null : String(job) })}`, caller);
  const { noteId: _noteId, ...rest } = parse<IntelStatus & { noteId?: unknown }>(res);
  return rest;
}

// ── Resumable chunked uploads (chunked-uploads contract, "Main relays") ──
//
// Above the single-shot limit the phone opens a session, sends 8 MiB pieces at
// `offset=received`, and completes. Main relays each step unchanged to Drive's
// /api/files/app/uploads; Drive stages, verifies the hash and stores. These
// relays answer a Response rather than throwing: a 409 carries `received` (where
// the phone resumes), which `withNativeAccess`'s `{error}` mapping would drop.

/** Drive's upload ids: 32 random hex. Anything else is no session, before Drive is asked. */
export function parseUploadId(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(v) ? v : null;
}

const NO_SESSION = 'That upload is not there any more. Start it again.';

function uploadPath(id: string, tail = ''): string {
  return `/api/files/app/uploads/${encodeURIComponent(id)}${tail}`;
}

/**
 * Drive's refusal as the phone hears every other one — `{error}` in Drive's
 * words and status — plus `received` when Drive sent it. A 401 is the service
 * lane's, never the phone's, so it is a 502.
 */
function uploadRefusal(res: RawExtractedResponse): Response {
  let message = 'Drive is not answering. Try again.';
  let received: number | undefined;
  try {
    const body = JSON.parse(res.body.toString('utf8')) as { message?: string; error?: string; received?: unknown };
    message = body.message || body.error || message;
    if (typeof body.received === 'number' && Number.isSafeInteger(body.received) && body.received >= 0) received = body.received;
  } catch {
    /* keep the plain sentence */
  }
  const status = res.status >= 400 && res.status < 600 && res.status !== 401 ? res.status : 502;
  return json(received === undefined ? { error: message } : { error: message, received }, { status });
}

async function relay(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  caller: AppDriveCaller,
  options: CallOptions = {},
): Promise<{ res: RawExtractedResponse } | { refused: Response }> {
  const res = await send(method, path, caller, options);
  if (res.status < 200 || res.status >= 300) return { refused: uploadRefusal(res) };
  return { res };
}

interface UploadSessionWire {
  uploadId: string;
  received: number;
  size: number;
  chunkBytes: number;
  expiresAt: string;
}

function sessionForPhone(s: UploadSessionWire): UploadSessionWire {
  return { uploadId: s.uploadId, received: s.received, size: s.size, chunkBytes: s.chunkBytes, expiresAt: s.expiresAt };
}

/** A stored file, as the single-shot upload answers it: 201 new, 200 + duplicate:true already there. */
function storedForPhone(res: RawExtractedResponse, space: DriveSpace): Response {
  const { file, duplicate } = parse<{ file: DriveFileWire; duplicate?: boolean }>(res);
  const dup = duplicate === true && res.status === 200;
  return json({ file: forPhone(file, space, new Map()), duplicate: dup }, { status: dup ? 200 : 201 });
}

export interface StartUploadInput {
  space: DriveSpace;
  folder: unknown;
  filename: unknown;
  type: unknown;
  size: unknown;
  sha256: unknown;
  takenAt?: unknown;
}

/**
 * POST uploads — open a session. 201 the session; 200 `{file, duplicate:true}`
 * when these bytes are already in the space (nothing to send). Drive decides
 * the limits (413), its disk (507) and how many sessions are open (429).
 */
export async function startUpload(caller: AppDriveCaller, input: StartUploadInput): Promise<Response> {
  const size = input.size;
  if (!positiveInt(size)) throw error(400, 'size must be a whole number of bytes.');
  const sha256 = parseSha256(typeof input.sha256 === 'string' ? input.sha256 : null);
  if (!sha256) throw error(400, 'sha256 must be 64 hex characters.');
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const body: Record<string, unknown> = {
    folder: str(input.folder, 1024),
    filename: str(input.filename, 255),
    type: str(input.type, 120) || 'application/octet-stream',
    size,
    sha256,
  };
  const takenAt = parseTakenAt(typeof input.takenAt === 'string' ? input.takenAt : null);
  if (takenAt) body.takenAt = takenAt;
  const out = await relay('POST', `/api/files/app/uploads${query({ space: input.space })}`, caller, {
    body: Buffer.from(JSON.stringify(body)),
    contentType: 'application/json',
  });
  if ('refused' in out) return out.refused;
  if (out.res.status === 200) return storedForPhone(out.res, input.space);
  return json(sessionForPhone(parse<UploadSessionWire>(out.res)), { status: 201 });
}

/** GET uploads/:id — how far it got. 404 for unknown, expired, or not this caller's. */
export async function uploadStatus(caller: AppDriveCaller, rawId: string, space: DriveSpace): Promise<Response> {
  const id = parseUploadId(rawId);
  if (!id) throw error(404, NO_SESSION);
  const out = await relay('GET', `${uploadPath(id)}${query({ space })}`, caller);
  if ('refused' in out) return out.refused;
  return json(sessionForPhone(parse<UploadSessionWire>(out.res)));
}

/** PUT uploads/:id?offset= — one piece, relayed unchanged. 409 `{received}` when the offset is not where Drive is. */
export async function putChunk(
  caller: AppDriveCaller,
  rawId: string,
  input: { space: DriveSpace; offset: string | null; bytes: Buffer },
): Promise<Response> {
  const id = parseUploadId(rawId);
  if (!id) throw error(404, NO_SESSION);
  const offset = Number(input.offset ?? '');
  if (input.offset === null || input.offset.trim() === '' || !Number.isSafeInteger(offset) || offset < 0) {
    throw error(400, 'offset must be a whole number of bytes.');
  }
  if (input.bytes.byteLength === 0) throw error(400, 'The piece was empty.');
  if (input.bytes.byteLength > MAX_CHUNK_BYTES) throw error(413, `A piece is at most ${MAX_CHUNK_BYTES / 1024 / 1024} MB.`);
  const out = await relay('PUT', `${uploadPath(id)}${query({ space: input.space, offset: String(offset) })}`, caller, {
    body: input.bytes,
    contentType: 'application/octet-stream',
    timeoutMs: 120_000,
  });
  if ('refused' in out) return out.refused;
  const { received } = parse<{ received: number }>(out.res);
  return json({ received });
}

/** DELETE uploads/:id — give up; Drive removes the staged bytes. */
export async function cancelUpload(caller: AppDriveCaller, rawId: string, space: DriveSpace): Promise<Response> {
  const id = parseUploadId(rawId);
  if (!id) throw error(404, NO_SESSION);
  const out = await relay('DELETE', `${uploadPath(id)}${query({ space })}`, caller);
  if ('refused' in out) return out.refused;
  return json({ ok: true });
}

/**
 * POST uploads/:id/complete — Drive hashes the staged file and stores it.
 * 201 `{file, duplicate:false}` or 200 `{file, duplicate:true}` (also a repeat
 * complete): only those let "move from phone" delete the original. 409
 * `{received}` when pieces are missing; 422 when the hash did not match.
 * Streaming a 4 GiB file into the store takes minutes, hence the long wait —
 * and a timed-out complete is safe to repeat.
 */
export async function completeUpload(caller: AppDriveCaller, rawId: string, space: DriveSpace): Promise<Response> {
  const id = parseUploadId(rawId);
  if (!id) throw error(404, NO_SESSION);
  const out = await relay('POST', `${uploadPath(id, '/complete')}${query({ space })}`, caller, {
    body: Buffer.from('{}'),
    contentType: 'application/json',
    timeoutMs: 600_000,
  });
  if ('refused' in out) return out.refused;
  return storedForPhone(out.res, space);
}
