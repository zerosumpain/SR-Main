import { describe, it, expect } from 'vitest';
import { readId, readWorkflowId, missingIdError, WORKFLOW_ID_ALIASES } from './_arg-id';

describe('reading an id under whichever name the caller used', () => {
  it('accepts the spellings that actually appeared on live calls', () => {
    // Over 30 days `workflow_inspect` took 73 calls: 38 `id`, 17 `workflowId`,
    // 4 `id_or_slug`. The last two reached eq(workflows.id, undefined) and came
    // back "Workflow not found".
    for (const key of ['workflowId', 'workflow_id', 'id', 'id_or_slug', 'idOrSlug', 'workflow']) {
      expect(readWorkflowId({ [key]: 'wf-123' }), key).toBe('wf-123');
    }
  });

  it('prefers the declared name when several are present', () => {
    // A caller that got it right is never second-guessed by a stray alias.
    expect(readWorkflowId({ workflowId: 'right', id: 'wrong', id_or_slug: 'also-wrong' })).toBe('right');
  });

  it('generates the snake_case sibling for any canonical name', () => {
    expect(readId({ node_id: 'n1' }, 'nodeId')).toBe('n1');
    expect(readId({ nodeId: 'n1' }, 'nodeId')).toBe('n1');
    expect(readId({ schedule_id: 's1' }, 'scheduleId')).toBe('s1');
    expect(readId({ run_id: 'r1' }, 'runId')).toBe('r1');
  });

  it('falls back to a bare `id` on single-id tools', () => {
    expect(readId({ id: 'n1' }, 'nodeId')).toBe('n1');
  });

  it('refuses a bare `id` on two-id tools, where it is genuinely ambiguous', () => {
    // workflow_subscribe takes buildId AND workflowId. Guessing which one a
    // bare `id` meant is how you subscribe the wrong build.
    expect(readId({ id: 'ambiguous' }, 'buildId', { allowBareId: false })).toBe('');
    expect(readId({ id: 'ambiguous' }, 'workflowId', { allowBareId: false })).toBe('');
    // The explicit name still works there, of course.
    expect(readId({ buildId: 'b1', workflowId: 'w1' }, 'buildId', { allowBareId: false })).toBe('b1');
  });

  it('trims, and ignores anything that is not a usable string', () => {
    expect(readWorkflowId({ workflowId: '  wf-1  ' })).toBe('wf-1');
    expect(readWorkflowId({ workflowId: '   ' })).toBe('');
    expect(readWorkflowId({ workflowId: 42 } as never)).toBe('');
    expect(readWorkflowId({ workflowId: null } as never)).toBe('');
    expect(readWorkflowId({})).toBe('');
    expect(readWorkflowId(undefined)).toBe('');
    expect(readWorkflowId(null)).toBe('');
  });

  it('keeps the live aliases documented in one place', () => {
    expect(WORKFLOW_ID_ALIASES).toContain('id_or_slug');
  });
});

describe('the message for a call that named no id', () => {
  it('blames the call, not the estate', () => {
    const msg = missingIdError('workflow', 'workflowId');
    // "Workflow not found" asserts something about the workflows — so the
    // next move is to go and re-list them, which is most of why
    // workflow_list ran 23 times for 4 distinct argument sets.
    expect(msg).not.toMatch(/not found/i);
    expect(msg).toMatch(/problem with the call/i);
    expect(msg).toMatch(/nothing has been looked up/i);
  });

  it('names every spelling that would have worked', () => {
    const msg = missingIdError('workflow', 'workflowId');
    expect(msg).toContain('workflowId');
    expect(msg).toContain('workflow_id');
    expect(msg).toContain('`id`');
  });

  it('is written for whichever subject it is given', () => {
    expect(missingIdError('node', 'nodeId')).toContain('node_id');
    expect(missingIdError('schedule', 'scheduleId')).toContain('schedule_id');
  });
});
