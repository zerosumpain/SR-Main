import { beforeEach, describe, expect, it, vi } from 'vitest';

// Slice 7b: tool_search ranks the capability manifest beside the tools,
// answers "not built yet" for a planned row, and files the gap ONLY when John
// asked for it himself on an attended owner turn. Synthetic data only.

vi.mock('$lib/apis/integration-discovery', () => ({ discoverIntegrations: async () => [] }));
vi.mock('$lib/toolpolicy/policy', () => ({ getActivePolicy: async () => null, describeWithPolicy: (_p: unknown, _n: string, d: string) => d }));

import { setCapabilityGapQueue, type CapabilityGap } from '$lib/capabilities/gaps';
import { register, tools } from '../registry-internal';
import type { ToolExecContext } from '../registry-internal';
import type { ToolPrincipal } from '../invoke-contract';
import { notBuiltYetAnswer } from './discovery';

const queued: CapabilityGap[] = [];
const seen = new Set<string>();
beforeEach(() => {
  queued.length = 0;
  seen.clear();
  setCapabilityGapQueue({
    enqueue: async (gap) => {
      const key = `${gap.conversationId}|${gap.capabilityId ?? gap.query}`;
      if (seen.has(key)) return { status: 'already-queued' };
      seen.add(key);
      queued.push(gap);
      return { status: 'queued' };
    },
  });
});

if (!tools.some((t) => t.name === 'f1_driver_standings')) {
  register({ name: 'f1_driver_standings', description: 'Formula 1 driver standings', parameters: { type: 'object', properties: {} }, category: 'Custom Tool', toolset: 'custom:sports', effect: 'read', handler: async () => ({ success: true }) });
}

const search = () => tools.find((t) => t.name === 'tool_search')!;
const owner: ToolPrincipal = { principalId: 'owner', via: 'session', attended: true, jobId: 'job-1' };
const ctxFor = (principal: ToolPrincipal, conversationId = 'conv-1'): ToolExecContext => ({ emit: () => {}, principal, conversationId });
type SearchData = { notBuiltYet?: { answer: string; backlog: string; capability: string | null }; capabilities: Array<{ id: string; status: string }>; tools: Array<{ name: string }> };
async function run(args: Record<string, unknown>, ctx: ToolExecContext): Promise<SearchData> {
  const r = await search().handler(args, ctx);
  expect(r.success).toBe(true);
  return r.data as SearchData;
}

describe('tool_search and the capability manifest', () => {
  it('says a planned capability is not built yet, files it once, and merges a repeat', async () => {
    const first = await run({ query: 'show me the family photos', requested: true }, ctxFor(owner));
    expect(first.notBuiltYet).toMatchObject({ capability: 'family', backlog: 'queued' });
    expect(first.notBuiltYet?.answer).toBe("Family features from chat is not built yet (today: /home) — it's on the backlog. Want me to commission it?");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ capabilityId: 'family', title: 'jkai capability: Family features from chat', conversationId: 'conv-1' });
    const again = await run({ query: 'family photos please', requested: true }, ctxFor(owner));
    expect(again.notBuiltYet?.backlog).toBe('already-queued');
    expect(queued).toHaveLength(1);
  });

  it('files nothing unless John asked for it himself', async () => {
    const r = await run({ query: 'family photos' }, ctxFor(owner));
    expect(r.notBuiltYet?.backlog).toBe('not-filed');
    expect(queued).toHaveLength(0);
  });

  it('files nothing for unattended callers or members, and offers no commission', async () => {
    const heartbeat = await run({ query: 'family photos', requested: true }, ctxFor({ principalId: 'owner', via: 'heartbeat', attended: false }));
    expect(heartbeat.notBuiltYet?.answer).not.toContain('commission');
    const whatsapp = await run({ query: 'family photos', requested: true }, ctxFor({ principalId: 'owner', via: 'whatsapp', attended: false }));
    expect(whatsapp.notBuiltYet?.backlog).toBe('not-filed');
    const member = await run({ query: 'family photos', requested: true }, ctxFor({ principalId: 'u_member1', via: 'session', attended: true, jobId: 'j', allowedTools: ['tool_search'] }));
    expect(member.capabilities.every((c) => c.status === 'live')).toBe(true);
    expect(queued).toHaveLength(0);
  });

  it('offers the commission only in a browser session', async () => {
    const phone = await run({ query: 'family photos', requested: true }, ctxFor({ principalId: 'owner', via: 'device', attended: true, jobId: 'j2' }, 'conv-2'));
    expect(phone.notBuiltYet?.answer).toContain("it's on the backlog");
    expect(phone.notBuiltYet?.answer).not.toContain('commission');
  });

  it('answers a live capability without filing anything', async () => {
    const r = await run({ query: 'what is on my trip on day 2', requested: true }, ctxFor(owner));
    expect(r.capabilities[0]).toMatchObject({ id: 'trips', status: 'live' });
    expect(r.notBuiltYet).toBeUndefined();
    expect(queued).toHaveLength(0);
  });

  it('shows saved custom tools to an attended owner only', async () => {
    const mine = await run({ query: 'formula 1 driver standings' }, ctxFor(owner));
    expect(mine.tools.map((t) => t.name)).toContain('f1_driver_standings');
    const node = await run({ query: 'formula 1 driver standings' }, ctxFor({ principalId: 'owner', via: 'service', attended: false }));
    expect(node.tools.map((t) => t.name)).not.toContain('f1_driver_standings');
  });

  it('words a failed filing honestly', () => {
    expect(notBuiltYetAnswer(null, { status: 'unavailable' }, false)).toBe('Nothing on the site does that yet — I could not add it to the backlog just now.');
  });
});
