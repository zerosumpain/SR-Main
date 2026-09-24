import { describe, expect, it } from 'vitest';
import { parseTopicReply, topicPrompt } from './topics';

const rows = [
  { id: 'a', command: 'play radio 2', reply: null, intent: 'PlayMusicIntent' },
  { id: 'b', command: 'set a timer for ten minutes', reply: 'Ten minutes, starting now.', intent: null },
  { id: 'c', command: 'what is 7 times 8', reply: '56', intent: null },
];

describe('topicPrompt', () => {
  it('numbers lines from 1 with intent and reply', () => {
    const p = topicPrompt(rows);
    expect(p.split('\n')[0]).toBe('1. play radio 2 [PlayMusicIntent]');
    expect(p.split('\n')[1]).toBe('2. set a timer for ten minutes → Ten minutes, starting now.');
  });
});

describe('parseTopicReply', () => {
  it('maps line numbers back to ids', () => {
    const m = parseTopicReply(
      '```json\n[{"n":1,"topic":"music"},{"n":2,"topic":"Timers-Alarms"},{"n":3,"topic":"questions"}]\n```',
      rows,
    );
    expect(Object.fromEntries(m)).toEqual({ a: 'music', b: 'timers-alarms', c: 'questions' });
  });

  it('drops off-vocabulary topics and out-of-range lines', () => {
    const m = parseTopicReply('[{"n":1,"topic":"songs"},{"n":9,"topic":"music"},{"n":3,"topic":"questions"}]', rows);
    expect(Object.fromEntries(m)).toEqual({ c: 'questions' });
  });

  it('finds the array inside prose and survives garbage', () => {
    expect(parseTopicReply('Here you go: [{"n":2,"topic":"timers-alarms"}] done', rows).get('b')).toBe('timers-alarms');
    expect(parseTopicReply('no json at all', rows).size).toBe(0);
  });
});
