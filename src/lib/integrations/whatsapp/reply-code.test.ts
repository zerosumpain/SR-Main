import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FrozenCall } from '$lib/jkai/chat/turn';
import {
  REPLY_CODE_TTL_MS,
  answerReplyCode,
  callHash,
  codeDigest,
  issueReplyCode,
  ownerSender,
  parseReplyCode,
  type ReplyCodeRecord,
  type ReplyCodeStore,
} from './reply-code';

/**
 * WhatsApp reply-code confirms against an in-memory `jkai_gates`: the rules,
 * end to end from the ask to the reply, without a database or a socket.
 */
const OWNER = '447700900123';
const isOwner = (n: string) => n.replace(/@.*$/, '').replace(/\D+/g, '') === OWNER;
const CALL: FrozenCall = { tool: 'ha_call_service', args: { domain: 'light', service: 'turn_off', entity_id: 'light.kitchen' }, prompt: 'Proceed with ha_call_service?\ndomain: light' };

function memoryStore() {
  const rows: Array<{ rec: ReplyCodeRecord; answer: Record<string, unknown> | null }> = [];
  const store: ReplyCodeStore = {
    async open(rec) { rows.push({ rec: structuredClone(rec), answer: null }); },
    async latestOpen(sender) { return [...rows].reverse().find((r) => !r.answer && r.rec.sender === sender)?.rec ?? null; },
    async close(gateKey, answer) {
      const r = rows.find((x) => x.rec.gateKey === gateKey && !x.answer);
      if (!r) return false;
      r.answer = answer;
      return true;
    },
    async closeAllFor(sender, answer) { for (const r of rows) if (!r.answer && r.rec.sender === sender) r.answer = answer; },
  };
  return { rows, store };
}

let clock = 1_800_000_000_000;
let mem = memoryStore();
const execute = vi.fn(async () => ({ success: true }));
const deps = () => ({ store: mem.store, isOwner, eligible: async (t: string) => t === 'ha_call_service' || t === 'save_memory', now: () => clock, execute });

/** Ask, and read the code back out of the text John is sent. */
async function ask(call: FrozenCall = CALL, from = OWNER, conversationId = 'conv-wa') {
  const text = await issueReplyCode({ from, conversationId, call }, deps());
  return { text, code: /Reply (\d{4})/.exec(text)?.[1] ?? null };
}
const reply = (text: string, from = OWNER, conversationId: string | null = 'conv-wa') => answerReplyCode({ from, text, conversationId }, deps());

beforeEach(() => {
  mem = memoryStore();
  execute.mockClear();
  clock = 1_800_000_000_000;
});

describe('asking', () => {
  it('sends a 4-digit code with what it is for, and stores no code, only its digest', async () => {
    const { text, code } = await ask();
    expect(code).toMatch(/^\d{4}$/);
    expect(text).toMatch(/^Reply \d{4} within 5 minutes to confirm:\nProceed with ha_call_service\?/);
    expect(text).toMatch(/Anything else cancels it\.$/);
    const rec = mem.rows[0].rec;
    expect(JSON.stringify(rec)).not.toContain(`"${code}"`);
    expect(rec.sender).toBe(OWNER);
    expect(rec.callHash).toBe(callHash(CALL.tool, CALL.args));
    expect(rec.codeDigest).toBe(codeDigest(code!, rec.gateKey, rec.callHash));
    expect(Date.parse(rec.expiresAt) - clock).toBe(REPLY_CODE_TTL_MS);
  });

  it('refuses a LID or JID sender, or anyone but John, and asks nothing', async () => {
    for (const from of ['123456789@lid', `${OWNER}@s.whatsapp.net`, '447700900999', '']) {
      const { text, code } = await ask(CALL, from);
      expect(code, from).toBeNull();
      expect(text).toMatch(/haven't done it/);
    }
    expect(mem.rows).toHaveLength(0);
    expect(ownerSender(`${OWNER}@lid`, isOwner)).toBeNull();
  });

  it('refuses a tool that is not eligible (destructive, or off the list)', async () => {
    const { code } = await ask({ tool: 'gmail_send', args: { to: 'x@y.z' }, prompt: 'Send?' });
    expect(code).toBeNull();
    expect(mem.rows).toHaveLength(0);
  });

  it('supersedes an older open code', async () => {
    const first = await ask();
    await ask({ ...CALL, args: { ...CALL.args, entity_id: 'light.hall' } });
    expect(mem.rows[0].answer).toEqual({ decision: 'declined', reason: 'superseded' });
    expect((await reply(first.code!)).ran).toBeUndefined();
  });
});

describe('answering', () => {
  it('runs exactly the frozen call on the right code, once', async () => {
    const { code } = await ask();
    const r = await reply(` ${code}. `);
    expect(r).toMatchObject({ handled: true, ran: { tool: 'ha_call_service', success: true } });
    expect(r.reply).toMatch(/^Done: ha_call_service/);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith('ha_call_service', CALL.args);
    expect(mem.rows[0].answer).toEqual({ decision: 'approved' });
  });

  it('cannot be replayed', async () => {
    const { code } = await ask();
    await reply(code!);
    const again = await reply(code!);
    expect(again.handled).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('runs once when the same reply is delivered twice at once', async () => {
    const { code } = await ask();
    const [a, b] = await Promise.all([reply(code!), reply(code!)]);
    expect(execute).toHaveBeenCalledOnce();
    expect([a.reply, b.reply]).toContain('That code was already used.');
  });

  it('expires after five minutes', async () => {
    const { code } = await ask();
    clock += REPLY_CODE_TTL_MS + 1;
    const r = await reply(code!);
    expect(r).toMatchObject({ handled: true, reply: expect.stringMatching(/expired/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('declines on a wrong code, and the right one no longer works', async () => {
    const { code } = await ask();
    const wrong = code === '0000' ? '0001' : '0000';
    expect(await reply(wrong)).toMatchObject({ handled: true, reply: expect.stringMatching(/doesn't match/) });
    expect((await reply(code!)).handled).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('declines on any other message, which carries on to chat', async () => {
    const { code } = await ask();
    expect(await reply('actually leave it on')).toEqual({ handled: false });
    expect(mem.rows[0].answer).toEqual({ decision: 'declined', reason: 'not-a-code' });
    expect((await reply(code!)).handled).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('ignores the code from another sender, a LID or a JID, and leaves it open for John', async () => {
    const { code } = await ask();
    for (const from of ['447700900999', '123456789@lid', `${OWNER}@lid`, `${OWNER}@s.whatsapp.net`]) {
      expect(await reply(code!, from), from).toEqual({ handled: false });
    }
    expect(mem.rows[0].answer).toBeNull();
    expect((await reply(code!)).ran?.success).toBe(true);
  });

  it('refuses a call whose stored arguments changed after asking', async () => {
    const { code } = await ask();
    mem.rows[0].rec.args = { ...CALL.args, entity_id: 'lock.front_door', service: 'unlock' };
    expect(await reply(code!)).toMatchObject({ handled: true, reply: expect.stringMatching(/changed/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a code whose digest belongs to another call or gate', async () => {
    const { code } = await ask();
    const rec = mem.rows[0].rec;
    rec.args = { ...CALL.args, entity_id: 'light.hall' };
    rec.callHash = callHash(rec.tool, rec.args);
    expect(await reply(code!)).toMatchObject({ handled: true, reply: expect.stringMatching(/doesn't match/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses the code in another thread, or a tool that stopped being eligible", async () => {
    let { code } = await ask();
    expect(await reply(code!, OWNER, 'conv-other')).toMatchObject({ handled: true, reply: expect.stringMatching(/another conversation/) });
    ({ code } = await ask({ tool: 'save_memory', args: { content: 'x' }, prompt: 'Proceed with save_memory?' }));
    const r = await answerReplyCode({ from: OWNER, text: code!, conversationId: 'conv-wa' }, { ...deps(), eligible: async () => false });
    expect(r.reply).toMatch(/can't be confirmed from WhatsApp/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('says so when the call fails', async () => {
    const { code } = await ask();
    execute.mockResolvedValueOnce({ success: false, error: 'fetch failed' } as never);
    expect(await reply(code!)).toMatchObject({ handled: true, reply: expect.stringMatching(/didn't work: fetch failed/), ran: { success: false } });
  });

  it('only reads a message that is just four digits as a code', () => {
    expect(parseReplyCode('4831')).toBe('4831');
    expect(parseReplyCode(' 4831! ')).toBe('4831');
    for (const t of ['48311', '483', 'yes 4831', '4831 please', '', null]) expect(parseReplyCode(t), String(t)).toBeNull();
  });
});
