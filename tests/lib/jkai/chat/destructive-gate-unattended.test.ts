import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Main no longer runs chat turns itself. The engine and its guard (destructive
 * tools refused when no job can confirm them, MCP_CONFIRM_UNATTENDED default
 * deny) live in SR-Jkai-Core, which carries the source tests for them. What is
 * left here is Main's half: the MCP dispatcher's own default, and the three
 * callers that start jobless turns on Core.
 */

describe("the MCP dispatcher's unattended policy", () => {
  it('defaults to deny when the variable is unset', () => {
    const bus = readFileSync(resolve(__dirname, '../../../../src/lib/jkai/tool-step-bus.ts'), 'utf8');
    expect(bus).toMatch(/MCP_CONFIRM_UNATTENDED\s*\?\?\s*'deny'/);
  });
});

describe('the callers that have no jobId still exist', () => {
  // If these ever start passing a parentJobId the grep above stops covering
  // them, and this test says so rather than quietly going green for the wrong
  // reason.
  const callers = [
    'src/lib/integrations/whatsapp/orchestrator-bridge.ts',
    'src/lib/jkai/chat/followup-queue.ts',
    'src/lib/agents/delegate.ts',
  ];

  // They run their turns on SR-Jkai-Core now, through the one client, which
  // has no way to send a job: Core's engine sees exactly the jobless turn the
  // in-process one did, and refuses destructive tools the same way.
  it.each(callers)('%s runs its turn through chatTurn', (rel) => {
    const body = readFileSync(resolve(__dirname, '../../../../', rel), 'utf8');
    expect(body).toContain('chatTurn(');
  });

  it('the turn client cannot send a job id', () => {
    const client = readFileSync(resolve(__dirname, '../../../../', 'src/lib/jkai/chat/turn.ts'), 'utf8');
    expect(client).not.toMatch(/jobId/i);
  });
});
