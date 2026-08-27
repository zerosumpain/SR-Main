// The facts a rule is allowed to read.
//
// Worth testing hard because every downstream guarantee rests on them: a rule
// is backtested against these, the queue is ranked by these, and a fact that
// silently reports false makes an admit rule look narrower than it is.
//
// The note bodies below are the REAL shapes the sweep writes, taken from
// production: the current `Subject:` / `Messages:` / `[n] … from …` format, and
// the older header-only stub that 837 of the 2,781 live notes still carry.
import { describe, it, expect } from 'vitest';
import { factsFor, messageCountOf, sendersIn, subjectFamily } from './mail-facts';

const OWNER = 'johnkelly.main@googlemail.com';
const NOW = Date.UTC(2026, 7, 27);

function note(body: string, meta: Record<string, unknown> = {}, observedAt = '2026-08-20T09:00:00Z') {
  return {
    title: 'Subject line',
    rawContent: body,
    metadata: { gmailAccount: OWNER, participants: [OWNER, 'jane@example.com'], ...meta },
    observedAt,
    createdAt: observedAt,
  };
}

const TWO_WAY = `Subject: Tender deadline
Participants: Jane Doe <jane@example.com>, John Kelly <${OWNER}>
Messages: 3 (2026-08-18 → 2026-08-20)

[1] 2026-08-18 · from Jane Doe <jane@example.com> · to John Kelly <${OWNER}>
Can you get the tender in by the 14th?

[2] 2026-08-19 · from John Kelly <${OWNER}> · to Jane Doe <jane@example.com>
Yes, drafting it now.

[3] 2026-08-20 · from Jane Doe <jane@example.com> · to John Kelly <${OWNER}>
Great, thanks.`;

const BROADCAST = `Subject: 30% off everything
Participants: send.shop.com, John Kelly <${OWNER}>
Messages: 1 (2026-08-20)

[1] 2026-08-20 · from Shop <offers@send.shop.com> · to John Kelly <${OWNER}>
Our summer sale ends tonight.`;

/** The pre-2026-08 structural stub. No body was ever captured for these. */
const STUB = `Email thread: Supa Update July 2026
Participants: welcome@supabase.com, ${OWNER}`;

describe('messageCountOf', () => {
  it('reads the header the note opens with', () => {
    expect(messageCountOf(TWO_WAY)).toBe(3);
  });

  it('falls back to counting message blocks when the header is missing', () => {
    expect(messageCountOf('[1] x\nhello\n\n[2] y\nthere')).toBe(2);
  });

  it('reports a stub with no messages as one, not zero', () => {
    expect(messageCountOf(STUB)).toBe(1);
  });
});

describe('sendersIn', () => {
  it('finds every sender in a thread', () => {
    expect(sendersIn(TWO_WAY).sort()).toEqual(['jane@example.com', OWNER].sort());
  });

  it('finds a sender that has no display name', () => {
    // `formatAddress` prints a bare address when there is no name, and the
    // angle-bracket pattern alone misses the whole class of threads that
    // produces — which would report ownerReplied false for all of them.
    const bare = `[1] 2026-08-20 · from ${OWNER} · to jane@example.com\nhello`;
    expect(sendersIn(bare)).toContain(OWNER);
  });

  it('does not treat a recipient as a sender', () => {
    expect(sendersIn(BROADCAST)).not.toContain(OWNER);
  });

  it('does not read the RECIPIENT as the sender when the sender has no display name', () => {
    // The exact production line that exposed this. One message, from PayPal,
    // owner only on the `to` side. The old pattern let `[^<\n]*` run past the
    // bare sender and capture <johnkelly.main@gmail.com>, so every transactional
    // email of this shape backtested as a thread the owner had replied to.
    const receipt = [
      'Subject: HUBX STUDIOS LTD: $1.99 USD',
      'Participants: service@paypal.co.uk, John Kelly <johnkelly.main@gmail.com>',
      'Messages: 1 (2026-08-27)',
      '',
      '[1] · 2026-08-27 · from service@paypal.co.uk · to John Kelly <johnkelly.main@gmail.com>',
      "You've authorised $1.99 USD to HUBX STUDIOS LTD",
    ].join('\n');
    expect(sendersIn(receipt)).toEqual(['service@paypal.co.uk']);
  });

  it('still reads a sender that has BOTH a display name and angle brackets', () => {
    const line = '[1] · 2026-08-01 · from Jane Doe <jane@x.com> · to John Kelly <me@x.com>';
    expect(sendersIn(line)).toEqual(['jane@x.com']);
  });
});

describe('subjectFamily', () => {
  it('collapses order numbers so one family is one decision', () => {
    expect(subjectFamily('Your order #204-3656435 has shipped')).toBe(
      subjectFamily('Your order #887-1120994 has shipped'),
    );
  });

  it('strips reply and forward prefixes', () => {
    expect(subjectFamily('Re: Fwd: Tender deadline')).toBe(subjectFamily('Tender deadline'));
  });

  it('keeps genuinely different subjects apart', () => {
    expect(subjectFamily('Tender deadline')).not.toBe(subjectFamily('Invoice attached'));
  });
});

describe('factsFor', () => {
  it('reads a two-way conversation as two-way and replied-to', () => {
    const facts = factsFor(note(TWO_WAY, { emailKind: 'correspondence', senderDomain: 'example.com' }), NOW);
    expect(facts.ownerReplied).toBe(true);
    expect(facts.twoWay).toBe(true);
    expect(facts.messageCount).toBe(3);
    expect(facts.emailKind).toBe('correspondence');
    expect(facts.senderDomain).toBe('example.com');
  });

  it('does not call a one-way mailshot two-way, however many participants it has', () => {
    // The trap this guards: a mailshot to fifty people has fifty participants
    // and one sender. Counting participants instead of senders would admit
    // every newsletter in the mailbox.
    const facts = factsFor(
      note(BROADCAST, {
        emailKind: 'bulk',
        senderDomain: 'send.shop.com',
        participants: ['offers@send.shop.com', OWNER, ...Array.from({ length: 48 }, (_, i) => `p${i}@x.com`)],
      }),
      NOW,
    );
    expect(facts.twoWay).toBe(false);
    expect(facts.ownerReplied).toBe(false);
    expect(facts.participantCount).toBe(50);
  });

  it('measures age against the thread, not the sweep', () => {
    const facts = factsFor(note(TWO_WAY, {}, '2026-06-27T09:00:00Z'), NOW);
    expect(facts.ageDays).toBe(61);
  });

  it('reports attachments from the stored count, not the note text', () => {
    // A gated sweep never downloads an attachment, so the text has no
    // `--- filename ---` block. Reading the text alone reported every held
    // thread as having no documents.
    const facts = factsFor(note(TWO_WAY, { attachmentCount: 2 }), NOW);
    expect(facts.hasAttachments).toBe(true);
    expect(factsFor(note(TWO_WAY, { attachmentCount: 0 }), NOW).hasAttachments).toBe(false);
  });

  it('still reads attachments off the text for notes written before the count existed', () => {
    const withBlock = `${TWO_WAY}\n\n--- tender.pdf ---\nsome extracted text`;
    expect(factsFor(note(withBlock), NOW).hasAttachments).toBe(true);
  });

  it('does not call a one-message receipt a conversation the owner joined', () => {
    // The end-to-end version of the sendersIn bug: this is what made the seed
    // rule's backtest offer PayPal receipts as two-way correspondence.
    const receipt = [
      'Subject: HUBX STUDIOS LTD: $1.99 USD',
      'Participants: service@paypal.co.uk, John Kelly <johnkelly.main@gmail.com>',
      'Messages: 1 (2026-08-27)',
      '',
      '[1] · 2026-08-27 · from service@paypal.co.uk · to John Kelly <johnkelly.main@gmail.com>',
      "You've authorised $1.99 USD to HUBX STUDIOS LTD. Transaction date 27 Aug 2026. Order ID order-01a0. Thank you for using PayPal.",
    ].join('\n');
    const facts = factsFor(
      {
        title: 'HUBX STUDIOS LTD: $1.99 USD',
        rawContent: receipt,
        metadata: {
          gmailAccount: 'johnkelly.main@gmail.com',
          participants: ['service@paypal.co.uk', 'johnkelly.main@gmail.com'],
          emailKind: 'correspondence',
          senderDomain: 'paypal.co.uk',
        },
        observedAt: '2026-08-27T09:00:00Z',
        createdAt: '2026-08-27T09:00:00Z',
      },
      NOW,
    );
    expect(facts.ownerReplied).toBe(false);
    expect(facts.twoWay).toBe(false);
  });

  it('classifies from the participants when ingest never stored a sender', () => {
    // 1,043 of 2,857 held threads had no `senderDomain` — the structural stubs
    // were written by persistStructuralOnly, which has no classifier step — and
    // they all collapsed into one cluster called "unknown", 37% of the queue.
    const facts = factsFor(
      note(STUB, { participants: ['welcome@supabase.com', OWNER], senderDomain: undefined, emailKind: undefined }),
      NOW,
    );
    expect(facts.senderDomain).toBe('supabase.com');
    expect(facts.emailKind).not.toBe('');
  });

  it('recognises a bulk sender in the fallback, not just an unknown one', () => {
    const facts = factsFor(
      note(BROADCAST, { participants: ['offers@send.shop.com', OWNER], senderDomain: undefined, emailKind: undefined }),
      NOW,
    );
    expect(facts.senderDomain).toBe('send.shop.com');
    expect(facts.emailKind).toBe('bulk');
  });

  it('prefers what ingest stored over the fallback', () => {
    // Ingest-time facets apply the owner's domain RULES; the fallback cannot,
    // so a stored verdict must always win.
    const facts = factsFor(
      note(BROADCAST, { participants: ['offers@send.shop.com', OWNER], senderDomain: 'shop.com', emailKind: 'notification' }),
      NOW,
    );
    expect(facts.senderDomain).toBe('shop.com');
    expect(facts.emailKind).toBe('notification');
  });

  it('handles a header-only stub without inventing anything', () => {
    const facts = factsFor(note(STUB, { emailKind: 'notification', structuralOnly: true }), NOW);
    expect(facts.ownerReplied).toBe(false);
    expect(facts.twoWay).toBe(false);
    expect(facts.bodyChars).toBeLessThan(200);
  });

  it('gives an undated note a huge age rather than treating it as new', () => {
    const undated = { title: 'x', rawContent: TWO_WAY, metadata: {}, observedAt: null, createdAt: null };
    expect(factsFor(undated, NOW).ageDays).toBe(9999);
  });
});
