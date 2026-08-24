import { describe, it, expect } from 'vitest';
import {
  resolveServiceRole, runsService, ownsWhatsAppSession,
  type PlatformService,
} from '$lib/workflows/service-role';

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;
const ALL: PlatformService[] = ['whatsapp', 'homeassistant', 'scheduler', 'background'];

describe('resolveServiceRole', () => {
  it('defaults to web — the SvelteKit app runs everything, as before', () => {
    expect(resolveServiceRole(env({}))).toBe('web');
  });

  it('still honours JKAI_BUILDER_PROCESS=1', () => {
    // Set in a systemd unit on two hosts. Breaking it would hand the builder a
    // second scheduler, silently.
    expect(resolveServiceRole(env({ JKAI_BUILDER_PROCESS: '1' }))).toBe('builder');
  });

  it('takes an explicit role over the legacy flag', () => {
    expect(resolveServiceRole(env({ JKAI_BUILDER_PROCESS: '1', JKAI_SERVICE_ROLE: 'whatsapp' }))).toBe('whatsapp');
  });

  it('ignores a role it does not recognise rather than running nothing', () => {
    // A typo must not silently disable the scheduler on the web app.
    expect(resolveServiceRole(env({ JKAI_SERVICE_ROLE: 'wahtsapp' }))).toBe('web');
  });

  it('is case- and space-insensitive', () => {
    expect(resolveServiceRole(env({ JKAI_SERVICE_ROLE: ' WhatsApp ' }))).toBe('whatsapp');
  });
});

describe('runsService', () => {
  it('web runs every platform service', () => {
    for (const s of ALL) expect(runsService(s, env({}))).toBe(true);
  });

  it('builder runs none of them', () => {
    for (const s of ALL) expect(runsService(s, env({ JKAI_BUILDER_PROCESS: '1' }))).toBe(false);
  });

  describe('the whatsapp role', () => {
    const wa = env({ JKAI_SERVICE_ROLE: 'whatsapp' });

    it('runs the WhatsApp socket', () => {
      expect(runsService('whatsapp', wa)).toBe(true);
    });

    it('does NOT run the scheduler — two schedulers fire every cron twice', () => {
      expect(runsService('scheduler', wa)).toBe(false);
    });

    it('does NOT run Home Assistant or background jobs', () => {
      expect(runsService('homeassistant', wa)).toBe(false);
      expect(runsService('background', wa)).toBe(false);
    });
  });
});

describe('ownsWhatsAppSession — the self-delegation trap', () => {
  it('is true only for the whatsapp role', () => {
    expect(ownsWhatsAppSession(env({ JKAI_SERVICE_ROLE: 'whatsapp' }))).toBe(true);
    expect(ownsWhatsAppSession(env({}))).toBe(false);
    expect(ownsWhatsAppSession(env({ JKAI_BUILDER_PROCESS: '1' }))).toBe(false);
  });

  it('is true even when a bridge URL is set — the worker shares the EnvironmentFile', () => {
    // This is the whole point. Without it a WhatsApp worker deployed beside the
    // web app reads the same env, sees a bridge URL, and forwards its sends to
    // itself.
    expect(
      ownsWhatsAppSession(env({
        JKAI_SERVICE_ROLE: 'whatsapp',
        WHATSAPP_HERMES_BRIDGE_URL: 'http://homeserv:3000',
      })),
    ).toBe(true);
  });

  it('leaves the web app delegated when a bridge URL is set', () => {
    expect(ownsWhatsAppSession(env({ WHATSAPP_HERMES_BRIDGE_URL: 'http://homeserv:3000' }))).toBe(false);
  });
});
