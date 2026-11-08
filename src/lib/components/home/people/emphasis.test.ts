import { describe, expect, it } from 'vitest';
import { emphasise } from './emphasis';

const bold = (t: string) => emphasise(t).filter((s) => s.key).map((s) => s.text);

describe('emphasise', () => {
  it('picks out counts with their units, and percentages', () => {
    expect(bold('Sam walks 4,208 more steps on days with a park (11,787 against 7,579, 6 days).')).toEqual(['4,208', '11,787', '7,579', '6 days']);
    expect(bold("Robin's phone was seen only 12% of the window.")).toEqual(['12%']);
  });

  it('keeps the unit with the figure', () => {
    expect(bold('Alex and Sam: 202.7 hours, and 57 journeys made together.')).toEqual(['202.7 hours', '57 journeys']);
    expect(bold('an outing lasts a median 2 h 15 min')).toEqual(['2 h', '15 min']);
  });

  it('bolds clock times and multipliers', () => {
    expect(bold('usually arriving about 13:16, and 1.8× as likely')).toEqual(['13:16', '1.8×']);
  });

  it('leaves digits inside names alone', () => {
    expect(bold('the drive up the A47 to Gran’s')).toEqual([]);
  });

  it('loses no text', () => {
    const t = 'A day at home costs Alex about 7,146 steps: 2,095 against 9,241 on days out.';
    expect(emphasise(t).map((s) => s.text).join('')).toBe(t);
  });
});
