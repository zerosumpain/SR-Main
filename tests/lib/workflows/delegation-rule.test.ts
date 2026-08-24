import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Delegation is ONE rule. It broke the WhatsApp cutover by being two.
 *
 * `WhatsAppService` correctly refused to delegate (the worker owns the session,
 * so it paired and could send) while `bootWhatsApp` independently read the env
 * var, decided "delegated", and never wired the OrchestratorBridge. Outbound
 * worked; inbound went nowhere — the failure mode that looks like success.
 */
const ROOT = process.cwd();

describe('the delegation rule is not duplicated', () => {
  const files = [
    'src/lib/workflows/index.ts',
    'src/lib/workflows/whatsapp/service.ts',
  ];

  it.each(files)('%s never decides delegation from the env var alone', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    // Every place that reads the bridge URL to decide delegation must also
    // consult ownsWhatsAppSession(). Grep is the right tool: the point is that
    // a NEW third place would be caught too.
    const readsEnv = /WHATSAPP_HERMES_BRIDGE_URL/.test(src);
    if (!readsEnv) return;
    expect(src, `${rel} reads WHATSAPP_HERMES_BRIDGE_URL but never calls ownsWhatsAppSession()`)
      .toMatch(/ownsWhatsAppSession/);
  });

  it('bootWhatsApp gates the inbound bridge on the same rule', () => {
    const src = readFileSync(join(ROOT, 'src/lib/workflows/index.ts'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('const delegated ='));
    expect(line, 'bootWhatsApp must compute `delegated`').toBeDefined();
    expect(line).toMatch(/ownsWhatsAppSession\(\)/);
  });
});
