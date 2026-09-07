import { expect, it } from 'vitest';
import { evidencedCriteria, outputBudget } from './development-progress';
it('measures output budget without inventing a limit or exceeding the bar', () => {
 expect(outputBudget(500)).toBeNull(); expect(outputBudget(500, 0)).toBeNull();
 expect(outputBudget(250, 1000)).toEqual({used:250, limit:1000, percent:25});
 expect(outputBudget(1500, 1000)?.percent).toBe(100);
});
it('counts only passed criteria evidenced against the current candidate', () => {
 const criteria = [{verdict:'passed',revision:'old'}, {verdict:'failed',revision:'new'}, {verdict:'passed',revision:'new'}];
 expect(evidencedCriteria(criteria, null)).toBe(0); expect(evidencedCriteria(criteria,'new')).toBe(1);
});
