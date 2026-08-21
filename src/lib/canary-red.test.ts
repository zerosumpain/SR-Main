// TEMPORARY. Proves the split gate still fails closed: a failing test in one
// shard must turn the `Gate (check + test)` aggregator red. Reverted in the
// next commit.
import { describe, it, expect } from 'vitest';

describe('canary', () => {
	it('deliberately fails to prove the aggregator goes red', () => {
		expect(1).toBe(2);
	});
});
