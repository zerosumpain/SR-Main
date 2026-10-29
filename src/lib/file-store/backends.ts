// Connected byte stores: where /drive keeps bytes besides the server's own.
//
// The PRIMARY store is whatever the server was started with — the filesystem
// under WORKFLOW_FILES_ROOT, or the Azure container AZURE_STORAGE_CONNECTION_STRING
// names. It is not configurable from the browser and every row written before
// this file existed lives there.
//
// A CONNECTED store is one the owner added on /drive: an Azure Blob container or
// an S3 bucket (AWS, or anything that speaks S3). Its settings live in the
// `app_settings` row `drive.storage`, which both SR-Main and SR-Drive can read —
// that is what lets Main's file tools and Intelligence read a file Drive put
// there. Secrets are sealed with AES-256-GCM under DRIVE_STORAGE_KEY, which must
// be the same in both processes; without it nothing can be connected.
//
// WHERE A FILE LIVES is in its `disk_path`, so no row ever needed a new column:
//   <root>/<uuid>/<name>                  primary
//   <root>/@store/<storeId>/<uuid>/<name>  connected store <storeId>
// The `<uuid>/<name>` tail is the object key inside that store (after the
// store's own optional prefix), and it does not change when a file moves.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';

import { PRIMARY_STORE, STORE_ID } from './location';

export * from './location';
export const SETTINGS_KEY = 'drive.storage';

export type StoreKind = 'azure' | 's3';

export interface AzureStoreConfig {
  /** How the secret authenticates. `connection-string` carries its own account. */
  auth: 'connection-string' | 'account-key' | 'sas';
  accountName?: string;
  container: string;
  /** Blob service URL; blank means https://<account>.blob.core.windows.net. */
  endpoint?: string;
  prefix?: string;
}

export interface S3StoreConfig {
  /** `default-chain` uses the process's AWS credentials (env, profile, instance role). */
  auth: 'access-key' | 'default-chain';
  provider: 'aws' | 's3-compatible';
  bucket: string;
  region: string;
  /** Only for S3-compatible services (MinIO, R2, Wasabi …). */
  endpoint?: string;
  forcePathStyle?: boolean;
  prefix?: string;
}

export interface AzureSecret {
  connectionString?: string;
  accountKey?: string;
  sasToken?: string;
}

export interface S3Secret {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface SealedSecret {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export interface StoreCheck {
  ok: boolean;
  at: string;
  ms: number;
  error?: string;
}

export interface ConnectedStore {
  id: string;
  label: string;
  kind: StoreKind;
  config: AzureStoreConfig | S3StoreConfig;
  secret: SealedSecret | null;
  createdAt: string;
  createdBy: string | null;
  lastCheck?: StoreCheck;
}

export interface StorageSettings {
  version: 1;
  /** Where NEW drive files go: `primary` or a connected store's id. */
  active: string;
  stores: ConnectedStore[];
}

const EMPTY: StorageSettings = { version: 1, active: PRIMARY_STORE, stores: [] };

// ——— sealing secrets ———

function sealingKey(): Buffer | null {
  const raw = process.env.DRIVE_STORAGE_KEY;
  if (!raw || raw.length < 32) return null;
  return createHash('sha256').update(raw).digest();
}

export function canSealSecrets(): boolean {
  return sealingKey() !== null;
}

/** The store id is the AAD, so a sealed secret cannot be pasted onto another store. */
export function sealSecret(storeId: string, secret: object): SealedSecret {
  const key = sealingKey();
  if (!key) throw new Error('DRIVE_STORAGE_KEY is not set (32+ characters), so credentials cannot be stored');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(storeId));
  const data = Buffer.concat([c.update(JSON.stringify(secret), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function openSecret<T>(storeId: string, sealed: SealedSecret | null): T {
  if (!sealed) return {} as T;
  const key = sealingKey();
  if (!key) throw new Error('DRIVE_STORAGE_KEY is not set, so this store’s credentials cannot be read');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  d.setAAD(Buffer.from(storeId));
  d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const plain = Buffer.concat([d.update(Buffer.from(sealed.data, 'base64')), d.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

// ——— the settings row ———

// Short, because a second process (Main, or Drive's other slot) changes it too:
// a store connected in one is usable in the other within this window.
const TTL_MS = 10_000;
let cached: { at: number; value: StorageSettings } | null = null;

function normalise(raw: unknown): StorageSettings {
  const v = raw as Partial<StorageSettings> | null;
  if (!v || v.version !== 1 || !Array.isArray(v.stores)) return { ...EMPTY, stores: [] };
  const stores = v.stores.filter((s) => s && STORE_ID.test(s.id) && (s.kind === 'azure' || s.kind === 's3'));
  const active = stores.some((s) => s.id === v.active) ? (v.active as string) : PRIMARY_STORE;
  return { version: 1, active, stores };
}

export async function loadStorageSettings(fresh = false): Promise<StorageSettings> {
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  const value = normalise(row?.value);
  cached = { at: Date.now(), value };
  return value;
}

export async function saveStorageSettings(next: StorageSettings): Promise<void> {
  const value = normalise(next);
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  cached = { at: Date.now(), value };
  forgetClients();
}

export async function findStore(id: string): Promise<ConnectedStore | null> {
  const s = await loadStorageSettings();
  const hit = s.stores.find((x) => x.id === id);
  if (hit) return hit;
  // A store connected by the other process in the last few seconds.
  const fresh = await loadStorageSettings(true);
  return fresh.stores.find((x) => x.id === id) ?? null;
}

/** Where a new drive file should go. */
export async function activeStoreId(): Promise<string> {
  return (await loadStorageSettings()).active;
}

// Clients are built by ./connected and cached here by store id, so this module
// can drop them whenever the settings change underneath.
const clients = new Map<string, unknown>();
export function cachedClient<T>(id: string, build: () => T): T {
  if (!clients.has(id)) clients.set(id, build());
  return clients.get(id) as T;
}
export function forgetClients(): void {
  clients.clear();
}
