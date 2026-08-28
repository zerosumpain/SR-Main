import { describe, it, expect } from 'vitest';
import { cleanAssistantContent } from '$lib/jkai/intel/chat-extract';

// What the extractor is shown decides what the graph learns. Production threads
// carry two kinds of assistant row that are not knowledge: the inline
// tool-call log (it writes progress into the TEXT stream, so it is stored as
// message content) and slash-command echoes like /model's confirmation. Fed to
// the extractor they invite entities named after MCP tools and model slugs, and
// — before this — they also counted as turns, shifting the extraction cadence
// off the real replies.
describe('cleanAssistantContent', () => {
  it('strips tool-log lines but keeps the answer', () => {
    const raw = [
      '⚙️ mcp_jkai_knowledge_search: "data spine"',
      '⚙️ mcp_jkai_jkai_extended: "file_read" (×2)',
      '',
      'The Data Spine is a proposed education data-exchange architecture.',
    ].join('\n');

    const cleaned = cleanAssistantContent(raw);

    expect(cleaned).toBe('The Data Spine is a proposed education data-exchange architecture.');
    expect(cleaned).not.toContain('mcp_jkai');
  });

  it('drops a slash-command echo entirely', () => {
    const raw = [
      'Model switched to `z-ai/glm-5.2`',
      'Provider: OpenRouter',
      'Context: 1,048,576 tokens',
    ].join('\n');

    expect(cleanAssistantContent(raw)).toBe('');
  });

  it('leaves an ordinary reply untouched', () => {
    const raw = 'Estonia and Denmark both run a national data-exchange layer.';
    expect(cleanAssistantContent(raw)).toBe(raw);
  });

  it('returns empty for a turn that was nothing but tool log', () => {
    expect(cleanAssistantContent('⚙️ mcp_jkai_jkai_extended: "file_list"')).toBe('');
  });
});
