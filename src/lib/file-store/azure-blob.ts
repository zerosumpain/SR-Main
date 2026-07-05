// Azure Blob Storage backend for the /drive file store.
//
// This module is intentionally "dumb": it takes an opaque blob *name* (the
// storage key) and moves bytes. The dispatcher in ./storage.ts owns the
// fs-vs-Azure decision and derives the blob name from a WorkflowFile.diskPath
// (its path relative to storeRoot()), so the Postgres `workflow_files` rows and
// the /drive UX are unchanged by the migration.
//
// Enabled only when AZURE_STORAGE_CONNECTION_STRING is set — so local/homeserv
// dev stays on the filesystem backend and only prod (VPS) talks to Azure.
import {
  BlobServiceClient,
  type ContainerClient,
  type BlockBlobClient,
} from '@azure/storage-blob';
import type { Readable } from 'node:stream';

const DEFAULT_CONTAINER = 'drive';

let _container: ContainerClient | null = null;

export function isAzureStorageEnabled(): boolean {
  return !!process.env.AZURE_STORAGE_CONNECTION_STRING;
}

function container(): ContainerClient {
  if (_container) return _container;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
  const name = process.env.AZURE_BLOB_CONTAINER || DEFAULT_CONTAINER;
  _container = BlobServiceClient.fromConnectionString(conn).getContainerClient(name);
  return _container;
}

function block(blobName: string): BlockBlobClient {
  return container().getBlockBlobClient(blobName);
}

function isNotFound(err: unknown): boolean {
  const code = (err as { statusCode?: number; code?: string })?.statusCode;
  return code === 404 || (err as { code?: string })?.code === 'BlobNotFound';
}

function isPreconditionFailed(err: unknown): boolean {
  const s = (err as { statusCode?: number })?.statusCode;
  return s === 412 || s === 409;
}

// Translate an Azure "not found" into an ENOENT-coded error, so seam consumers
// that branch on `err.code === 'ENOENT'` (e.g. the download route's 410) keep
// working unchanged across the fs→Azure switch.
function enoent(blobName: string): NodeJS.ErrnoException {
  const e = new Error(`blob "${blobName}" not found`) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

async function streamToBuffer(stream: NodeJS.ReadableStream | undefined): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function azSaveBuffer(blobName: string, buf: Buffer): Promise<void> {
  await block(blobName).uploadData(buf);
}

export async function azReadBuffer(blobName: string): Promise<Buffer> {
  try {
    return await block(blobName).downloadToBuffer();
  } catch (err) {
    if (isNotFound(err)) throw enoent(blobName);
    throw err;
  }
}

// Append is used only by workflow file-store/file-ops nodes (small logs/csv).
// Blob has no cheap block-blob append, so read-concat-rewrite, but guarded with
// optimistic concurrency: fs append is atomic via O_APPEND, so mirror that by
// conditioning the re-upload on the ETag we read (ifMatch), or on the blob's
// absence (ifNoneMatch '*'). A concurrent writer that beat us bumps the ETag →
// 412/409 → retry with the fresh content. Keeps every object a plain block blob.
export async function azAppendBuffer(blobName: string, buf: Buffer): Promise<number> {
  const bb = block(blobName);
  for (let attempt = 0; ; attempt++) {
    let existing: Buffer = Buffer.alloc(0);
    let etag: string | undefined;
    try {
      const dl = await bb.download();
      etag = dl.etag;
      existing = await streamToBuffer(dl.readableStreamBody);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    const combined = Buffer.concat([existing, buf]);
    try {
      await bb.uploadData(combined, {
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
      });
      return combined.byteLength;
    } catch (err) {
      if (isPreconditionFailed(err) && attempt < 4) continue;
      throw err;
    }
  }
}

export async function azDelete(blobName: string): Promise<void> {
  await block(blobName).deleteIfExists();
}

export async function azSize(blobName: string): Promise<number> {
  try {
    const props = await block(blobName).getProperties();
    return props.contentLength ?? 0;
  } catch (err) {
    if (isNotFound(err)) throw enoent(blobName);
    throw err;
  }
}

export async function azExists(blobName: string): Promise<boolean> {
  return block(blobName).exists();
}

export async function azSaveStream(blobName: string, readable: Readable): Promise<number> {
  const bb = block(blobName);
  // 4 MB blocks, up to 5 concurrent — streams without buffering the whole file.
  await bb.uploadStream(readable, 4 * 1024 * 1024, 5);
  const props = await bb.getProperties();
  return props.contentLength ?? 0;
}

export async function azReadStream(blobName: string): Promise<Readable> {
  let resp;
  try {
    resp = await block(blobName).download();
  } catch (err) {
    if (isNotFound(err)) throw enoent(blobName);
    throw err;
  }
  const body = resp.readableStreamBody;
  if (!body) throw enoent(blobName);
  return body as Readable;
}

// Same-account server-side copy would need a SAS token; at /drive's scale a
// stream copy (download → upload) is simpler and avoids minting credentials.
export async function azCopy(srcBlobName: string, dstBlobName: string): Promise<void> {
  const src = await azReadStream(srcBlobName);
  await azSaveStream(dstBlobName, src);
}
