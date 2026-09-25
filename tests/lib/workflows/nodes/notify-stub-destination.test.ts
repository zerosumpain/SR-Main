import { describe, it, expect } from 'vitest';
import { notifyDef } from '$lib/workflows/nodes/notify.def';
import { stubOutput } from '$lib/workflows/side-effects';

// 2026-09-25: "send a random rude joke to my whatsapp…" was built on category
// `chat` (iPhone-only). The model's test run saw "would have: Notify me (chat):
// 'Hourly rude joke'" — nothing said WHERE — so it passed a workflow that never
// reached WhatsApp. The stub must say where the message would go.
const stub = (config: Record<string, unknown>) => String(stubOutput(notifyDef, 'notify', config).wouldHave);

describe('a stubbed notify step says where it would have gone', () => {
  it('the production build: category chat, no channel → iPhone only', () => {
    const line = stub({ category: 'chat', title: 'Hourly rude joke', body: 'x' });
    expect(line).toContain('iPhone only');
    expect(line).not.toMatch(/WhatsApp/);
  });

  it('an explicit Send to wins over the category', () => {
    expect(stub({ category: 'chat', channel: 'whatsapp', title: 't' })).toContain('WhatsApp only');
    expect(stub({ category: 'system', channel: 'iphone', title: 't' })).toContain('iPhone only');
    expect(stub({ category: 'chat', channel: 'both', title: 't' })).toContain('WhatsApp + iPhone');
  });

  it('a WhatsApp-routed category says so', () => {
    expect(stub({ category: 'system', title: 't' })).toContain('WhatsApp + iPhone');
  });
});
