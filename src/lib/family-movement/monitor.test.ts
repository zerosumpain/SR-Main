import { describe, expect, it } from 'vitest';
import { evaluateFamilyMovement, type FamilyMovementState } from '$lib/family-movement/monitor';

const options = {
	minimumConfirmationMs: 60_000,
	cooldownMs: 300_000
};

function observation(presence: 'home' | 'away' | 'unknown', observedAtMs: number) {
	return {
		personId: 'alex',
		personName: 'Alex',
		presence,
		observedAtMs
	};
}

describe('evaluateFamilyMovement', () => {
	it('establishes a baseline without notifying', () => {
		const result = evaluateFamilyMovement(observation('home', 1_000), {}, options);

		expect(result.notification).toBeUndefined();
		expect(result.state).toMatchObject({
			stablePresence: 'home',
			stableSinceMs: 1_000
		});
	});

	it('confirms a departure before emitting one notification', () => {
		let state: FamilyMovementState = evaluateFamilyMovement(observation('home', 0), {}, options).state;
		state = evaluateFamilyMovement(observation('away', 10_000), state, options).state;

		const result = evaluateFamilyMovement(observation('away', 70_000), state, options);

		expect(result.notification).toEqual({
			kind: 'push',
			personId: 'alex',
			title: 'Family movement: Alex',
			body: 'Alex left home.',
			data: {
				event: 'departure',
				presence: 'away',
				occurredAtMs: 70_000
			}
		});
		expect(result.state.stablePresence).toBe('away');
	});

	it('clears a transient movement candidate when presence returns to normal', () => {
		let state = evaluateFamilyMovement(observation('home', 0), {}, options).state;
		state = evaluateFamilyMovement(observation('away', 10_000), state, options).state;

		const result = evaluateFamilyMovement(observation('home', 20_000), state, options);

		expect(result.notification).toBeUndefined();
		expect(result.state).toMatchObject({
			stablePresence: 'home',
			candidatePresence: undefined,
			candidateSinceMs: undefined
		});
	});

	it('suppresses another alert during the cooldown while retaining the new state', () => {
		let state = evaluateFamilyMovement(observation('home', 0), {}, options).state;
		state = evaluateFamilyMovement(observation('away', 10_000), state, options).state;
		state = evaluateFamilyMovement(observation('away', 70_000), state, options).state;
		state = evaluateFamilyMovement(observation('home', 100_000), state, options).state;

		const result = evaluateFamilyMovement(observation('home', 160_000), state, options);

		expect(result.notification).toBeUndefined();
		expect(result.state.stablePresence).toBe('home');
	});

	it('ignores stale observations', () => {
		const state: FamilyMovementState = {
			stablePresence: 'home',
			stableSinceMs: 1_000,
			lastObservedAtMs: 5_000
		};

		const result = evaluateFamilyMovement(observation('away', 4_000), state, options);

		expect(result).toEqual({ state });
	});
});
