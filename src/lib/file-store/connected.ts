// The byte operations for a connected store (see ./backends), one shape for
// Azure Blob and S3, so ./storage dispatches without knowing which it has.
//
// Every "not found" comes out as an ENOENT-coded error, the same translation
// the primary Azure backend makes: seam consumers branch on `code === 'ENOENT'`
// to answer 410 rather than 500, and must keep doing so whichever store it is.
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type ContainerClient,
} from '@azure/storage-blob';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  cachedClient,
  objectKey,
  openSecret,
  type AzureSecret,
  type AzureStoreConfig,
  type ConnectedStore,
  type S3Secret,
  type S3StoreConfig,
  type StoreKind,
} from './backends';

export interface ByteStore {
  save(key: string, buf: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  append(key: string, buf: Buffer): Promise<number>;
  remove(key: string): Promise<void>;
  size(key: string): Promise<number>;
  saveStream(key: string, r: Readable): Promise<number>;
  readStream(key: string): Promise<Readable>;
  copy(src: string, dst: string): Promise<void>;
}

/** What a connection test did, step by step, so the UI can say which one failed. */
export interface ProbeResult {
  ok: boolean;
  ms: number;
  steps: { step: string; ok: boolean; detail?: string }[];
  error?: string;
}

/** A store's settings before they are saved — what the connect form sends. */
export interface StoreDraft {
  id: string;
  kind: StoreKind;
  config: AzureStoreConfig | S3StoreConfig;
  secret: AzureSecret | S3Secret;
}

function enoent(key: string): NodeJS.ErrnoException {
  const e = new Error(`object "${key}" not found`) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

async function toBuffer(stream: NodeJS.ReadableStream | Readable | undefined | null): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// ——— Azure Blob ———

function azureContainer(cfg: AzureStoreConfig, secret: AzureSecret): ContainerClient {
  const account = (cfg.accountName ?? '').trim();
  const endpoint = (cfg.endpoint ?? '').trim().replace(/\/+$/, '') || (account ? `https://${account}.blob.core.windows.net` : '');
  let service: BlobServiceClient;
  if (cfg.auth === 'connection-string') {
    if (!secret.connectionString) throw new Error('a connection string is required');
    service = BlobServiceClient.fromConnectionString(secret.connectionString);
  } else if (cfg.auth === 'account-key') {
    if (!account || !secret.accountKey) throw new Error('an account name and key are required');
    service = new BlobServiceClient(endpoint, new StorageSharedKeyCredential(account, secret.accountKey));
  } else {
    if (!endpoint || !secret.sasToken) throw new Error('an account (or endpoint) and a SAS token are required');
    service = new BlobServiceClient(`${endpoint}?${secret.sasToken.replace(/^\?/, '')}`);
  }
  return service.getContainerClient(cfg.container);
}

function azureNotFound(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string };
  return e?.statusCode === 404 || e?.code === 'BlobNotFound';
}

function azureStore(cfg: AzureStoreConfig, container: ContainerClient): ByteStore {
  const blob = (key: string) => container.getBlockBlobClient(objectKey(cfg.prefix, key));
  const store: ByteStore = {
    async save(key, buf) {
      await blob(key).uploadData(buf);
    },
    async read(key) {
      try {
        return await blob(key).downloadToBuffer();
      } catch (err) {
        if (azureNotFound(err)) throw enoent(key);
        throw err;
      }
    },
    async append(key, buf) {
      const bb = blob(key);
      for (let attempt = 0; ; attempt++) {
        let existing: Buffer = Buffer.alloc(0);
        let etag: string | undefined;
        try {
          const dl = await bb.download();
          etag = dl.etag;
          existing = await toBuffer(dl.readableStreamBody);
        } catch (err) {
          if (!azureNotFound(err)) throw err;
        }
        const combined = Buffer.concat([existing, buf]);
        try {
          await bb.uploadData(combined, { conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' } });
          return combined.byteLength;
        } catch (err) {
          const s = (err as { statusCode?: number })?.statusCode;
          if ((s === 412 || s === 409) && attempt < 4) continue;
          throw err;
        }
      }
    },
    async remove(key) {
      await blob(key).deleteIfExists();
    },
    async size(key) {
      try {
        return (await blob(key).getProperties()).contentLength ?? 0;
      } catch (err) {
        if (azureNotFound(err)) throw enoent(key);
        throw err;
      }
    },
    async saveStream(key, r) {
      const bb = blob(key);
      await bb.uploadStream(r, 4 * 1024 * 1024, 5);
      return (await bb.getProperties()).contentLength ?? 0;
    },
    async readStream(key) {
      try {
        const body = (await blob(key).download()).readableStreamBody;
        if (!body) throw enoent(key);
        return body as Readable;
      } catch (err) {
        if (azureNotFound(err)) throw enoent(key);
        throw err;
      }
    },
    async copy(src, dst) {
      await store.saveStream(dst, await store.readStream(src));
    },
  };
  return store;
}

// ——— S3 ———

function s3Client(cfg: S3StoreConfig, secret: S3Secret): S3Client {
  const custom = cfg.provider === 's3-compatible';
  return new S3Client({
    region: cfg.region || 'us-east-1',
    endpoint: custom && cfg.endpoint ? cfg.endpoint : undefined,
    forcePathStyle: custom ? (cfg.forcePathStyle ?? true) : false,
    credentials:
      cfg.auth === 'access-key'
        ? {
            accessKeyId: secret.accessKeyId ?? '',
            secretAccessKey: secret.secretAccessKey ?? '',
            sessionToken: secret.sessionToken || undefined,
          }
        : undefined,
    // A wrong region or a dead endpoint should fail the probe, not hang it.
    requestHandler: { requestTimeout: 30_000, connectionTimeout: 8_000 },
    maxAttempts: 3,
  });
}

function s3NotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

function s3Store(cfg: S3StoreConfig, client: S3Client): ByteStore {
  const Bucket = cfg.bucket;
  const k = (key: string) => objectKey(cfg.prefix, key);
  const store: ByteStore = {
    async save(key, buf) {
      await client.send(new PutObjectCommand({ Bucket, Key: k(key), Body: buf }));
    },
    async read(key) {
      return toBuffer(await store.readStream(key));
    },
    async append(key, buf) {
      // S3 has no append. Conditional writes make the read-modify-write safe
      // where the service supports them (AWS does); a service that rejects the
      // condition outright gets a plain write, the same race a filesystem
      // without O_APPEND would have.
      for (let attempt = 0; ; attempt++) {
        let existing: Buffer = Buffer.alloc(0);
        let etag: string | undefined;
        try {
          const got = await client.send(new GetObjectCommand({ Bucket, Key: k(key) }));
          etag = got.ETag;
          existing = await toBuffer(got.Body as Readable);
        } catch (err) {
          if (!s3NotFound(err)) throw err;
        }
        const combined = Buffer.concat([existing, buf]);
        try {
          await client.send(
            new PutObjectCommand({
              Bucket,
              Key: k(key),
              Body: combined,
              ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
            }),
          );
          return combined.byteLength;
        } catch (err) {
          const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
          if ((status === 412 || status === 409) && attempt < 4) continue;
          if (status === 501) {
            await client.send(new PutObjectCommand({ Bucket, Key: k(key), Body: combined }));
            return combined.byteLength;
          }
          throw err;
        }
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: k(key) }));
    },
    async size(key) {
      try {
        return (await client.send(new HeadObjectCommand({ Bucket, Key: k(key) }))).ContentLength ?? 0;
      } catch (err) {
        if (s3NotFound(err)) throw enoent(key);
        throw err;
      }
    },
    async saveStream(key, r) {
      // Multipart in 8 MB parts, so a large file never sits whole in memory.
      await new Upload({ client, params: { Bucket, Key: k(key), Body: r }, partSize: 8 * 1024 * 1024, queueSize: 4 }).done();
      return store.size(key);
    },
    async readStream(key) {
      try {
        const got = await client.send(new GetObjectCommand({ Bucket, Key: k(key) }));
        if (!got.Body) throw enoent(key);
        return got.Body as Readable;
      } catch (err) {
        if (s3NotFound(err)) throw enoent(key);
        throw err;
      }
    },
    async copy(src, dst) {
      // Server-side: the bytes never come through this process.
      await client.send(
        new CopyObjectCommand({ Bucket, Key: k(dst), CopySource: `${Bucket}/${k(src).split('/').map(encodeURIComponent).join('/')}` }),
      );
    },
  };
  return store;
}

// ——— building one ———

function build(draft: StoreDraft): { store: ByteStore; ensure: () => Promise<'exists' | 'created'>; exists: () => Promise<boolean> } {
  if (draft.kind === 'azure') {
    const cfg = draft.config as AzureStoreConfig;
    const container = azureContainer(cfg, draft.secret as AzureSecret);
    return {
      store: azureStore(cfg, container),
      exists: () => container.exists(),
      ensure: async () => ((await container.createIfNotExists()).succeeded ? 'created' : 'exists'),
    };
  }
  const cfg = draft.config as S3StoreConfig;
  const client = s3Client(cfg, draft.secret as S3Secret);
  const exists = async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
      return true;
    } catch (err) {
      if (s3NotFound(err)) return false;
      throw err;
    }
  };
  return {
    store: s3Store(cfg, client),
    exists,
    ensure: async () => {
      if (await exists()) return 'exists';
      const region = cfg.region || 'us-east-1';
      await client.send(
        new CreateBucketCommand({
          Bucket: cfg.bucket,
          // us-east-1 is the one region that must NOT be named.
          ...(cfg.provider === 'aws' && region !== 'us-east-1'
            ? { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }
            : {}),
        }),
      );
      return 'created';
    },
  };
}

/** The live byte store for a saved connected store. */
export function storeFor(saved: ConnectedStore): ByteStore {
  const fingerprint = `${saved.id}:${saved.secret?.iv ?? '-'}:${JSON.stringify(saved.config)}`;
  return cachedClient(fingerprint, () => {
    const secret = openSecret<AzureSecret & S3Secret>(saved.id, saved.secret);
    return build({ id: saved.id, kind: saved.kind, config: saved.config, secret }).store;
  });
}

// What an HTTP status means when the response had no body to say so — S3's
// HEAD requests never do, so without this a wrong region reads "UnknownError".
const STATUS_MEANS: Record<number, string> = {
  301: 'the bucket is in a different region — check the region',
  400: 'the service rejected the request — check the region and endpoint',
  403: 'access denied — check the credential and what it is allowed to do',
  404: 'not found — check the bucket or container name',
};

function why(err: unknown): string {
  const e = err as { name?: string; message?: string; code?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const status = e?.$metadata?.httpStatusCode;
  const opaque = !e?.message || e.message === 'UnknownError' || e.name === 'UnknownError' || e.message === e.name;
  if (status && opaque && STATUS_MEANS[status]) return `${STATUS_MEANS[status]} (HTTP ${status})`;
  const raw = e?.message || e?.Code || e?.code || e?.name || String(err);
  // Never echo anything that looks like a credential back to the browser.
  return raw.replace(/(AccountKey|SharedAccessSignature|sig|Signature|X-Amz-Credential)=[^;&\s]+/gi, '$1=…').slice(0, 300);
}

/**
 * Prove a store works end to end: reach the container, optionally create it,
 * then write, read back, compare and delete a small object under the store's
 * prefix. Nothing is saved; the probe object is removed even when a later
 * step fails.
 */
export async function probeStore(draft: StoreDraft, opts: { create?: boolean } = {}): Promise<ProbeResult> {
  const started = Date.now();
  const steps: ProbeResult['steps'] = [];
  const fail = (step: string, err: unknown): ProbeResult => {
    const detail = why(err);
    steps.push({ step, ok: false, detail });
    return { ok: false, ms: Date.now() - started, steps, error: `${step}: ${detail}` };
  };
  let built: ReturnType<typeof build>;
  try {
    built = build(draft);
    steps.push({ step: 'configure', ok: true });
  } catch (err) {
    return fail('configure', err);
  }
  const what = draft.kind === 'azure' ? 'container' : 'bucket';
  try {
    if (opts.create) {
      const r = await built.ensure();
      steps.push({ step: `${what} ${r === 'created' ? 'created' : 'found'}`, ok: true });
    } else if (await built.exists()) {
      steps.push({ step: `${what} found`, ok: true });
    } else {
      return fail(`${what} found`, new Error(`the ${what} does not exist — create it, or tick “create it for me”`));
    }
  } catch (err) {
    return fail(`reach ${what}`, err);
  }
  const key = `.sr-drive-probe/${randomUUID()}`;
  const body = Buffer.from(`sr-drive probe ${new Date().toISOString()}`);
  try {
    await built.store.save(key, body);
    steps.push({ step: 'write', ok: true });
  } catch (err) {
    return fail('write', err);
  }
  try {
    const back = await built.store.read(key);
    if (!back.equals(body)) throw new Error('the bytes read back differ from those written');
    steps.push({ step: 'read back', ok: true });
  } catch (err) {
    await built.store.remove(key).catch(() => {});
    return fail('read back', err);
  }
  try {
    await built.store.remove(key);
    steps.push({ step: 'delete', ok: true });
  } catch (err) {
    return fail('delete', err);
  }
  return { ok: true, ms: Date.now() - started, steps };
}

/** Probe a saved store with its sealed credentials. */
export async function probeSaved(saved: ConnectedStore): Promise<ProbeResult> {
  let secret: AzureSecret & S3Secret;
  try {
    secret = openSecret(saved.id, saved.secret);
  } catch (err) {
    return { ok: false, ms: 0, steps: [{ step: 'unseal credentials', ok: false, detail: why(err) }], error: why(err) };
  }
  return probeStore({ id: saved.id, kind: saved.kind, config: saved.config, secret });
}
