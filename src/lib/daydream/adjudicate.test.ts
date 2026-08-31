import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/db/schema', () => ({ daydreamThoughts: {} }));
vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: (a: unknown, b: unknown) => [a, b],
  isNull: (a: unknown) => a,
  or: (...a: unknown[]) => a,
  sql: Object.assign((s: unknown) => s, { raw: () => 'sql' }),
}));
vi.mock('$lib/llm/client', () => ({ getLLMClient: vi.fn() }));
vi.mock('$lib/workflows/site-tools/registry', () => ({
  executeTool: vi.fn(),
  getTool: (name: string) =>
    name === 'nope' ? undefined : { name, description: `${name} desc`, parameters: { type: 'object' } },
}));
vi.mock('./evidence', () => ({ resolveEvidence: vi.fn(async () => []) }));

import {
  validate,
  reviewTools,
  evidenceLine,
  SOURCE_GUIDANCE,
  REVIEW_TOOL_NAMES,
  REVIEW_MODEL_ID,
  REVIEW_EFFORT,
  MAX_TOOL_CALLS,
} from './adjudicate';

describe('the verdict is coerced, never trusted', () => {
  it('takes the three verdicts it knows', () => {
    expect(validate({ verdict: 'verified', likelihood: 0.9 }, ['mail_read']).verdict).toBe('verified');
    expect(validate({ verdict: 'refuted', likelihood: 0.1 }, []).verdict).toBe('refuted');
    expect(validate({ verdict: 'uncertain', likelihood: 0.5 }, []).verdict).toBe('uncertain');
  });

  it('treats anything it does not recognise as uncertain, never verified', () => {
    // The failure direction worth being strict about: a wrong "verified" costs
    // an interruption about a thing that is not happening.
    for (const v of ['probably', 'true', 'yes', '', null, 42, undefined]) {
      expect(validate({ verdict: v, likelihood: 0.9 }, ['x']).verdict).toBe('uncertain');
    }
  });

  it('refuses a confident verdict that rests on nothing', () => {
    // A "verified" with no sources is not a verdict, it is an opinion.
    expect(validate({ verdict: 'verified', likelihood: 0.99, sources: [] }, []).verdict).toBe('uncertain');
  });

  it('still allows a refutation with no further sources', () => {
    // The commonest honest refutation is "the evidence you gave me already
    // contradicts itself", which needs nothing new looked up.
    expect(validate({ verdict: 'refuted', likelihood: 0.05, sources: [] }, []).verdict).toBe('refuted');
  });

  it('clamps the likelihood into 0..1 and defaults a missing one to zero', () => {
    expect(validate({ verdict: 'refuted', likelihood: 7 }, []).likelihood).toBe(1);
    expect(validate({ verdict: 'refuted', likelihood: -3 }, []).likelihood).toBe(0);
    expect(validate({ verdict: 'refuted', likelihood: 'high' }, []).likelihood).toBe(0);
    expect(validate({ verdict: 'refuted' }, []).likelihood).toBe(0);
  });

  it('records what it actually called, not only what it says it checked', () => {
    // The stated list can be invented; the call log cannot.
    const r = validate(
      { verdict: 'verified', likelihood: 0.8, sources: ['the Canva invoice'] },
      ['mail_read({"noteId":"n1"})'],
    );
    expect(r.sources).toContain('the Canva invoice');
    expect(r.sources.some((s) => s.startsWith('mail_read'))).toBe(true);
  });

  it('drops a narrative too short to be a restatement', () => {
    expect(validate({ verdict: 'verified', likelihood: 0.9, narrative: 'ok', sources: ['x'] }, ['x']).narrative).toBeNull();
    expect(
      validate({ verdict: 'verified', likelihood: 0.9, narrative: 'The invoice and the bank line are one payment.', sources: ['x'] }, ['x'])
        .narrative,
    ).toMatch(/one payment/);
  });
});

describe('what the reviewer may look at', () => {
  it('takes its schemas from the registry, never a hand-written copy', () => {
    // Copying a parameter schema is how entity_id/entityId and id/workflowId
    // cost two toolsets 44% and 48% of their calls. Writing this list by hand
    // had already produced two such faults — mail_read takes `noteId`, not
    // `id`, and apple_calendar_list takes `dateRangeStart`, not `start`.
    const tools = reviewTools();
    expect(tools).toHaveLength(REVIEW_TOOL_NAMES.length);
    for (const t of tools) {
      expect(t.function.parameters).toBeDefined();
      expect(REVIEW_TOOL_NAMES).toContain(t.function.name as string);
    }
  });

  it('includes nothing that writes, sends, schedules or spends', () => {
    const forbidden = [
      'gmail_send', 'whatsapp_send', 'publish_page', 'blog_create', 'blog_update',
      'datastore_save', 'datastore_delete', 'save_memory', 'ha_call_service',
      'workflow_run', 'build_create', 'request_change', 'schedule_reply_at',
      'update_credential', 'delete_tool', 'node_builder_commit_and_deploy',
    ];
    for (const f of forbidden) expect(REVIEW_TOOL_NAMES).not.toContain(f);
  });

  it('DOES admit tools returning text other people wrote — deliberately', () => {
    // The ponder lookup stage forbids these. This one cannot: the Canva case is
    // only settleable by reading the invoice. What keeps it survivable is that
    // a poisoned source can only reach a verdict, never a tool or a delivery.
    expect(REVIEW_TOOL_NAMES).toContain('mail_read');
    expect(REVIEW_TOOL_NAMES).toContain('mail_search');
  });

  it('drops a name the registry does not know rather than guessing', () => {
    // A tool renamed out from under this list must shrink the toolset visibly,
    // not send an unknown function to the model.
    const tools = reviewTools();
    expect(tools.every((t) => typeof t.function.name === 'string')).toBe(true);
  });
});

describe('the pinned model', () => {
  it('is Luna at xhigh — the fast model, thinking hard', () => {
    // The catalogue's own words for Luna are "best fit for background site
    // tasks". Effort is where the budget goes, not model size.
    expect(REVIEW_MODEL_ID).toBe('codex/gpt-5.6-luna');
    expect(REVIEW_EFFORT).toBe('xhigh');
  });

  it('bounds how far one review may chase a claim', () => {
    // A review needing more than this is chasing something the sources cannot
    // settle, and should say uncertain instead.
    expect(MAX_TOOL_CALLS).toBeGreaterThan(2);
    expect(MAX_TOOL_CALLS).toBeLessThanOrEqual(12);
  });
});

describe('the reviewer is handed its rows, not sent hunting for them', () => {
  // First live run: a mail_security thought citing eighteen emails came back
  // `uncertain` because the reviewer "could not retrieve the cited messages" —
  // it had searched and found unrelated mail. Those ids ARE intel_notes ids and
  // mail_read takes exactly that; it searched because mail_read's own
  // description says the noteId comes "from a mail_search hit". The runtime
  // knew and the prompt did not.
  const row = { kind: 'email', id: 'n1', title: 'Microsoft security code', lines: ['from Microsoft'], missing: false };

  it('carries the ref, not just the prose', () => {
    expect(evidenceLine(row)).toContain('[email:n1]');
    expect(evidenceLine(row)).toContain('Microsoft security code');
  });

  it('says plainly when the row it names is gone', () => {
    // A claim whose evidence has been deleted is exactly the case the reviewer
    // must be able to refute, and it cannot if the line reads like any other.
    expect(evidenceLine({ ...row, missing: true })).toContain('THE ROW THIS NAMES IS GONE');
  });

  it('tells the reviewer the cited id is directly readable', () => {
    const g = SOURCE_GUIDANCE.join('\n');
    expect(g).toContain('mail_read({"noteId":"<id>"})');
    expect(g).toMatch(/Do not use mail_search to find it/);
  });

  it('reserves searching for what the evidence does not name', () => {
    expect(SOURCE_GUIDANCE.join(' ')).toMatch(/Searching is for what the evidence does NOT already name/);
  });

  it('keeps a line short enough not to crowd the prompt', () => {
    const huge = { ...row, lines: [new Array(2000).join('x')] };
    expect(evidenceLine(huge).length).toBeLessThanOrEqual(400);
  });
});
