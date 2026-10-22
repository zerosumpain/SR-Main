import { beforeEach, describe, expect, it, vi } from 'vitest';

type Body = { messages: { role: string; content: string }[]; response_format: unknown; reasoning?: unknown };

/** Writer replies, in order. */
const replies: string[] = [];
/** Checker replies, in order; when empty the checker answers every question right. */
const checks: (string | ((listed: { n: number; options: string[] }[]) => string))[] = [];

const agreeAll = (listed: { n: number; options: string[] }[]) =>
  JSON.stringify({ checks: listed.map((q) => ({ n: q.n, answer: q.options.findIndex((o) => o.startsWith('Right')), problem: null })) });

const create = vi.fn(async (body: Body) => {
  const checking = body.messages[0].content.startsWith('You check');
  let content: string;
  if (checking) {
    const listed = JSON.parse(body.messages[1].content).questions;
    const next = checks.shift() ?? agreeAll;
    content = typeof next === 'function' ? next(listed) : next;
  } else {
    content = replies.shift() ?? '';
  }
  return { choices: [{ message: { content }, finish_reason: 'stop' }] };
});

vi.mock('$lib/llm/client', () => ({
  getLLMClient: async () => ({ client: { chat: { completions: { create } } }, model: 'test/model' }),
}));
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveGamesQuizModel: async () => ({ provider: 'openrouter', modelId: 'test/model' }),
}));
vi.mock('$lib/context/activity', () => ({ withActivity: (_id: string, fn: () => unknown) => fn() }));

const { writeQuiz, parseLoose, agreed, forgetRecent, recentFor } = await import('./quiz-night.server');
const { createRoom } = await import('./quiz-night');

const batch = (n: number, from = 0, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'Oceans',
    questions: Array.from({ length: n }, (_, k) => {
      const i = from + k;
      return {
        prompt: `Which ocean fact number ${i}?`,
        options: [`Right ${i}`, 'Atlantic', 'Indian', `Arctic ${i}`],
        answerIndex: 0,
        explain: 'It is the largest.',
        ...extra,
      };
    }),
  });

function room(options: Record<string, unknown> = { topic: 'oceans', audience: 'family' }, host = 'p_a') {
  return createRoom({ id: 'g_w', host: { id: host, name: 'A' }, invite: [], difficulty: 'medium', options, now: 1 });
}

const calls = () => create.mock.calls.map((c) => c[0] as unknown as Body);
const writerCalls = () => calls().filter((b) => !b.messages[0].content.startsWith('You check'));
const checkerCalls = () => calls().filter((b) => b.messages[0].content.startsWith('You check'));

beforeEach(() => {
  replies.length = 0;
  checks.length = 0;
  create.mockClear();
  forgetRecent();
});

describe('writeQuiz', () => {
  it('writes, has every question checked, and fills the room — reasoning off for the writer, on for the checker', async () => {
    replies.push('```json\n' + batch(14) + '\n```');
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('ready');
    expect(r.questions).toHaveLength(10);
    expect(r.title).toBe('Oceans');
    expect(writerCalls()).toHaveLength(1);
    expect(checkerCalls()).toHaveLength(1);
    const [writer] = writerCalls();
    expect(writer.response_format).toEqual({ type: 'json_object' });
    expect(writer.messages[1].content).toContain('"oceans"');
    expect(writer.reasoning).toEqual({ enabled: false });
    expect(checkerCalls()[0].reasoning).toEqual({ effort: 'low' });
    // The checker never sees the answer key.
    expect(checkerCalls()[0].messages[1].content).not.toContain('answerIndex');
    const opts = create.mock.calls[0][1 as never] as unknown as { signal?: AbortSignal; maxRetries?: number };
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.maxRetries).toBe(1);
  });

  it('drops the questions the checker answers differently or flags', async () => {
    replies.push(batch(14));
    checks.push((listed) =>
      JSON.stringify({
        checks: listed.map((q) => ({
          n: q.n,
          answer: q.n === 1 ? (q.options.findIndex((o) => o.startsWith('Right')) + 1) % 4 : q.options.findIndex((o) => o.startsWith('Right')),
          problem: q.n === 2 ? 'ambiguous' : null,
        })),
      }),
    );
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('ready');
    expect(r.questions).toHaveLength(10);
    expect(r.questions.map((q) => q.prompt)).not.toContain('Which ocean fact number 0?');
    expect(r.questions.map((q) => q.prompt)).not.toContain('Which ocean fact number 1?');
    for (const q of r.questions) expect(q.options[q.answerIndex]).toMatch(/^Right/);
  });

  it('writes again when the checker leaves too few', async () => {
    replies.push(batch(14), batch(14, 100));
    checks.push(JSON.stringify({ checks: [{ n: 1, answer: null, problem: 'wrong' }] }));
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('ready');
    expect(writerCalls()).toHaveLength(2);
    expect(r.questions[0].prompt).toMatch(/number 1\d\d/);
  });

  it("keeps the writer's set when the checker cannot be read or fails", async () => {
    replies.push(batch(12));
    checks.push('not json');
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('ready');
    expect(r.questions).toHaveLength(10);
  });

  it('asks again once when the first reply is unusable', async () => {
    replies.push('Sure! Here are some questions…', batch(10));
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('ready');
    expect(writerCalls()).toHaveLength(2);
  });

  it('gives up after two, and says so in the room', async () => {
    replies.push(batch(2), 'nope');
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('failed');
    expect(r.prepError).toMatch(/Try another topic/);
    expect(writerCalls()).toHaveLength(2);
  });

  it('never throws, even when the gateway does', async () => {
    create.mockRejectedValueOnce(new Error('gateway down'));
    const r = room();
    await expect(writeQuiz(r)).resolves.toBeUndefined();
    expect(r.prep).toBe('failed');
  });

  it('remembers what a host played and does not deal it again', async () => {
    replies.push(batch(14));
    const first = room();
    await writeQuiz(first);
    expect(recentFor(first)).toHaveLength(10);
    // The writer repeats itself: the ten already played are filtered out.
    replies.push(batch(24));
    const second = room();
    await writeQuiz(second);
    expect(second.prep).toBe('ready');
    const played = new Set(first.questions.map((q) => q.prompt));
    expect(second.questions.some((q) => played.has(q.prompt))).toBe(false);
    expect(writerCalls()[1].messages[1].content).toContain('had these questions recently');
    // Someone else's quiz on the same topic does not inherit it.
    expect(recentFor(room(undefined, 'p_b'))).toEqual([]);
  });

  it('briefs a GCSE quiz on the board, the spec and the grade band, and keeps each spec heading', async () => {
    replies.push(batch(14, 0, { topic: 'Cell biology' }));
    const r = room({ mode: 'gcse', subject: 'biology', board: 'aqa', topic: 'Cell biology' });
    await writeQuiz(r);
    expect(r.prep).toBe('ready');
    const [writer] = writerCalls();
    expect(writer.messages[0].content).toMatch(/GCSE examiner/);
    expect(writer.messages[1].content).toContain('AQA GCSE Biology (8461)');
    expect(writer.messages[1].content).toContain('Grades 4–5');
    expect(writer.messages[1].content).toMatch(/past papers/);
    expect(writer.messages[1].content).toContain('"Cell biology"');
    expect(r.questions[0].topic).toBe('Cell biology');
  });

  it('lets a GCSE subject say what its spec needs, and nothing more', async () => {
    replies.push(batch(14, 0, { explain: 'Sexual reproduction mixes genes from two parents.' }));
    const bio = room({ mode: 'gcse', subject: 'biology', board: 'aqa' });
    await writeQuiz(bio);
    expect(bio.prep).toBe('ready');
    replies.push(batch(14, 0, { explain: 'Sexual reproduction mixes genes from two parents.' }), batch(1));
    const general = room({ topic: 'living things', audience: 'family' }, 'p_c');
    await writeQuiz(general);
    expect(general.prep).toBe('failed');
  });

  it('reads JSON wrapped in prose', () => {
    expect(parseLoose('Here you go: {"a":1} enjoy')).toEqual({ a: 1 });
    expect(parseLoose('nothing')).toBeNull();
  });
});

describe('agreed', () => {
  const q = (answerIndex: number) => ({ prompt: 'p?', options: ['a', 'b', 'c', 'd'], answerIndex, explain: null, topic: null });

  it('keeps only what the checker answered the same way, without a problem', () => {
    const qs = [q(0), q(1), q(2)];
    const kept = agreed(qs, {
      checks: [
        { n: 1, answer: 0, problem: null },
        { n: 2, answer: 1, problem: 'two answers fit' },
        { n: 3, answer: null, problem: null },
      ],
    });
    expect(kept).toEqual([qs[0]]);
  });

  it('drops a question the checker skipped', () => {
    expect(agreed([q(0), q(1)], { checks: [{ n: 1, answer: 0 }] })).toEqual([q(0)]);
  });

  it('is null when there is nothing to read', () => {
    expect(agreed([q(0)], null)).toBeNull();
    expect(agreed([q(0)], { checks: [] })).toBeNull();
    expect(agreed([q(0)], { verdict: 'ok' })).toBeNull();
  });
});
