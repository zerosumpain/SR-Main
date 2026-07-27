import { describe, it, expect } from 'vitest';
import { rewriteHermesToolLog, describeHermesToolCall } from './hermes-tool-log';

// The fixtures below are real lines taken from production `orchestrator_chats`
// rows, including the ones where Hermes glues an entry onto the end of a
// sentence with no newline and the ones where it emits a bare ellipsis instead
// of an argument.

describe('describeHermesToolCall', () => {
  it('strips the mcp_<server>_ namespace and names the action', () => {
    expect(describeHermesToolCall({ tool: 'mcp_jkai_recall_memories', arg: 'david foley', count: 1 })).toBe(
      'Searched saved memories for “david foley”',
    );
  });

  it('unwraps jkai_extended to the inner tool it dispatched to', () => {
    expect(describeHermesToolCall({ tool: 'mcp_jkai_jkai_extended', arg: 'workflow_inspect', count: 1 })).toBe(
      'Read the current canvas',
    );
  });

  it('treats a non-identifier jkai_extended argument as a lookup subject', () => {
    expect(describeHermesToolCall({ tool: 'mcp_jkai_jkai_extended', arg: 'intel entity', count: 1 })).toBe(
      'Looked up “intel entity”',
    );
  });

  it('reports a repeat count in words rather than ×N', () => {
    expect(describeHermesToolCall({ tool: 'mcp_jkai_ha_get_history', arg: null, count: 3 })).toBe(
      'Read device history — 3 calls',
    );
  });

  it('falls back to a generic phrasing for an unmapped tool', () => {
    expect(describeHermesToolCall({ tool: 'mcp_jkai_some_new_thing', arg: null, count: 1 })).toBe(
      'Ran some new thing',
    );
    expect(describeHermesToolCall({ tool: 'mcp_jkai_some_new_thing', arg: 'abc', count: 1 })).toBe(
      'Ran some new thing on “abc”',
    );
  });
});

describe('rewriteHermesToolLog', () => {
  it('leaves text without a tool log untouched', () => {
    const text = 'Here is a normal reply with **markdown** and no machinery.';
    expect(rewriteHermesToolLog(text)).toBe(text);
  });

  it('rewrites a leading entry into a step div', () => {
    const out = rewriteHermesToolLog('⚙️ mcp_jkai_recall_memories: "david foley"');
    expect(out).toBe('<div class="tool-log-step">Searched saved memories for “david foley”</div>');
  });

  it('splits an entry that is glued onto the end of a sentence', () => {
    const out = rewriteHermesToolLog(
      'Pulling the live intel entity rather than trusting the summary.⚙️ mcp_jkai_knowledge_search: "David Foley"\n\n**David Foley** — confirmed.',
    );
    expect(out).toBe(
      'Pulling the live intel entity rather than trusting the summary.\n\n' +
        '<div class="tool-log-step">Searched the knowledge base for “David Foley”</div>\n\n' +
        '**David Foley** — confirmed.',
    );
  });

  it('handles the bare-ellipsis form and a run of glued entries', () => {
    const out = rewriteHermesToolLog(
      '⚙️ mcp_jkai_ha_get_history... (×2)⚙️ mcp_jkai_ha_get_history... (×3)',
    );
    expect(out).toBe(
      '<div class="tool-log-step">Read device history — 2 calls</div>\n\n' +
        '<div class="tool-log-step">Read device history — 3 calls</div>',
    );
  });

  it('escapes HTML in an argument so a crafted reply cannot inject markup', () => {
    const out = rewriteHermesToolLog('⚙️ mcp_jkai_file_search: "<img src=x onerror=alert(1)>"');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('leaves a half-streamed entry alone until its separator arrives', () => {
    // Mid-stream the tool name is still being emitted; rewriting here would show
    // one sentence and then replace it a token later.
    const partial = 'Checking now. ⚙️ mcp_jkai_recall_mem';
    expect(rewriteHermesToolLog(partial)).toBe(partial);
  });
});
