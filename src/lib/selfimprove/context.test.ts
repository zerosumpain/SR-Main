import { describe, it, expect } from 'vitest';
import { renderContext, MAX_TOOL_DESC, type ContextPack, type ToolSummary } from './context';

function pack(platformTools: ToolSummary[]): ContextPack {
  return { platformTools, catalogApis: [], secretHandles: [], customTools: [], priorFailures: [], backlog: [] } as ContextPack;
}

describe('what the nightly author is told about the tools it may call', () => {
  it('gives each tool its description and its required arguments', () => {
    // This section used to render `t.name` alone — the descriptions were loaded
    // into the pack and dropped here. An author told only that
    // `apple_calendar_list` exists has no option but to guess the arguments,
    // and guessed argument names are exactly what made `ha_query_state` 404 on
    // 32 of 72 live calls.
    const out = renderContext(pack([
      { name: 'apple_calendar_create', description: 'Create an iCloud Calendar event.', toolset: 'apple-calendar', required: ['calendar', 'title'] },
    ]));
    expect(out).toContain('apple_calendar_create(calendar, title) — Create an iCloud Calendar event.');
  });

  it('shows empty parentheses when a tool needs nothing, rather than saying nothing', () => {
    const out = renderContext(pack([
      { name: 'workflow_list', description: 'List existing workflows.', toolset: 'workflows' },
    ]));
    // `workflow_list()` reads as "takes no required arguments". Omitting the
    // parens entirely would read as "arguments unknown", which is the state
    // this change exists to end.
    expect(out).toContain('workflow_list() — List existing workflows.');
  });

  it('truncates a long description instead of rebuilding the manifest', () => {
    const long = 'x'.repeat(MAX_TOOL_DESC + 200);
    const out = renderContext(pack([{ name: 'verbose_tool', description: long, toolset: 'misc' }]));
    const line = out.split('\n').find((l) => l.startsWith('- verbose_tool'))!;
    expect(line.length).toBeLessThan(MAX_TOOL_DESC + 40);
    expect(line).toContain('…');
  });

  it('groups by toolset and explains the format it is using', () => {
    const out = renderContext(pack([
      { name: 'a_one', description: 'A.', toolset: 'alpha' },
      { name: 'b_one', description: 'B.', toolset: 'beta', required: ['id'] },
    ]));
    expect(out).toContain('### alpha');
    expect(out).toContain('### beta');
    expect(out).toContain('Format: `name(requiredArgs)');
    // A reader must know that anything unlisted is optional, or it will treat
    // the required list as the complete argument set.
    expect(out).toMatch(/not listed are optional/i);
  });

  it('survives a tool with no description at all', () => {
    const out = renderContext(pack([{ name: 'bare', description: '', toolset: 'misc' }]));
    expect(out).toContain('- bare()');
    expect(out).not.toContain('bare() — ');
  });
});
