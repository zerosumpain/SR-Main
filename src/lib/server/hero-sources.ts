import { db } from '$lib/db';
import { appSettings, workflowFiles } from '$lib/db/schema';
import { eq, ilike, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDiskPath, readBuffer, saveBuffer, deleteFile } from '$lib/file-store/storage';
import { getSetting } from '$lib/server/models/settings';
import { encodeHero, requireHeroEncoder } from './hero-encode';
import { isHeroSource } from './hero-source-policy';
import type { HeroBackgroundAsset, HeroPreparationJob } from '$lib/constants/hero-background';

import { HERO_SLOTS, type HeroSlot } from '$lib/constants/hero-slots';

const ACTIVE = 'landing.hero.selected';
const slotKey = (slot: HeroSlot) => slot === 'default' ? ACTIVE : `landing.hero.slot.${slot}`;
const JOB = 'landing.hero.preparation';
const ASSET = 'landing.hero.prepared.';
interface PreparedHero {
  asset: HeroBackgroundAsset;
  paths: Record<'desktop' | 'mobile' | 'poster', string>;
  sourceId: string;
  sourceName: string;
}

async function readFresh<T>(key: string): Promise<T | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  return (row?.value as T) ?? null;
}

export async function selectedHero(slot: HeroSlot = 'default') { return readFresh<PreparedHero>(slotKey(slot)); }

export async function heroSlotAssignments() {
  return Promise.all(HERO_SLOTS.map(async slot => {
    const selected = await selectedHero(slot.id);
    return { ...slot, source: selected ? { sourceId: selected.sourceId, sourceName: selected.sourceName } : null,
      asset: selected?.asset ?? null };
  }));
}

export async function heroPreparation() {
  const job = await readFresh<HeroPreparationJob>(JOB);
  return job?.phase === 'running' && job.expiresAt < Date.now()
    ? { ...job, phase: 'failed' as const, error: 'Preparation was interrupted. Please try again.' } : job;
}

export async function heroSourceOptions() {
  const rows = await db.select().from(workflowFiles).where(ilike(workflowFiles.name, 'siteherobackground/%')).orderBy(workflowFiles.name);
  return rows.filter(isHeroSource).map(f => ({ id: f.id, name: f.name.slice(f.name.indexOf('/') + 1), sizeBytes: f.sizeBytes }));
}

/** Claim a bounded database lease so separate web processes cannot start competing encodes. */
export async function prepareHeroSource(sourceId: string, slot: HeroSlot = 'default') {
  const [source] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, sourceId));
  if (!source || !isHeroSource(source)) throw new Error('Choose a readable MP4 directly in siteherobackground, no larger than 50 MB.');
  await requireHeroEncoder();
  const now = Date.now();
  const job: HeroPreparationJob = { id: randomUUID(), phase: 'running', slot, sourceName: source.name, expiresAt: now + 10 * 60_000 };
  const claimed = await db.insert(appSettings).values({ key: JOB, value: job }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: job, updatedAt: new Date() },
    setWhere: sql`${appSettings.value}->>'phase' != 'running' OR (${appSettings.value}->>'expiresAt')::bigint < ${now}`,
  }).returning({ key: appSettings.key });
  if (!claimed.length) throw new Error('Another animation is being prepared. Wait for it to finish before applying a new one.');
  // Polling reports completion; long conversions never hold an HTTP request open.
  void prepare(job, source).catch(error => console.error('[hero] Could not record preparation result:', error));
  return job;
}

async function prepare(job: HeroPreparationJob, source: typeof workflowFiles.$inferSelect) {
  let temporary = '';
  const paths: string[] = [];
  let published = false;
  try {
    const bytes = await readBuffer(source.diskPath).catch(() => { throw new Error('The source file could not be downloaded from Drive. Refresh the folder and try again.'); });
    if (bytes.length > 50 * 1024 * 1024 || bytes.length !== source.sizeBytes) throw new Error('The source file changed. Refresh the folder and try again.');
    temporary = await mkdtemp(join(tmpdir(), 'sr-hero-'));
    const input = join(temporary, 'source.mp4');
    await writeFile(input, bytes);
    let encoded;
    try { encoded = await encodeHero(input, temporary); }
    catch (error) {
      if (error instanceof Error && /Choose|could not|too large/.test(error.message)) throw error;
      throw new Error('Video preparation failed or timed out. Try a shorter MP4.');
    }
    const record: PreparedHero = {
      sourceId: source.id, sourceName: source.name,
      asset: { desktop: '', mobile: '', poster: '', duration: encoded.duration,
        desktopBytes: encoded.outputs.desktop.length, mobileBytes: encoded.outputs.mobile.length },
      paths: { desktop: '', mobile: '', poster: '' },
    };
    for (const kind of ['desktop', 'mobile', 'poster'] as const) {
      const path = newDiskPath(`hero-${job.id}-${kind}.${kind === 'poster' ? 'webp' : 'mp4'}`);
      paths.push(path);
      await saveBuffer(path, encoded.outputs[kind]);
      record.paths[kind] = path;
      record.asset[kind] = `/api/landing/hero-media?id=${job.id}&variant=${kind}`;
    }
    const accepted = await db.transaction(async tx => {
      const [current] = await tx.select().from(appSettings).where(eq(appSettings.key, JOB)).for('update');
      if ((current?.value as HeroPreparationJob)?.id !== job.id || job.expiresAt < Date.now()) return;
      const [latest] = await tx.select().from(workflowFiles).where(eq(workflowFiles.id, source.id)).for('share');
      if (!latest || !isHeroSource(latest) || latest.updatedAt.getTime() !== source.updatedAt.getTime() || latest.diskPath !== source.diskPath) {
        throw new Error('The source was changed, moved or deleted during preparation. Refresh and try again.');
      }
      const base = source.name.slice(source.name.indexOf('/') + 1).replace(/\.mp4$/i, '').slice(0, 70);
      // Keep the prepared files discoverable in Drive, outside the source picker.
      await tx.insert(workflowFiles).values((['desktop', 'mobile', 'poster'] as const).map(kind => ({
        name: `siteherobackground/web-ready/${base}-${job.id}/${kind}.${kind === 'poster' ? 'webp' : 'mp4'}`,
        description: `Prepared public hero copy of ${source.name}. Original unchanged.`,
        mimeType: kind === 'poster' ? 'image/webp' : 'video/mp4',
        diskPath: record.paths[kind], sizeBytes: encoded.outputs[kind].length,
        permissions: { read: true, write: false, append: false, delete: false },
      })));
      await tx.insert(appSettings).values({ key: ASSET + job.id, value: record });
      await tx.insert(appSettings).values({ key: slotKey(job.slot ?? 'default'), value: record }).onConflictDoUpdate({
        target: appSettings.key, set: { value: record, updatedAt: new Date() },
      });
      await tx.update(appSettings).set({ value: { ...job, phase: 'succeeded' }, updatedAt: new Date() }).where(eq(appSettings.key, JOB));
      return true;
    });
    published = accepted === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preparation failed. Please try again.';
    await db.update(appSettings).set({ value: { ...job, phase: 'failed', error: message }, updatedAt: new Date() })
      .where(sql`${appSettings.key} = ${JOB} AND ${appSettings.value}->>'id' = ${job.id}`);
  } finally {
    if (!published) await Promise.all(paths.map(path => deleteFile(path).catch(() => {})));
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

export async function restoreBundledHero(slot: HeroSlot = 'default') {
  await db.transaction(async tx => {
    // Serialize with publication, but clearing another slot must not cancel its encode.
    const replacement: HeroPreparationJob = { id: randomUUID(), phase: 'succeeded', slot, sourceName: 'Default animation', expiresAt: 0 };
    await tx.insert(appSettings).values({ key: JOB, value: replacement }).onConflictDoNothing();
    const [current] = await tx.select().from(appSettings).where(eq(appSettings.key, JOB)).for('update');
    const job = current?.value as HeroPreparationJob;
    if (job?.phase !== 'running' || (job.slot ?? 'default') === slot) {
      await tx.update(appSettings).set({ value: replacement, updatedAt: new Date() }).where(eq(appSettings.key, JOB));
    }
    await tx.delete(appSettings).where(eq(appSettings.key, slotKey(slot)));
  });
}

/** Only immutable, explicitly published derivatives are public; never resolve a Drive file ID here. */
export async function preparedHeroBytes(id: string, variant: 'desktop' | 'mobile' | 'poster') {
  const record = await getSetting<PreparedHero>(ASSET + id);
  return record ? readBuffer(record.paths[variant]) : null;
}
