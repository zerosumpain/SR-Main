// Confirmation gate on the live MCP path.
//
// Before this, `tools/call` → executeTool ran destructive tools with no human
// gate: the in-repo `requireConfirmation` only ever ran inside general-chat.ts,
// which JKAI_HERMES_CANVAS_CHAT=1 bypasses. These tests pin the gate to the
// dispatcher so it cannot silently regress to Hermes-behaviour-only again.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { dispatchJsonRpc } from './jsonrpc';
import {
  registerToolConfirmer,
  _resetToolStepBusForTests,
  type ToolConfirmRequest,
} from '$lib/jkai/tool-step-bus';

const SECRET = 'mcp-confirm-test-secret-32-bytes-long-please-thanks';

beforeAll(() => {
  process.env.SERVICE_BRIDGE_SECRET = SECRET;
});

beforeEach(() => {
  _resetToolStepBusForTests();
  delete process.env.MCP_CONFIRM_UNATTENDED;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Extract the text payload from a tools/call success envelope. */
function resultText(response: unknown): string {
  const ok = response as { result?: { content?: Array<{ text?: string }> } };
  return ok?.result?.content?.[0]?.text ?? '';
}

async function callTool(name: string, args: Record<string, unknown>) {
  return dispatchJsonRpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    { authBearer: SECRET },
  );
}

describe('mcp/jsonrpc destructive confirmation gate', () => {
  it('denies a destructive tool when no confirmer is attached (fail closed)', async () => {
    // No registerToolConfirmer call — this is the Hermes-cron / WhatsApp /
    // external-MCP-client case. Default policy must be deny.
    const { response } = await callTool('workflow_delete', {
      workflow_id: 'wf-unattended',
      workflowId: 'wf-unattended',
    });
    const text = resultText(response);
    expect(text).toMatch(/confirmation/i);
    expect(text).toMatch(/declined|no user|unattended/i);
  });

  it('allows unattended destructive calls when MCP_CONFIRM_UNATTENDED=allow', async () => {
    process.env.MCP_CONFIRM_UNATTENDED = 'allow';
    const { response } = await callTool('workflow_delete', {
      workflow_id: 'wf-allow',
      workflowId: 'wf-allow',
    });
    // The tool itself will fail (no such workflow) — what matters is that the
    // gate did NOT short-circuit with a confirmation-required payload.
    expect(resultText(response)).not.toMatch(/awaiting confirmation|confirmation required/i);
  });

  it('executes the tool when the attached confirmer approves', async () => {
    const seen: ToolConfirmRequest[] = [];
    registerToolConfirmer('wf-approve', async (req) => {
      seen.push(req);
      return { approved: true };
    });
    const { response } = await callTool('workflow_delete', {
      workflow_id: 'wf-approve',
      workflowId: 'wf-approve',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].tool).toBe('workflow_delete');
    expect(seen[0].prompt).toMatch(/Delete workflow/i);
    expect(resultText(response)).not.toMatch(/confirmation required/i);
  });

  it('blocks the tool when the attached confirmer rejects', async () => {
    let ran = false;
    registerToolConfirmer('wf-reject', async () => {
      ran = true;
      return { approved: false };
    });
    const { response } = await callTool('workflow_delete', {
      workflow_id: 'wf-reject',
      workflowId: 'wf-reject',
    });
    expect(ran).toBe(true);
    expect(resultText(response)).toMatch(/declined|rejected/i);
  });

  it('does not gate a non-destructive tool', async () => {
    let asked = false;
    registerToolConfirmer('wf-safe', async () => {
      asked = true;
      return { approved: true };
    });
    await callTool('workflow_list', { workflow_id: 'wf-safe', workflowId: 'wf-safe' });
    expect(asked).toBe(false);
  });

  it('resolves the real tool behind jkai_extended before deciding', async () => {
    // The meta-tool masks the actual tool inside its arguments. Gating on the
    // outer name would let every destructive call through unchallenged.
    const seen: ToolConfirmRequest[] = [];
    registerToolConfirmer('wf-meta', async (req) => {
      seen.push(req);
      return { approved: false };
    });
    await dispatchJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'jkai_extended',
          arguments: {
            operation: 'invoke',
            name: 'workflow_delete',
            arguments: { workflow_id: 'wf-meta', workflowId: 'wf-meta' },
          },
          _meta: { chat_id: 'wf-meta' },
        },
      },
      { authBearer: SECRET },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].tool).toBe('workflow_delete');
  });

  it('denies when the confirmer exceeds the wait budget', async () => {
    vi.useFakeTimers();
    try {
      registerToolConfirmer('wf-timeout', () => new Promise(() => {})); // never resolves
      const pending = callTool('workflow_delete', {
        workflow_id: 'wf-timeout',
        workflowId: 'wf-timeout',
      });
      await vi.advanceTimersByTimeAsync(241_000);
      const { response } = await pending;
      expect(resultText(response)).toMatch(/timed out|no response/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('denies when the confirmer throws', async () => {
    registerToolConfirmer('wf-throw', async () => {
      throw new Error('job cancelled');
    });
    const { response } = await callTool('workflow_delete', {
      workflow_id: 'wf-throw',
      workflowId: 'wf-throw',
    });
    expect(resultText(response)).toMatch(/declined|cancelled|not confirmed/i);
  });
});
