import { beforeEach, describe, expect, it, vi } from 'vitest';

const replies: string[] = [];
const create = vi.fn(async () => ({ choices: [{ message: { content: replies.shift() ?? '' }, finish_reason: 'stop' }] }));

vi.mock('$lib/llm/client', () => ({
  getLLMClient: async () => ({ client: { chat: { completions: { create } } }, model: 'test/model' }),
}));
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveGamesQuizModel: async () => ({ provider: 'openrouter', modelId: 'test/model' }),
}));
vi.mock('$lib/context/activity', () => ({ withActivity: (_id: string, fn: () => unknown) => fn() }));

const { writeQuiz, parseLoose } = await import('./quiz-night.server');
const { createRoom } = await import('./quiz-night');

const batch = (n: number) =>
  JSON.stringify({
    title: 'Oceans',
    questions: Array.from({ length: n }, (_, i) => ({
      prompt: `Which ocean fact number ${i}?`,
      options: ['Pacific', 'Atlantic', 'Indian', `Arctic ${i}`],
      answerIndex: 0,
      explain: 'It is the largest.',
    })),
  });

function room() {
  return createRoom({
    id: 'g_w',
    host: { id: 'p_a', name: 'A' },
    invite: [],
    difficulty: 'medium',
    options: { topic: 'oceans', audience: 'family' },
    now: 1,
  });
}

beforeEach(() => {
  replies.length = 0;
  create.mockClear();
});

describe('writeQuiz', () => {
  it('fills the room from one good reply, with reasoning off and JSON mode', async () => {
    replies.push('```json\n' + batch(12) + '\n```');
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('ready');
    expect(r.questions).toHaveLength(10);
    expect(r.title).toBe('Oceans');
    expect(create).toHaveBeenCalledOnce();
    const body = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(body.messages)).toContain('<<oceans>>');
  });

  it('asks again once when the first reply is unusable', async () => {
    replies.push('Sure! Here are some questions…', batch(10));
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('ready');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives up after two, and says so in the room', async () => {
    replies.push(batch(2), 'nope');
    const r = room();
    await writeQuiz(r);
    expect(r.prep).toBe('failed');
    expect(r.prepError).toMatch(/Try another topic/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('never throws, even when the gateway does', async () => {
    create.mockRejectedValueOnce(new Error('gateway down'));
    const r = room();
    await expect(writeQuiz(r)).resolves.toBeUndefined();
    expect(r.prep).toBe('failed');
  });

  it('reads JSON wrapped in prose', () => {
    expect(parseLoose('Here you go: {"a":1} enjoy')).toEqual({ a: 1 });
    expect(parseLoose('nothing')).toBeNull();
  });
});
