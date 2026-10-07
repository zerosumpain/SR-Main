import { describe, expect, it } from 'vitest';
import type { Activity } from './resident';
import { aside, want, wrap, type Reason } from './talk';

const ACTIVITIES: Activity[] = ['wander', 'run', 'lookout', 'stargaze', 'study', 'think', 'workout', 'drive', 'cycle', 'sleep', 'nap', 'garden', 'tv', 'sofa', 'tea', 'eat', 'meditate', 'puddle', 'snowman', 'umbrella', 'stressed', 'anxious', 'mad', 'surprised', 'fidget', 'shiver', 'yawn', 'celebrate', 'fan'];
const REASONS: Reason[] = ['rain', 'storm', 'snow', 'sun', 'cold', 'night', 'dusk', 'pulseUp', 'calm', 'exercised', 'climbed', 'cycled', 'walked', 'mindful', 'outdoors', 'quietDay', 'busyDay', 'clearNight', 'shortNight', 'lunchDip', 'sleepy', 'sitting', 'brainFull', 'lowRecovery', 'wound', 'teaTime', 'hungry', 'workday', 'deskStress', 'fuming', 'onEdge', 'exerting', 'focused', 'deskBound', 'outAndAbout', 'windingDown'];

describe('talk', () => {
  it('has something to want for every activity, with or without a reason', () => {
    for (const a of ACTIVITIES) {
      expect(want(a, undefined, () => 0).text.length).toBeGreaterThan(0);
      for (const r of REASONS) expect(want(a, r, () => 0.99).kind).toBe('think');
    }
  });

  it('says why when the day decided it, naming jk rather than "you"', () => {
    const line = want('workout', 'exercised', () => 0);
    expect(line.text).toBe('jk trained, so now i have to. gains, theoretically');
    for (const a of ACTIVITIES) for (const r of REASONS) expect(want(a, r, () => 0).text).not.toMatch(/\byou\b/);
  });

  it('keeps every line to three short rows', () => {
    for (const a of ACTIVITIES) for (const r of REASONS) for (const roll of [0, 0.5, 0.99]) expect(wrap(want(a, r, () => roll).text).length).toBeLessThanOrEqual(3);
  });

  it('only remarks on the rain while he is out walking in it', () => {
    expect(aside('wander', true, () => 0)?.text).toBe('proper british weather');
    expect(aside('wander', false, () => 0)).toBeNull();
    expect(aside('tv', true, () => 0)?.kind).toBe('say');
  });

  it('keeps to the voice card: no exclamation marks, no colons, no Americanisms', () => {
    const all: string[] = [];
    for (const a of ACTIVITIES) {
      for (const r of [...REASONS, undefined]) for (const roll of [0, 0.5, 0.99]) all.push(want(a, r, () => roll).text);
      for (const roll of [0, 0.5, 0.99]) all.push(aside(a, false, () => roll)?.text ?? '', aside(a, true, () => roll)?.text ?? '');
    }
    for (const text of all) {
      expect(text).not.toMatch(/[!:]/);
      expect(text).not.toMatch(/\b(color|gotten|math|center|vacation|awesome)\b/);
      expect(text).toBe(text.toLowerCase());
    }
  });

  it('wraps at spaces', () => {
    expect(wrap("sun's out. something should grow here")).toEqual(["sun's out. something", 'should grow here']);
  });
});
