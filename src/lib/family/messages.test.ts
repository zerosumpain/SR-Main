import { describe, expect, it } from 'vitest';
import { BODY_MAX, messagePush, messageViews, parseBody, quote, replyPush, type MessageRecord } from './messages';

function row(over: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: 'm1', fromEmail: 'kid@example.test', fromName: 'Kid', body: 'Dinner at 7?', replyTo: null,
    recipientCount: 3, pushedCount: 2, createdAt: new Date('2026-10-05T17:00:00Z'), ...over,
  };
}
const idOf = (e: string) => `f_${e.split('@')[0]}`;

describe('parseBody', () => {
  it('trims and keeps a line of text or an emoji', () => {
    expect(parseBody({ body: '  On my way \n' })).toEqual({ body: 'On my way' });
    expect(parseBody({ body: '👍' })).toEqual({ body: '👍' });
  });

  it('refuses nothing, non-strings and too much', () => {
    expect(parseBody({ body: '   ' })).toHaveProperty('error');
    expect(parseBody({ body: 3 })).toHaveProperty('error');
    expect(parseBody(null)).toHaveProperty('error');
    expect(parseBody({ body: 'x'.repeat(BODY_MAX + 1) })).toHaveProperty('error');
    expect(parseBody({ body: 'x'.repeat(BODY_MAX) })).toEqual({ body: 'x'.repeat(BODY_MAX) });
  });
});

describe('messageViews', () => {
  it('lists messages newest first with their replies oldest first, by id not email', () => {
    const rows = [
      row(),
      row({ id: 'm2', fromEmail: 'owner@example.test', fromName: 'John', body: 'Home soon', createdAt: new Date('2026-10-05T18:00:00Z') }),
      row({ id: 'r2', fromEmail: 'kid@example.test', body: 'Ok', replyTo: 'm1', createdAt: new Date('2026-10-05T17:10:00Z') }),
      row({ id: 'r1', fromEmail: 'owner@example.test', fromName: 'John', body: '👍', replyTo: 'm1', createdAt: new Date('2026-10-05T17:05:00Z') }),
    ];
    const views = messageViews(rows, idOf, (e) => e === 'owner@example.test');
    expect(views.map((v) => v.id)).toEqual(['m2', 'm1']);
    expect(views[0]).toMatchObject({ fromId: 'f_owner', mine: true, replies: [] });
    expect(views[1].replies.map((r) => [r.id, r.reaction, r.mine])).toEqual([['r1', true, true], ['r2', false, false]]);
    expect(JSON.stringify(views)).not.toContain('@example.test');
  });
});

describe('pushes', () => {
  it('pushes a message with the reply category and its id', () => {
    expect(messagePush(row())).toMatchObject({
      title: 'Kid · Family', body: 'Dinner at 7?', category: 'family-msg', userInfo: { category: 'family-msg', messageId: 'm1' },
    });
  });

  it('says an emoji reply in the title and a text reply in the body', () => {
    const message = row({ body: 'Who wants pizza tonight, I am ordering at six so tell me soon' });
    expect(replyPush(row({ id: 'r1', fromName: 'Karen', body: '👍', replyTo: 'm1' }), message)).toMatchObject({
      title: 'Karen 👍', body: 'to “Who wants pizza tonight, I am ordering…”', category: 'family-msg-reply',
      userInfo: { messageId: 'm1' },
    });
    expect(replyPush(row({ id: 'r2', fromName: 'Karen', body: 'Yes please', replyTo: 'm1' }), message)).toMatchObject({
      title: 'Karen replied', body: 'Yes please',
    });
  });

  it('quotes by character, not code unit', () => {
    expect(quote('😀'.repeat(50), 5)).toBe('😀😀😀😀…');
  });
});
