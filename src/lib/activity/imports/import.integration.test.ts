/** End-to-end archive inspection and import against a real Postgres schema. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activityEvents,
  activityImports,
  activityPrincipals,
  appSettings,
} from '$lib/db/schema';
import { clearSettingsCache, setSetting } from '$lib/server/models/settings';
import { ACTIVITY_SETTINGS_ENABLED_KEY, activityProviderSettingKey } from '../config';
import { createActivityConnection } from '../store/connections.server';
import { runNextActivityJob } from '../sync/runner.server';
import {
  confirmActivityImport,
  createActivityImport,
  getActivityImport,
} from './store.server';

const PRINCIPAL = 'activity-import-itest';
const SETTING_KEYS = [
  ACTIVITY_SETTINGS_ENABLED_KEY,
  activityProviderSettingKey('youtube_takeout'),
];
let filesRoot = '';

async function cleanup() {
  await db.delete(activityPrincipals).where(eq(activityPrincipals.id, PRINCIPAL));
  await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
  clearSettingsCache();
  if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
}

beforeAll(async () => {
  await cleanup();
  filesRoot = await mkdtemp(join(tmpdir(), 'jkai-activity-import-'));
  process.env.WORKFLOW_FILES_ROOT = filesRoot;
  process.env.INTEGRATION_CREDENTIALS_KEY = 'ab'.repeat(32);
  await db.insert(activityPrincipals).values({
    id: PRINCIPAL,
    kind: 'user',
    externalRef: PRINCIPAL,
    label: PRINCIPAL,
  });
  await setSetting(ACTIVITY_SETTINGS_ENABLED_KEY, true);
  await setSetting(activityProviderSettingKey('youtube_takeout'), true);
});

afterAll(async () => {
  delete process.env.WORKFLOW_FILES_ROOT;
  delete process.env.INTEGRATION_CREDENTIALS_KEY;
  await cleanup();
});

describe('activity archive pipeline', () => {
  it('inspects, confirms, imports and deduplicates the same encrypted Takeout archive', async () => {
    const connection = await createActivityConnection({
      principalId: PRINCIPAL,
      provider: 'youtube_takeout',
      mode: 'import',
      allowUnavailable: true,
    });
    const zip = new JSZip();
    zip.file(
      'Takeout/YouTube and YouTube Music/history/watch-history.json',
      JSON.stringify([
        {
          header: 'YouTube Music',
          title: 'Listened to Test track',
          titleUrl: 'https://www.youtube.com/watch?v=test-music',
          time: '2026-09-03T19:00:00.000Z',
          products: ['YouTube Music'],
        },
        {
          header: 'YouTube',
          title: 'Watched Test video',
          titleUrl: 'https://www.youtube.com/watch?v=test-video',
          time: '2026-09-03T20:00:00.000Z',
          products: ['YouTube'],
        },
      ]),
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });

    const uploaded = await createActivityImport({
      principalId: PRINCIPAL,
      connectionId: connection.id,
      filename: 'takeout.zip',
      bytes,
    });
    expect(uploaded.duplicate).toBe(false);
    expect((await runNextActivityJob('activity-import-itest')).outcome).toBe('succeeded');

    const inspected = await getActivityImport(PRINCIPAL, uploaded.activityImport.id);
    expect(inspected?.status).toBe('ready');
    expect(inspected?.manifest.estimatedRecords).toBe(2);
    expect(inspected?.storageRef).toBeTruthy();

    await confirmActivityImport(PRINCIPAL, uploaded.activityImport.id);
    expect((await runNextActivityJob('activity-import-itest')).outcome).toBe('succeeded');

    const events = await db
      .select({ type: activityEvents.type, importId: activityEvents.importId })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.principalId, PRINCIPAL),
          eq(activityEvents.importId, uploaded.activityImport.id),
        ),
      );
    expect(events.map((event) => event.type).sort()).toEqual([
      'media.track.listened',
      'media.video.watched',
    ]);

    const duplicate = await createActivityImport({
      principalId: PRINCIPAL,
      connectionId: connection.id,
      filename: 'same-data-another-name.zip',
      bytes,
    });
    expect(duplicate.duplicate).toBe(true);
    const imports = await db
      .select({ id: activityImports.id })
      .from(activityImports)
      .where(eq(activityImports.principalId, PRINCIPAL));
    expect(imports).toHaveLength(1);
  });
});
