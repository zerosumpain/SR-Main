// Shared Azure Blob Storage primitives for homeserv's storage backends
// (/drive file store, jkai media store, and future services). Each store binds
// its own container name and exposes only the surface it needs. Enabled solely
// when AZURE_STORAGE_CONNECTION_STRING is set, so local/homeserv dev stays on fs.
import { BlobServiceClient, type ContainerClient, type BlockBlobClient } from '@azure/storage-blob';
import type { Readable } from 'node:stream';

export function isAzureStorageEnabled(): boolean {
  return !!process.env.AZURE_STORAGE_CONNECTION_STRING;
}

const _containers = new Map<string, ContainerClient>();
function container(name: string): ContainerClient {
  let c = _containers.get(name);
  if (c) return c;
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
  c = BlobServiceClient.fromConnectionString(conn).getContainerClient(name);
  _containers.set(name, c);
  return c;
}
function block(containerName: string, blobName: string): BlockBlobClient {
  return container(containerName).getBlockBlobClient(blobName);
}

function isNotFound(err: unknown): boolean {
  const code = (err as { statusCode?: number; code?: string })?.statusCode;
  return code === 404 || (err as { code?: string })?.code === 'BlobNotFound';
}
function isPreconditionFailed(err: unknown): boolean {
  const s = (err as { statusCode?: number })?.statusCode;
  return s === 412 || s === 409;
}
// Translate an Azure "not found" into an ENOENT-coded error so seam consumers
// that branch on `err.code === 'ENOENT'` keep working across the fs→Azure switch.
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

export async function azUploadBuffer(containerName: string, blobName: string, buf: Buffer): Promise<void> {
  await block(containerName, blobName).uploadData(buf);
}

export async function azDownloadBuffer(containerName: string, blobName: string): Promise<Buffer> {
  try {
    return await block(containerName, blobName).downloadToBuffer();
  } catch (err) {
    if (isNotFound(err)) throw enoent(blobName);
    throw err;
  }
}

// Append with optimistic concurrency: mirror fs O_APPEND atomicity by
// conditioning the re-upload on the ETag we read (ifMatch), or on absence
// (ifNoneMatch '*'). A racing writer bumps the ETag → 412/409 → retry.
export async function azAppendBuffer(containerName: string, blobName: string, buf: Buffer): Promise<number> {
  const bb = block(containerName, blobName);
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
      await bb.uploadData(combined, { conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' } });
      return combined.byteLength;
    } catch (err) {
      if (isPreconditionFailed(err) && attempt < 4) continue;
      throw err;
    }
  }
}

export async function azDelete(containerName: string, blobName: string): Promise<void> {
  await block(containerName, blobName).deleteIfExists();
}

export async function azSize(containerName: string, blobName: string): Promise<number> {
  try {
    const props = await block(containerName, blobName).getProperties();
    return props.contentLength ?? 0;
  } catch (err) {
    if (isNotFound(err)) throw enoent(blobName);
    throw err;
  }
}

export async function azExists(containerName: string, blobName: string): Promise<boolean> {
  return block(containerName, blobName).exists();
}

export async function azUploadStream(containerName: string, blobName: string, readable: Readable): Promise<number> {
  const bb = block(containerName, blobName);
  // 4 MB blocks, up to 5 concurrent — streams without buffering the whole file.
  await bb.uploadStream(readable, 4 * 1024 * 1024, 5);
  const props = await bb.getProperties();
  return props.contentLength ?? 0;
}

export async function azDownloadStream(containerName: string, blobName: string): Promise<Readable> {
  let resp;
  try {
    resp = await block(containerName, blobName).download();
  } catch (err) {
    if (isNotFound(err)) throw enoent(blobName);
    throw err;
  }
  const body = resp.readableStreamBody;
  if (!body) throw enoent(blobName);
  return body as Readable;
}

// Same-account server-side copy would need a SAS token; a stream copy is simpler
// and cheap at these volumes.
export async function azCopy(containerName: string, srcBlobName: string, dstBlobName: string): Promise<void> {
  const src = await azDownloadStream(containerName, srcBlobName);
  await azUploadStream(containerName, dstBlobName, src);
}
