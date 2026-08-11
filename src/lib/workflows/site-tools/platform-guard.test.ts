import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  tools: [] as Array<{ name: string; destructive?: boolean }>,
}));

vi.mock('./registry', () => ({ getTools: () => state.tools }));

import { refuseDestructiveCall } from './platform-guard';

beforeEach(() => {
  state.tools = [
    { name: 'gmail_search' },
    { name: 'gmail_send', destructive: true },
    { name: 'publish_page', destructive: true },
    { name: 'node_call' },
  ];
});

describe('what an authored handler may reach', () => {
  it('lets a read-only tool through', async () => {
    expect(await refuseDestructiveCall('gmail_search', 'inbox_digest')).toBeNull();
    expect(await refuseDestructiveCall('node_call', 'inbox_digest')).toBeNull();
  });

  // The hole this closes: the MCP dispatcher gates destructive tools, but a
  // handler calls executeTool one floor below it. So a stored tool — written by
  // the model, possibly while reading a scraped page or a summarised email, and
  // switched on unattended by the nightly run — could send mail with nobody
  // asked.
  it.each(['gmail_send', 'publish_page'])('refuses %s', async (name) => {
    const r = await refuseDestructiveCall(name, 'inbox_digest');
    expect(r?.success).toBe(false);
    expect(r?.error).toContain(name);
  });

  it('tells the caller the action is still possible, just not unattended', async () => {
    // A refusal that reads as "you cannot do this" invites the model to work
    // around it. The message has to name the route that does work.
    const r = await refuseDestructiveCall('gmail_send', 'inbox_digest');
    expect(r?.error).toMatch(/directly/);
    expect(r?.error).toMatch(/confirmation/);
  });

  it('names the tool doing the calling, so the offender is identifiable', async () => {
    const r = await refuseDestructiveCall('gmail_send', 'inbox_digest');
    expect(r?.error).toContain('inbox_digest');
  });

  it('leaves an unknown name to executeTool rather than guessing', async () => {
    // executeTool answers "Unknown tool: x", which is the clearer message.
    // Refusing here would report a typo as a permissions problem.
    expect(await refuseDestructiveCall('no_such_tool', 'inbox_digest')).toBeNull();
  });

  it('follows the registry, so a newly-flagged tool is covered without editing a list', async () => {
    state.tools = [{ name: 'future_tool', destructive: true }];
    expect((await refuseDestructiveCall('future_tool', 'x'))?.success).toBe(false);
  });
});
