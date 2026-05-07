// tests/lib/curate/engine-orchestrator.test.ts
//
// Unit tests for the pure-logic helpers in engine.ts (Phase 7).
// Streaming + LLM-driven flows are integration territory and are not tested here.

import { describe, it, expect } from 'vitest';
import { extractGoal, extractProposal } from '$lib/curate/engine';

// ── extractGoal ──────────────────────────────────────────────────────────

describe('extractGoal', () => {
  it('returns the goal when GOAL: appears on its own line', () => {
    const text = `I have some questions for you.

GOAL: Fetch events from an Apple Calendar account using CalDAV.`;
    expect(extractGoal(text)).toBe(
      'Fetch events from an Apple Calendar account using CalDAV.',
    );
  });

  it('returns null when no GOAL: line is present', () => {
    expect(extractGoal('Just chatting, no goal yet.')).toBeNull();
  });

  it('handles leading whitespace before GOAL:', () => {
    const text = '  GOAL: Sync tasks from Todoist to a local DB.';
    expect(extractGoal(text)).toBe('Sync tasks from Todoist to a local DB.');
  });

  it('does not match GOAL: embedded mid-sentence', () => {
    // "GOAL:" must start the (trimmed) line — mid-line occurrence is ignored.
    const text = 'The GOAL: here is ambiguous';
    // The line trimmed starts with "The", not "GOAL:" → null.
    expect(extractGoal(text)).toBeNull();
  });

  it('returns the first GOAL: line when multiple exist', () => {
    const text = 'GOAL: First goal.\nGOAL: Second goal.';
    expect(extractGoal(text)).toBe('First goal.');
  });

  it('trims trailing whitespace from the extracted goal', () => {
    const text = 'GOAL:   Lots of trailing spaces.   ';
    expect(extractGoal(text)).toBe('Lots of trailing spaces.');
  });

  it('returns null for empty string', () => {
    expect(extractGoal('')).toBeNull();
  });
});

// ── extractProposal ──────────────────────────────────────────────────────

describe('extractProposal', () => {
  it('extracts a valid JSON proposal from a <proposal> block', () => {
    const text = `Some research narration...

<proposal>
{"type":"apple-calendar","label":"Apple Calendar"}
</proposal>

More prose after.`;
    const result = extractProposal(text);
    expect(result).toEqual({ type: 'apple-calendar', label: 'Apple Calendar' });
  });

  it('returns null when no <proposal> block is present', () => {
    expect(extractProposal('Just narration, no proposal yet.')).toBeNull();
  });

  it('returns null when the <proposal> block contains invalid JSON', () => {
    const text = '<proposal>not valid json {{{</proposal>';
    expect(extractProposal(text)).toBeNull();
  });

  it('handles multi-line JSON inside the block', () => {
    const text = `<proposal>
{
  "type": "github-issues",
  "label": "GitHub Issues",
  "category": "data"
}
</proposal>`;
    const result = extractProposal(text);
    expect(result).toEqual({ type: 'github-issues', label: 'GitHub Issues', category: 'data' });
  });

  it('tolerates prose both before and after the proposal block', () => {
    const text = `I have researched extensively. Here is my proposal:

<proposal>{"type":"slack-message"}</proposal>

Thank you for your patience.`;
    const result = extractProposal(text);
    expect(result).toEqual({ type: 'slack-message' });
  });

  it('returns null for empty string', () => {
    expect(extractProposal('')).toBeNull();
  });

  it('returns null for a proposal block with only whitespace', () => {
    const text = '<proposal>   </proposal>';
    expect(extractProposal(text)).toBeNull();
  });
});
