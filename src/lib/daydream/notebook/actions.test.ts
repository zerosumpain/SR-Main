import { describe, expect, it } from 'vitest';
import {
  LINK_KINDS,
  MAX_CONTEXT,
  NOTE_ACTION_KINDS,
  SHORT_DEPTHS,
  validateNoteAction,
} from './actions';

const ok = (r: ReturnType<typeof validateNoteAction>) => {
  if (!('action' in r)) throw new Error(`expected an action, got: ${r.error}`);
  return r.action;
};
const err = (r: ReturnType<typeof validateNoteAction>) => {
  if ('action' in r) throw new Error('expected a refusal');
  return r.error;
};

describe('the vocabulary is closed', () => {
  it('is exactly the three kinds — widening it is a decision, not a refactor', () => {
    expect([...NOTE_ACTION_KINDS]).toEqual(['research', 'link', 'context']);
  });

  it('refuses a kind nobody granted', () => {
    for (const kind of ['remind', 'email', 'calendar_create', 'delete_note', '']) {
      expect(err(validateNoteAction({ kind, title: 'do a thing', params: {} }))).toContain(
        'unknown action kind',
      );
    }
  });

  it('refuses anything that is not an object', () => {
    for (const v of [null, undefined, 'research', 42, []]) {
      expect(() => ok(validateNoteAction(v))).toThrow();
    }
  });

  it('needs a real title, because the note lists it', () => {
    expect(err(validateNoteAction({ kind: 'context', title: 'x', params: { text: 'y'.repeat(50) } })))
      .toContain('title');
  });
});

describe('research is SHORT ONLY — the load-bearing refusal', () => {
  it('accepts the two budgeted tiers', () => {
    for (const depth of SHORT_DEPTHS) {
      const a = ok(
        validateNoteAction({
          kind: 'research',
          title: 'Find out about hydrogen boilers',
          params: { topic: 'hydrogen boiler retrofit costs UK', depth },
        }),
      );
      expect(a.params).toMatchObject({ depth });
    }
  });

  it('REFUSES investigation — it is unbounded and would run for 20+ minutes', () => {
    const e = err(
      validateNoteAction({
        kind: 'research',
        title: 'Look into it properly',
        params: { topic: 'hydrogen boiler retrofit costs UK', depth: 'investigation' },
      }),
    );
    expect(e).toContain('not a short run');
    expect(e).toContain('scan');
  });

  it('refuses rather than downgrades, so a model reaching past its limit is visible', () => {
    // Silently rewriting investigation -> scan would hide the single most
    // important thing this validator catches, and make it untestable.
    const e = err(
      validateNoteAction({
        kind: 'research',
        title: 'Deep dive',
        params: { topic: 'something worth knowing', depth: 'investigation' },
      }),
    );
    expect(e).not.toContain('using scan instead');
  });

  it('refuses a missing or invented depth', () => {
    for (const depth of ['', 'deep', 'exhaustive', 'INSTANT', undefined]) {
      expect(
        err(validateNoteAction({ kind: 'research', title: 'Look it up', params: { topic: 'a real topic', depth } })),
      ).toContain('depth');
    }
  });

  it('needs a topic worth searching for', () => {
    expect(err(validateNoteAction({ kind: 'research', title: 'Look it up', params: { topic: 'ab', depth: 'scan' } })))
      .toContain('topic');
  });

  it('caps goals at three and drops the empties', () => {
    const a = ok(
      validateNoteAction({
        kind: 'research',
        title: 'Look it up',
        params: {
          topic: 'a real topic here',
          depth: 'scan',
          goals: ['one', '  ', 'two', 'three', 'four', 5],
        },
      }),
    );
    expect((a.params as { goals: string[] }).goals).toEqual(['one', 'two', 'three']);
  });
});

describe('link', () => {
  it('accepts the four things the page can build a URL for', () => {
    for (const refKind of LINK_KINDS) {
      const a = ok(
        validateNoteAction({
          kind: 'link',
          title: 'Connect to the entity',
          params: { refKind, refId: 'abc123', why: 'the note names this organisation' },
        }),
      );
      expect(a.params).toMatchObject({ refKind, refId: 'abc123' });
    }
  });

  it('refuses a ref kind that has no page', () => {
    expect(
      err(validateNoteAction({
        kind: 'link',
        title: 'Connect it',
        params: { refKind: 'website', refId: 'x', why: 'because it seemed related' },
      })),
    ).toContain('refKind');
  });

  it('needs an id and a reason', () => {
    expect(err(validateNoteAction({ kind: 'link', title: 'Connect it', params: { refKind: 'note', why: 'a reason here' } }))).toContain('refId');
    expect(err(validateNoteAction({ kind: 'link', title: 'Connect it', params: { refKind: 'note', refId: 'n1', why: 'no' } }))).toContain('why');
  });
});

describe('context', () => {
  it('accepts a real paragraph', () => {
    const a = ok(
      validateNoteAction({
        kind: 'context',
        title: 'Background on the standard',
        params: { text: 'The standard was published in 2019 and supersedes the earlier one.' },
      }),
    );
    expect((a.params as { text: string }).text).toContain('2019');
  });

  it('refuses a stub', () => {
    expect(err(validateNoteAction({ kind: 'context', title: 'Some context', params: { text: 'see above' } })))
      .toContain('at least 20');
  });

  it('is capped, so one review cannot write an essay into a note', () => {
    const a = ok(
      validateNoteAction({
        kind: 'context',
        title: 'A lot of context',
        params: { text: 'x'.repeat(MAX_CONTEXT * 3) },
      }),
    );
    expect((a.params as { text: string }).text.length).toBe(MAX_CONTEXT);
  });
});
