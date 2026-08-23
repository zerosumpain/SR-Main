import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSessionDir, diagnose, isWhatsAppAction } from './hermes-whatsapp';

describe('resolveSessionDir', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'wa-home-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // These mirror Hermes' own get_hermes_dir(). Pairing into the directory the
  // adapter is NOT reading writes a valid session that nothing ever loads —
  // the page would report success while WhatsApp stayed down.
  it('uses the consolidated platforms/ layout when there is no legacy session', async () => {
    expect(await resolveSessionDir(home)).toEqual({
      dir: path.join(home, 'platforms/whatsapp/session'),
      legacy: false,
    });
  });

  it('keeps using a populated legacy directory', async () => {
    const legacy = path.join(home, 'whatsapp/session');
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'creds.json'), '{}');
    expect(await resolveSessionDir(home)).toEqual({ dir: legacy, legacy: true });
  });

  it('ignores an EMPTY legacy directory', async () => {
    // An abandoned stub must not shadow real credentials under platforms/ —
    // this is the exact regression get_hermes_dir documents.
    await mkdir(path.join(home, 'whatsapp/session'), { recursive: true });
    expect(await resolveSessionDir(home)).toEqual({
      dir: path.join(home, 'platforms/whatsapp/session'),
      legacy: false,
    });
  });
});

describe('diagnose', () => {
  const base = {
    paired: true,
    number: '447359228511',
    loggedOut: false,
    gateway: 'active' as const,
    healthy: true,
    bridgeState: 'connected',
    pid: 4242,
    sessionDir: '/home/john/.hermes-jkai/platforms/whatsapp/session',
  };

  it('reports connected when everything is up', () => {
    const { remedy, diagnosis } = diagnose(base);
    expect(remedy).toBe('none');
    expect(diagnosis).toContain('447359228511');
  });

  // The whole reason this module exists: an unpaired session is NOT a restart
  // problem. Hermes refuses to launch the bridge without creds, so "restart
  // jkai-hermes" succeeds and changes nothing.
  it('demands pairing when the session is gone, even with a healthy-looking host', () => {
    const { remedy } = diagnose({ ...base, paired: false, healthy: false, pid: null });
    expect(remedy).toBe('pair');
  });

  it('says so explicitly when WhatsApp logged the device out', () => {
    const { remedy, diagnosis } = diagnose({ ...base, paired: false, loggedOut: true, healthy: false });
    expect(remedy).toBe('pair');
    expect(diagnosis).toMatch(/restart will not/i);
  });

  it('blames the gateway before the bridge when the unit is down', () => {
    const { remedy } = diagnose({ ...base, gateway: 'inactive', healthy: false, pid: null });
    expect(remedy).toBe('start_gateway');
  });

  it('calls a live-but-silent bridge wedged, and names the pid', () => {
    const { remedy, diagnosis } = diagnose({ ...base, healthy: false });
    expect(remedy).toBe('restart');
    expect(diagnosis).toContain('4242');
  });

  it('treats a non-connected bridge state as a restart', () => {
    expect(diagnose({ ...base, bridgeState: 'connecting' }).remedy).toBe('restart');
  });
});

describe('isWhatsAppAction', () => {
  it('accepts the two real actions and nothing else', () => {
    expect(isWhatsAppAction('restart_bridge')).toBe(true);
    expect(isWhatsAppAction('reset_session')).toBe(true);
    expect(isWhatsAppAction('rm -rf')).toBe(false);
    expect(isWhatsAppAction(undefined)).toBe(false);
  });
});
