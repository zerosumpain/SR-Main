import { describe, it, expect } from 'vitest';
import { getTools } from '$lib/tools/registry';

/**
 * `show_in_panel` validates a model-written desk page against the schema
 * SR-Jkai-Core draws with, so the model hears about a bad block in the same
 * turn. Two rules matter beyond shape: only `ask`/`link` buttons, and no
 * unsafe hrefs.
 */
function tool() {
  const t = getTools().find((x) => x.name === 'show_in_panel');
  if (!t) throw new Error('show_in_panel is not registered');
  return t;
}
type Out = { success: boolean; error?: string; data?: { panel: { head: { title: string }; sections: Array<{ id: string; blocks: Array<{ id: string }> }> }; summary: string; dropped: Array<{ id: string; reason: string }> } };
const run = (args: Record<string, unknown>) => tool().handler(args, {} as never) as Promise<Out>;

describe('show_in_panel', () => {
  it('is in the visualise toolset with a non-empty parameter schema (Codex drops empty properties)', () => {
    expect(tool().toolset).toBe('visualise');
    const p = tool().parameters as { properties: Record<string, unknown> };
    expect(Object.keys(p.properties)).toEqual(expect.arrayContaining(['title', 'sections']));
  });

  it('returns a validated page and reports nothing dropped', async () => {
    const r = await run({
      title: 'Rome, 26–30 October',
      standfirst: 'Four nights.',
      sections: [{ id: 'glance', label: 'At a glance', blocks: [
        { id: 'f', type: 'figures', items: [{ label: 'Nights', value: '4' }] },
        { id: 't', type: 'table', span: 12, title: 'Hotels', columns: ['', 'Monti'], rows: [['Price', '£186']], pick: 1 },
        { id: 'a', type: 'actions', items: [{ id: 'x', label: 'Add to calendar', kind: 'ask', ask: { label: 'Add', detail: 'Add the trip' } }] },
      ] }],
    });
    expect(r.success).toBe(true);
    expect(r.data!.panel.head.title).toBe('Rome, 26–30 October');
    expect(r.data!.panel.sections[0].blocks.map((b) => b.id)).toEqual(['f', 't', 'a']);
    expect(r.data!.dropped).toEqual([]);
  });

  it('drops bad blocks with a reason the model can act on, and keeps the rest', async () => {
    const r = await run({
      title: 'T',
      sections: [{ blocks: [
        { id: 'ok', type: 'kv', items: [{ label: 'a', value: 'b' }] },
        { id: 'empty', type: 'figures', items: [] },
        { id: 'post', type: 'actions', items: [{ id: 'p', label: 'Run', kind: 'post', endpoint: '/api/x' }] },
        { id: 'js', type: 'rows', rows: [{ id: 'r', title: 'x', href: 'javascript:alert(1)' }] },
      ] }],
    });
    expect(r.success).toBe(true);
    expect(r.data!.panel.sections[0].blocks.map((b) => b.id)).toEqual(['ok']);
    const reasons = Object.fromEntries(r.data!.dropped.map((d) => [d.id, d.reason]));
    expect(reasons.post).toMatch(/not allowed/);
    expect(reasons.js).toMatch(/href/);
    expect(reasons.empty).toBeTruthy();
    expect(r.data!.summary).toMatch(/3 dropped/);
  });

  it('fails, with every reason, when nothing is valid', async () => {
    const r = await run({ title: 'T', sections: [{ blocks: [{ id: 'q', type: 'nope' }] }] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/q:/);
  });

  it('requires a title and sections', async () => {
    expect((await run({ sections: [] })).success).toBe(false);
    expect((await run({ title: 'x' })).success).toBe(false);
  });
});
