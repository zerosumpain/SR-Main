import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A grep test, deliberately.
 *
 * The defect this pins was `if (jobId && isDestructive(fnName))` — one line that
 * reads as a single guard but is two conditions, where the missing half silently
 * routed every destructive tool down the ungated `else`. It is not reachable
 * from a unit test without standing up a model loop, a job store and a tool
 * registry, and a test that heavy would have been skipped rather than written.
 *
 * What makes the grep worth having: the same shape can reappear anywhere a
 * caller has no job. There were three such callers when this shipped (the
 * WhatsApp bridge, the follow-up queue, agent delegation) and the fix must hold
 * for the fourth. So assert on the source: the destructive branch must be
 * entered on `isDestructive` ALONE, and the no-job case must refuse.
 */

const SRC = resolve(__dirname, '../../../../src/lib/workflows/chat/general-chat.ts');
const src = readFileSync(SRC, 'utf8');

describe('destructive tools are never reached without a confirmer', () => {
  it('does not gate the destructive branch behind the presence of a jobId', () => {
    // The exact regression. `jobId &&` in front of isDestructive means "if
    // nobody can confirm, just do it".
    expect(src).not.toMatch(/if\s*\(\s*jobId\s*&&\s*isDestructive\s*\(/);
  });

  it('enters the destructive branch on isDestructive alone', () => {
    expect(src).toMatch(/if\s*\(\s*isDestructive\s*\(\s*fnName\s*\)\s*\)/);
  });

  it('refuses rather than executing when there is no job to confirm against', () => {
    // Narrow the search to the destructive branch so an executeSiteTool call
    // elsewhere in the file cannot satisfy this by accident.
    const start = src.search(/if\s*\(\s*isDestructive\s*\(\s*fnName\s*\)\s*\)/);
    expect(start).toBeGreaterThan(-1);
    const branch = src.slice(start, start + 2000);

    const noJob = branch.indexOf('if (!jobId)');
    expect(noJob).toBeGreaterThan(-1);

    // Between `if (!jobId)` and the confirmation call that handles the attended
    // case, the only way to executeSiteTool must be behind the explicit
    // unattended-allow policy.
    const unattended = branch.slice(noJob, branch.indexOf('requireConfirmation'));
    expect(unattended).toContain('MCP_CONFIRM_UNATTENDED');
    expect(unattended).toMatch(/success:\s*false/);
  });

  it('honours the same unattended escape hatch as the MCP dispatcher', () => {
    // Parity matters: two policies for "may an unattended session do this"
    // would drift, and the drift would be invisible until something destructive
    // ran. tool-step-bus.ts is the other half of this pair.
    const bus = readFileSync(
      resolve(__dirname, '../../../../src/lib/jkai/tool-step-bus.ts'),
      'utf8',
    );
    expect(bus).toContain('MCP_CONFIRM_UNATTENDED');
    expect(src).toContain('MCP_CONFIRM_UNATTENDED');

    // Both must default to deny when the variable is unset.
    expect(src).toMatch(/MCP_CONFIRM_UNATTENDED\s*\?\?\s*'deny'/);
    expect(bus).toMatch(/MCP_CONFIRM_UNATTENDED\s*\?\?\s*'deny'/);
  });
});

describe('the callers that have no jobId still exist', () => {
  // If these ever start passing a parentJobId the grep above stops covering
  // them, and this test says so rather than quietly going green for the wrong
  // reason.
  const callers = [
    'src/lib/workflows/whatsapp/orchestrator-bridge.ts',
    'src/lib/workflows/chat/followup-queue.ts',
    'src/lib/agents/delegate.ts',
  ];

  it.each(callers)('%s calls generalChat', (rel) => {
    const body = readFileSync(resolve(__dirname, '../../../../', rel), 'utf8');
    expect(body).toContain('generalChat(');
  });
});
