import { describe, it, expect } from 'vitest';
import { rewriteLegacyToolLog, stripLegacyToolLog, describeLegacyToolCall } from './legacy-tool-log';

// The fixtures below are real lines taken from production `orchestrator_chats`
// rows, including the ones where an entry is glued onto the end of a
// sentence with no newline and the ones where it emits a bare ellipsis instead
// of an argument.

describe('describeLegacyToolCall', () => {
  it('strips the mcp_<server>_ namespace and names the action', () => {
    expect(describeLegacyToolCall({ tool: 'mcp_jkai_recall_memories', arg: 'david foley', count: 1 })).toBe(
      'Searched saved memories for “david foley”',
    );
  });

  it('unwraps jkai_extended to the inner tool it dispatched to', () => {
    expect(describeLegacyToolCall({ tool: 'mcp_jkai_jkai_extended', arg: 'workflow_inspect', count: 1 })).toBe(
      'Read the current canvas',
    );
  });

  it('treats a non-identifier jkai_extended argument as a lookup subject', () => {
    expect(describeLegacyToolCall({ tool: 'mcp_jkai_jkai_extended', arg: 'intel entity', count: 1 })).toBe(
      'Looked up “intel entity”',
    );
  });

  it('reports a repeat count in words rather than ×N', () => {
    expect(describeLegacyToolCall({ tool: 'mcp_jkai_ha_get_history', arg: null, count: 3 })).toBe(
      'Read device history — 3 calls',
    );
  });

  it('falls back to a generic phrasing for an unmapped tool', () => {
    expect(describeLegacyToolCall({ tool: 'mcp_jkai_some_new_thing', arg: null, count: 1 })).toBe(
      'Ran some new thing',
    );
    expect(describeLegacyToolCall({ tool: 'mcp_jkai_some_new_thing', arg: 'abc', count: 1 })).toBe(
      'Ran some new thing on “abc”',
    );
  });
});

describe('rewriteLegacyToolLog', () => {
  it('leaves text without a tool log untouched', () => {
    const text = 'Here is a normal reply with **markdown** and no machinery.';
    expect(rewriteLegacyToolLog(text)).toBe(text);
  });

  it('rewrites a leading entry into a step div', () => {
    const out = rewriteLegacyToolLog('⚙️ mcp_jkai_recall_memories: "david foley"');
    expect(out).toBe('<div class="tool-log-step">Searched saved memories for “david foley”</div>');
  });

  it('splits an entry that is glued onto the end of a sentence', () => {
    const out = rewriteLegacyToolLog(
      'Pulling the live intel entity rather than trusting the summary.⚙️ mcp_jkai_knowledge_search: "David Foley"\n\n**David Foley** — confirmed.',
    );
    expect(out).toBe(
      'Pulling the live intel entity rather than trusting the summary.\n\n' +
        '<div class="tool-log-step">Searched the knowledge base for “David Foley”</div>\n\n' +
        '**David Foley** — confirmed.',
    );
  });

  it('handles the bare-ellipsis form and a run of glued entries', () => {
    const out = rewriteLegacyToolLog(
      '⚙️ mcp_jkai_ha_get_history... (×2)⚙️ mcp_jkai_ha_get_history... (×3)',
    );
    expect(out).toBe(
      '<div class="tool-log-step">Read device history — 2 calls</div>\n\n' +
        '<div class="tool-log-step">Read device history — 3 calls</div>',
    );
  });

  it('escapes HTML in an argument so a crafted reply cannot inject markup', () => {
    const out = rewriteLegacyToolLog('⚙️ mcp_jkai_file_search: "<img src=x onerror=alert(1)>"');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('leaves a half-streamed entry alone until its separator arrives', () => {
    // Mid-stream the tool name is still being emitted; rewriting here would show
    // one sentence and then replace it a token later.
    const partial = 'Checking now. ⚙️ mcp_jkai_recall_mem';
    expect(rewriteLegacyToolLog(partial)).toBe(partial);
  });
});

// The leading glyph was picked per tool, falling back to
// ⚙️ only for tools that register none — which is every `mcp_jkai_*` tool. Its
// own native tools carry their own glyph, so a ⚙️-only match covered the MCP
// half of the log and missed the native half entirely.
describe('rewriteLegacyToolLog — native tools with their own glyph', () => {
  it('rewrites the web_search / web_extract log from the House of Lords reply', () => {
    const out = rewriteLegacyToolLog(
      '🔍 web_search: "House of Lords members salary allowan..."\n' +
        '📄 web_extract: "https://www.parliament.uk/business/lo..."\n' +
        '🔍 web_search: "House of Lords daily allowance £371 £..."',
    );
    expect(out).toContain('Searched the web for “House of Lords members salary allowan…”');
    expect(out).toContain('Read parliament.uk');
    expect(out).not.toContain('web_search');
    expect(out).not.toContain('🔍');
  });

  it.each([
    ['🐍 execute_code...', 'Ran some code'],
    ['💻 terminal: "npm run build"', 'Ran the command “npm run build”'],
    ['🔎 search_files: "tool-summary"', 'Searched the files for “tool-summary”'],
    ['📖 read_file: "src/app.css"', 'Read “src/app.css”'],
    ['📚 skill_view: "jkai-research"', 'Read its jkai research playbook'],
    ['🔍 session_search: "house of lords"', 'Searched past conversations for “house of lords”'],
    ['🌐 browser_navigate: "https://www.parliament.uk/x"', 'Opened parliament.uk in a browser'],
    ['🔀 delegate_task: "check the deploy"', 'Handed a sub-agent the job of “check the deploy”'],
  ])('rewrites %s', (input, expected) => {
    expect(rewriteLegacyToolLog(input)).toBe(`<div class="tool-log-step">${expected}</div>`);
  });

  // Regression: search queries carry their own quotes far more often than not
  // (9 of the 13 searches in the House of Lords reply did). Closing the argument
  // on the first inner quote captured nothing and spilled the rest of the query
  // into the reply as loose prose.
  it('keeps a phrase-quoted query whole instead of spilling it into the prose', () => {
    expect(rewriteLegacyToolLog('🔍 web_search: ""House of Lords" benefits pension fre..."')).toBe(
      '<div class="tool-log-step">Searched the web for “"House of Lords" benefits pension fre…”</div>',
    );
    expect(rewriteLegacyToolLog('🔍 web_search: "site:parliament.uk "members of the lo..."')).not.toContain(
      'House of Lords" benefits',
    );
  });

  it('counts repeats on a native-tool entry too', () => {
    expect(rewriteLegacyToolLog('🔍 web_search: "peers" (×4)')).toBe(
      '<div class="tool-log-step">Searched the web for “peers” — 4 calls</div>',
    );
  });
});

// The guard that stops the wider glyph match from eating the answer itself.
// Every fixture below is a real shape found in production assistant replies.
describe('rewriteLegacyToolLog — leaves prose alone', () => {
  it.each([
    '✅ Corrected: the figure is £371 a day.',
    '🥇 WINNER: the second approach.',
    '→ recommendation: ship it.',
    '— kicker: nobody noticed.',
    '📋 Summary: three things changed.',
    '💬 Note: this is only an estimate.',
  ])('does not rewrite %s', (text) => {
    expect(rewriteLegacyToolLog(text)).toBe(text);
  });

  it('leaves the ⏳ and ⏱️ status lines alone — they are already English', () => {
    const status =
      '⏳ Working — 12 min (iteration 5/90, receiving stream response)\n⏱️ Agent inactive for 30 min — no tool calls';
    expect(rewriteLegacyToolLog(status)).toBe(status);
  });

  it('still rewrites a real entry sitting next to prose that uses a tool glyph', () => {
    const out = rewriteLegacyToolLog('✅ Corrected: see below.\n🔍 web_search: "peers"');
    expect(out).toContain('✅ Corrected: see below.');
    expect(out).toContain('<div class="tool-log-step">Searched the web for “peers”</div>');
  });
});

// What the chat bubble actually uses. The steps stay in the tool-call trace
// behind the *analyse* button; the reply is only the answer.
describe('stripLegacyToolLog', () => {
  it('removes an entry entirely rather than describing it', () => {
    expect(stripLegacyToolLog('⚙️ mcp_jkai_recall_memories: "david foley"')).toBe('');
  });

  it('keeps the prose on both sides and does not run the sentences together', () => {
    const out = stripLegacyToolLog(
      'Applying the dedupe path and adding canvas notes.\n' +
        '⚙️ mcp_jkai_workflow_amend: "workflow_amend" (×2)\n' +
        '🔍 web_search: "peers"\n' +
        'Lint is clean apart from two pre-existing warnings.',
    );
    expect(out).toBe(
      'Applying the dedupe path and adding canvas notes.\n\n' +
        'Lint is clean apart from two pre-existing warnings.',
    );
  });

  it('separates prose when an entry is glued onto the end of a sentence', () => {
    const out = stripLegacyToolLog(
      'Checking the canvas now. ⚙️ mcp_jkai_workflow_lint: "spine" Lint passes.',
    );
    expect(out).toBe('Checking the canvas now.\n\nLint passes.');
    expect(out).not.toContain('  ');
  });

  it('leaves a reply with no tool log byte-identical', () => {
    const text = 'The figure is £371 a day.\n\n- one\n- two';
    expect(stripLegacyToolLog(text)).toBe(text);
  });

  it('leaves prose that merely uses a tool glyph alone', () => {
    for (const text of [
      '✅ Corrected: the figure is £371 a day.',
      '📋 Summary: three things changed.',
      '💬 Note: this is only an estimate.',
      '⏳ Working — 12 min (iteration 5/90, receiving stream response)',
    ]) {
      expect(stripLegacyToolLog(text)).toBe(text);
    }
  });

  it('drops a phrase-quoted search query whole, with no prose spill', () => {
    const out = stripLegacyToolLog('🔍 web_search: ""House of Lords" benefits pension fre..."');
    expect(out).toBe('');
  });

  it('collapses a run of consecutive entries to a single break, not a gulf', () => {
    const out = stripLegacyToolLog(
      'Before.\n⚙️ mcp_jkai_ha_get_history... (×2)\n⚙️ mcp_jkai_ha_query_state...\n🔍 web_search: "x"\nAfter.',
    );
    expect(out).toBe('Before.\n\nAfter.');
  });

  it('leaves a message that is only tool log with nothing at all — the bubble is skipped', () => {
    expect(stripLegacyToolLog('⚙️ mcp_jkai_workflow_run: "spine"\n⚙️ mcp_jkai_workflow_lint...')).toBe('');
  });
});
