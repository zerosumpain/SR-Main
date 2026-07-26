import { describe, it, expect } from 'vitest';
import {
  clampThreadLimit,
  CORRESPONDENCE_EDGE_TYPE,
  isPersonAddress,
  parseAddress,
  parseAddressList,
  refIdForThread,
  stripQuotedReply,
  structuralEdges,
  threadParticipants,
  threadToNoteText,
  type ThreadInput,
  type ThreadMessageInput,
} from './gmail-ingest';

function msg(over: Partial<ThreadMessageInput> & { headers?: ThreadMessageInput['headers'] } = {}): ThreadMessageInput {
  return {
    id: 'm1',
    headers: { from: 'John Kelly <john@x.com>', to: 'Alice Braun <alice@y.com>', subject: 'Q3 planning', ...over.headers },
    bodyText: 'Body.',
    internalDate: '1747094400000', // 2025-05-13T00:00:00Z
    ...over,
  };
}

function thread(messages: ThreadMessageInput[]): ThreadInput {
  return { id: 't1', messages };
}

// ---------------------------------------------------------------------------
// Address parsing
// ---------------------------------------------------------------------------

describe('parseAddress', () => {
  it('splits a display name from an angle-bracketed address', () => {
    expect(parseAddress('John Kelly <j@x.com>')).toEqual({ name: 'John Kelly', email: 'j@x.com' });
  });

  it('unquotes a quoted display name', () => {
    expect(parseAddress('"Kelly, John" <j@x.com>')).toEqual({ name: 'Kelly, John', email: 'j@x.com' });
  });

  it('lowercases the address but not the display name', () => {
    expect(parseAddress('John Kelly <John.Kelly@X.COM>')).toEqual({
      name: 'John Kelly',
      email: 'john.kelly@x.com',
    });
  });

  it('derives a name from an unambiguous dotted local part', () => {
    expect(parseAddress('john.kelly@x.com')).toEqual({ name: 'John Kelly', email: 'john.kelly@x.com' });
  });

  it('keeps the raw address when the local part is not clearly a name', () => {
    expect(parseAddress('j.smith@x.com')?.name).toBe('j.smith@x.com');
    expect(parseAddress('jk@x.com')?.name).toBe('jk@x.com');
    expect(parseAddress('svc-ops2@x.com')?.name).toBe('svc-ops2@x.com');
  });

  it('does not treat the address repeated in the display slot as a name', () => {
    expect(parseAddress('jk@x.com <jk@x.com>')?.name).toBe('jk@x.com');
  });

  it('strips a mailto: prefix', () => {
    expect(parseAddress('<mailto:j@x.com>')?.email).toBe('j@x.com');
  });

  it('rejects anything that is not a mailbox', () => {
    expect(parseAddress('')).toBeNull();
    expect(parseAddress(null)).toBeNull();
    expect(parseAddress('undisclosed-recipients:;')).toBeNull();
    expect(parseAddress('Just A Name')).toBeNull();
    expect(parseAddress('not-an-email@localhost')).toBeNull();
  });
});

describe('parseAddressList', () => {
  it('does not split inside a quoted display name', () => {
    expect(parseAddressList('"Kelly, John" <j@x.com>, alice@y.com')).toEqual([
      { name: 'Kelly, John', email: 'j@x.com' },
      { name: 'alice@y.com', email: 'alice@y.com' },
    ]);
  });

  it('accepts semicolon-separated lists', () => {
    expect(parseAddressList('a.one@x.com; b.two@x.com').map((a) => a.email)).toEqual([
      'a.one@x.com',
      'b.two@x.com',
    ]);
  });

  it('dedupes repeated addresses, keeping the first spelling', () => {
    const list = parseAddressList('John Kelly <j@x.com>, JK <J@X.COM>');
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ name: 'John Kelly', email: 'j@x.com' });
  });

  it('returns nothing for an empty or absent header', () => {
    expect(parseAddressList('')).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe('isPersonAddress', () => {
  it('rejects the usual robots', () => {
    for (const addr of [
      'noreply@x.com',
      'no-reply@x.com',
      'no.reply@x.com',
      'donotreply@x.com',
      'do-not-reply@x.com',
      'mailer-daemon@x.com',
      'postmaster@x.com',
      'notifications@x.com',
      'bounces@x.com',
      'newsletter@x.com',
      'jira-noreply@x.com',
      'anything@bounces.x.com',
    ]) {
      expect(isPersonAddress(addr), addr).toBe(false);
    }
  });

  it('accepts ordinary human addresses', () => {
    for (const addr of ['john.kelly@x.com', 'jk@x.com', 'alice@y.gov.uk', 'reply.smith@x.com']) {
      expect(isPersonAddress(addr), addr).toBe(true);
    }
  });

  it('rejects malformed input rather than guessing', () => {
    expect(isPersonAddress('')).toBe(false);
    expect(isPersonAddress('nodomain')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Quote stripping — the part that decides whether extraction sees signal
// ---------------------------------------------------------------------------

describe('stripQuotedReply', () => {
  it('cuts a Gmail attribution and everything under it', () => {
    const body = [
      'Yes, Thursday works.',
      '',
      'On Mon, 12 May 2025 at 09:14, Alice Braun <alice@y.com> wrote:',
      '> Can we move the review to Thursday?',
      '> Alice',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Yes, Thursday works.');
  });

  it('cuts an attribution that Gmail wrapped over several lines', () => {
    const body = [
      'Agreed.',
      '',
      'On Mon, 12 May 2025 at 09:14, Alice Braun',
      '<alice.braun@somewhere.example.com>',
      'wrote:',
      '> original text',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Agreed.');
  });

  it('does not cut a body sentence that merely resembles an attribution', () => {
    const body = 'On the risk register, the entry Alice wrote: it needs an owner.';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('collapses a 12-deep quote chain to the one new paragraph', () => {
    const chain: string[] = ['The answer is yes.', ''];
    for (let depth = 1; depth <= 12; depth++) {
      chain.push(`${'>'.repeat(depth)} nested reply at depth ${depth}`);
    }
    const out = stripQuotedReply(chain.join('\n'));
    expect(out).toBe('The answer is yes.');
    expect(out).not.toMatch(/depth/);
  });

  it('keeps fresh text that is interleaved between quoted lines', () => {
    const body = ['> Do you agree?', 'Yes.', '> And the date?', 'The 14th.'].join('\n');
    expect(stripQuotedReply(body)).toBe('Yes.\nThe 14th.');
  });

  it('cuts the Outlook original-message divider', () => {
    const body = ['Noted, thanks.', '', '-----Original Message-----', 'From: Alice', 'Old text'].join('\n');
    expect(stripQuotedReply(body)).toBe('Noted, thanks.');
  });

  it('cuts an Outlook quoted header block', () => {
    const body = [
      'See below.',
      '',
      'From: Alice Braun <alice@y.com>',
      'Sent: 12 May 2025 09:14',
      'To: John Kelly',
      'Subject: Q3',
      '',
      'Old text.',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('See below.');
  });

  it('cuts the Outlook underscore rule', () => {
    const body = ['Fine by me.', '________________________________', 'From: Alice', 'Old'].join('\n');
    expect(stripQuotedReply(body)).toBe('Fine by me.');
  });

  it('cuts forwarded chains, which are copies of other messages', () => {
    const body = ['FYI', '', '---------- Forwarded message ---------', 'From: Alice', 'Old text.'].join('\n');
    expect(stripQuotedReply(body)).toBe('FYI');
  });

  it('cuts an old-style Gmail date attribution', () => {
    const body = ['Sure.', '', '2025-05-12 9:14 GMT+01:00 Alice Braun <alice@y.com>:', '> old'].join('\n');
    expect(stripQuotedReply(body)).toBe('Sure.');
  });

  it('removes signatures', () => {
    expect(stripQuotedReply('Thanks.\n\n-- \nJohn Kelly\nHead of Data')).toBe('Thanks.');
    expect(stripQuotedReply('On my way.\n\nSent from my iPhone')).toBe('On my way.');
    expect(stripQuotedReply('Done.\n\nGet Outlook for Android')).toBe('Done.');
  });

  it('removes a confidentiality disclaimer', () => {
    const body = [
      'Approved.',
      '',
      'This email and any attachments are confidential and intended solely for the addressee.',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Approved.');
  });

  it('normalises whitespace, non-breaking spaces and inline attachment markers', () => {
    const body = 'First line.\r\n\r\n\r\n\r\n[image: logo.png]\r\nSecond line.​';
    expect(stripQuotedReply(body)).toBe('First line.\n\nSecond line.');
  });

  it('returns an empty string for an empty or quote-only body', () => {
    expect(stripQuotedReply('')).toBe('');
    expect(stripQuotedReply(null)).toBe('');
    expect(stripQuotedReply('   \n\n  ')).toBe('');
    expect(stripQuotedReply('> only a quote\n>> and a deeper one')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Thread → note text
// ---------------------------------------------------------------------------

describe('threadToNoteText', () => {
  it('returns nothing for a thread with no messages', () => {
    expect(threadToNoteText(thread([]))).toBe('');
  });

  it('writes a subject, participant and message header block', () => {
    const text = threadToNoteText(thread([msg()]));
    expect(text).toContain('Subject: Q3 planning');
    expect(text).toContain('Participants: John Kelly <john@x.com>, Alice Braun <alice@y.com>');
    expect(text).toContain('Messages: 1 (2025-05-13)');
  });

  it('strips reply prefixes from the thread subject', () => {
    const text = threadToNoteText(thread([msg({ headers: { from: 'a.one@x.com', subject: 'Re: Fwd: Q3 planning' } })]));
    expect(text).toContain('Subject: Q3 planning');
  });

  it('numbers messages and carries only their fresh text', () => {
    const text = threadToNoteText(
      thread([
        msg({ id: 'm1', bodyText: 'Shall we meet Thursday?' }),
        msg({
          id: 'm2',
          headers: { from: 'Alice Braun <alice@y.com>', to: 'John Kelly <john@x.com>', subject: 'Re: Q3 planning' },
          bodyText: 'Thursday works.\n\nOn Mon, 12 May 2025 at 09:14, John Kelly <john@x.com> wrote:\n> Shall we meet Thursday?',
        }),
      ]),
    );
    expect(text).toContain('[1]');
    expect(text).toContain('Shall we meet Thursday?');
    expect(text).toContain('[2]');
    expect(text).toContain('Thursday works.');
    // The question appears once, as the message that asked it — not again as a quote.
    expect(text.match(/Shall we meet Thursday\?/g)).toHaveLength(1);
  });

  it('omits messages whose whole contribution was quoted', () => {
    const text = threadToNoteText(
      thread([
        msg({ id: 'm1', bodyText: 'Real content here.' }),
        msg({ id: 'm2', bodyText: '> Real content here.' }),
      ]),
    );
    expect(text).toContain('[1]');
    expect(text).not.toContain('[2]');
  });

  it('keeps the header block when every message body is empty', () => {
    const text = threadToNoteText(thread([msg({ bodyText: '> nothing new' })]));
    expect(text).toContain('Subject: Q3 planning');
    expect(text).not.toContain('[1]');
  });

  it('shows a date span across a multi-day thread', () => {
    const text = threadToNoteText(
      thread([
        msg({ id: 'm1', internalDate: '1747094400000' }), // 2025-05-13
        msg({ id: 'm2', internalDate: '1747267200000' }), // 2025-05-15
      ]),
    );
    expect(text).toContain('Messages: 2 (2025-05-13 → 2025-05-15)');
  });

  it('falls back to the Date header when internalDate is absent', () => {
    const text = threadToNoteText(
      thread([msg({ internalDate: undefined, headers: { from: 'a.one@x.com', date: 'Tue, 13 May 2025 10:00:00 +0000' } })]),
    );
    expect(text).toContain('2025-05-13');
  });
});

// ---------------------------------------------------------------------------
// Structural edges — the zero-LLM half
// ---------------------------------------------------------------------------

describe('threadParticipants', () => {
  it('collects senders, recipients and cc, deduped across messages', () => {
    const people = threadParticipants(
      thread([
        msg({ headers: { from: 'John Kelly <john@x.com>', to: 'alice@y.com', cc: 'Bob Vance <bob@z.com>' } }),
        msg({ headers: { from: 'alice@y.com', to: 'John Kelly <john@x.com>' } }),
      ]),
    );
    expect(people.map((p) => p.email)).toEqual(['john@x.com', 'alice@y.com', 'bob@z.com']);
  });

  it('upgrades a bare address once a later message supplies a display name', () => {
    const people = threadParticipants(
      thread([
        msg({ headers: { from: 'jk@x.com', to: 'alice@y.com' } }),
        msg({ headers: { from: 'John Kelly <jk@x.com>', to: 'alice@y.com' } }),
      ]),
    );
    expect(people[0]).toEqual({ name: 'John Kelly', email: 'jk@x.com' });
  });

  it('drops robot addresses', () => {
    const people = threadParticipants(
      thread([msg({ headers: { from: 'noreply@jira.x.com', to: 'John Kelly <john@x.com>' } })]),
    );
    expect(people.map((p) => p.email)).toEqual(['john@x.com']);
  });
});

describe('structuralEdges', () => {
  it('makes every participant a person entity carrying its address', () => {
    const out = structuralEdges(thread([msg()]));
    expect(out.entities).toEqual([
      { name: 'John Kelly', type: 'person', confidence: 'high', properties: { email: 'john@x.com' }, possibleMatchId: null },
      { name: 'Alice Braun', type: 'person', confidence: 'high', properties: { email: 'alice@y.com' }, possibleMatchId: null },
    ]);
  });

  it('emits a directed correspondence edge per sender/recipient pair', () => {
    const out = structuralEdges(
      thread([msg({ headers: { from: 'John Kelly <john@x.com>', to: 'Alice Braun <alice@y.com>, Bob Vance <bob@z.com>' } })]),
    );
    expect(out.relationships).toHaveLength(2);
    expect(out.relationships[0]).toMatchObject({
      source: 'John Kelly',
      target: 'Alice Braun',
      type: CORRESPONDENCE_EDGE_TYPE,
      confidence: 'high',
    });
    expect(out.relationships[1]).toMatchObject({ source: 'John Kelly', target: 'Bob Vance' });
  });

  it('dedupes the same pair across repeated messages', () => {
    const out = structuralEdges(thread([msg({ id: 'm1' }), msg({ id: 'm2' }), msg({ id: 'm3' })]));
    expect(out.relationships).toHaveLength(1);
  });

  it('keeps both directions when correspondence goes both ways', () => {
    const out = structuralEdges(
      thread([
        msg({ headers: { from: 'John Kelly <john@x.com>', to: 'Alice Braun <alice@y.com>' } }),
        msg({ headers: { from: 'Alice Braun <alice@y.com>', to: 'John Kelly <john@x.com>' } }),
      ]),
    );
    expect(out.relationships.map((r) => `${r.source}->${r.target}`)).toEqual([
      'John Kelly->Alice Braun',
      'Alice Braun->John Kelly',
    ]);
  });

  it('never emits a self-edge when the sender is also a recipient', () => {
    const out = structuralEdges(
      thread([msg({ headers: { from: 'John Kelly <john@x.com>', to: 'john@x.com, Alice Braun <alice@y.com>', cc: 'JOHN@X.COM' } })]),
    );
    expect(out.relationships).toHaveLength(1);
    expect(out.relationships[0].target).toBe('Alice Braun');
    expect(out.relationships.some((r) => r.source === r.target)).toBe(false);
  });

  it('ignores robot senders and robot recipients', () => {
    const out = structuralEdges(
      thread([msg({ headers: { from: 'noreply@x.com', to: 'John Kelly <john@x.com>, Alice Braun <alice@y.com>' } })]),
    );
    expect(out.entities.map((e) => e.name)).toEqual(['John Kelly', 'Alice Braun']);
    expect(out.relationships).toEqual([]);
  });

  it('produces nothing for a one-participant thread', () => {
    const out = structuralEdges(thread([msg({ headers: { from: 'John Kelly <john@x.com>', to: 'john@x.com' } })]));
    expect(out.entities).toEqual([]);
    expect(out.relationships).toEqual([]);
  });

  it('refuses to wire up a distribution list', () => {
    const recipients = Array.from({ length: 40 }, (_, i) => `person.number${i}@x.com`).join(', ');
    const out = structuralEdges(thread([msg({ headers: { from: 'John Kelly <john@x.com>', to: recipients } })]));
    expect(out.broadcast).toBe(true);
    expect(out.entities).toEqual([]);
    expect(out.relationships).toEqual([]);
    expect(out.participants.length).toBeGreaterThan(25);
  });

  it('returns an extraction shape persistExtraction can consume unchanged', () => {
    const out = structuralEdges(thread([msg()]));
    expect(out.summary).toBe('');
    expect(out.timelineEvents).toEqual([]);
    expect(out.proposedNewTypes).toEqual([]);
  });

  it('handles an empty thread', () => {
    const out = structuralEdges(thread([]));
    expect(out).toMatchObject({ entities: [], relationships: [], participants: [], broadcast: false });
  });
});

// ---------------------------------------------------------------------------
// Sweep plumbing
// ---------------------------------------------------------------------------

describe('clampThreadLimit', () => {
  it('defaults, floors and caps', () => {
    expect(clampThreadLimit(undefined)).toBe(20);
    expect(clampThreadLimit(0)).toBe(20);
    expect(clampThreadLimit(-5)).toBe(20);
    expect(clampThreadLimit('abc')).toBe(20);
    expect(clampThreadLimit(7.9)).toBe(7);
    expect(clampThreadLimit(5000)).toBe(100);
  });
});

describe('refIdForThread', () => {
  it('namespaces the id so a thread cannot collide with a drive file', () => {
    expect(refIdForThread('18f2c')).toBe('gmail:18f2c');
  });
});
