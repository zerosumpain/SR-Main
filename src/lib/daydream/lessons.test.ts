import { describe, expect, it } from 'vitest';
import { dedupeLessons, lessonLines } from './lessons';

describe('lessons', () => {
  it('keeps the newest of each lesson and drops empty ones', () => {
    const out = dedupeLessons([
      { title: 'A', lesson: 'Check the bank line.', by: 'owner' },
      { title: 'B', lesson: 'check the  bank line.', by: 'check' },
      { title: 'C', lesson: '  ', by: 'check' },
    ]);
    expect(out.map((l) => l.title)).toEqual(['A']);
  });

  it('says who caught each one', () => {
    const lines = lessonLines([
      { title: 'Two £79 Apple charges', lesson: 'One was the receipt.', by: 'owner' },
      { title: 'Canva twice', lesson: 'Invoice and bank line are one payment.', by: 'check' },
    ]);
    expect(lines[0]).toMatch(/WRONG BEFORE/);
    expect(lines[1]).toMatch(/John found it wrong: One was the receipt/);
    expect(lines[2]).toMatch(/A double-check found it wrong/);
    expect(lessonLines([])).toEqual([]);
  });
});
