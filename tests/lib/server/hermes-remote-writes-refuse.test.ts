import { describe, it, expect, vi } from 'vitest';

/**
 * Every Hermes WRITE must refuse, and every Hermes READ must still work.
 *
 * The reason the writes are dangerous is not that they fail — it is that they
 * would have SUCCEEDED. `jkai-hermes.service` is linked and merely failed, so
 * "restart" starts it; its .env carried WHATSAPP_ENABLED=true; its Baileys
 * session is a second registered device. One click and the account has two
 * linked devices answering every message.
 *
 * The reads are deliberately left alive — the admin panels still render, and
 * the security page reads homeserv's peer posture through them. A blanket
 * "delete the module" would have taken that with it.
 */

vi.mock('$env/dynamic/private', () => ({ env: { HERMES_BRIDGE_SECRET: 'x', HOMESERV_SITE_URL: '' } }));

const WRITES = [
  ['rServiceAction', (m: any) => m.rServiceAction('restart_gateway')],
  ['rCronOp', (m: any) => m.rCronOp({ op: 'run', name: 'x' })],
  ['rSetHermesModel', (m: any) => m.rSetHermesModel('hermes.chat', 'some/model')],
  ['rWhatsAppPair', (m: any) => m.rWhatsAppPair('start')],
  ['rWhatsAppAction', (m: any) => m.rWhatsAppAction('restart_bridge')],
] as const;

describe('Hermes write controls refuse', () => {
  it.each(WRITES)('%s rejects instead of reaching the gateway', async (_name, call) => {
    const mod = await import('$lib/server/hermes-remote');
    await expect(call(mod)).rejects.toThrow(/retired/i);
  });

  it('says why, so the panel shows a reason rather than a stack trace', async () => {
    const mod = await import('$lib/server/hermes-remote');
    await expect(mod.rServiceAction('restart_gateway')).rejects.toThrow(/second WhatsApp device/i);
  });

  it('no longer carries a POST helper for anything to reach the gateway with', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../../../src/lib/server/hermes-remote.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/async function proxyPost/);
    expect(src).not.toMatch(/method:\s*'POST'/);
  });
});

describe('Hermes reads survive — the panels must keep rendering', () => {
  it('still exports every read wrapper', async () => {
    const mod = await import('$lib/server/hermes-remote');
    for (const name of [
      'rTelemetry',
      'rToolAudit',
      'rCallEfficiency',
      'rStatus',
      'rSessions',
      'rSession',
      'rCron',
      'rHermesModels',
      'rWhatsAppStatus',
      'rWhatsAppPairState',
    ]) {
      expect(typeof (mod as any)[name], `${name} must remain a read`).toBe('function');
    }
  });

  it('keeps homeservBase — the security panel reads peer posture through it', async () => {
    const mod = await import('$lib/server/hermes-remote');
    expect(typeof mod.homeservBase).toBe('function');
  });
});
