export type FamilyPresence = 'home' | 'away' | 'unknown';

export interface FamilyMovementObservation {
	personId: string;
	personName: string;
	presence: FamilyPresence;
	observedAtMs: number;
}

export interface FamilyMovementState {
	stablePresence?: Exclude<FamilyPresence, 'unknown'>;
	stableSinceMs?: number;
	candidatePresence?: Exclude<FamilyPresence, 'unknown'>;
	candidateSinceMs?: number;
	lastAlertAtMs?: number;
	lastObservedAtMs?: number;
}

export interface FamilyMovementMonitorOptions {
	minimumConfirmationMs?: number;
	cooldownMs?: number;
}

export interface FamilyMovementNotification {
	kind: 'push';
	personId: string;
	title: string;
	body: string;
	data: {
		event: 'arrival' | 'departure';
		presence: Exclude<FamilyPresence, 'unknown'>;
		occurredAtMs: number;
	};
}

export interface FamilyMovementEvaluation {
	state: FamilyMovementState;
	notification?: FamilyMovementNotification;
}

const DEFAULT_MINIMUM_CONFIRMATION_MS = 5 * 60 * 1_000;
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1_000;

type KnownPresence = Exclude<FamilyPresence, 'unknown'>;

function notificationFor(
	observation: FamilyMovementObservation,
	presence: KnownPresence
): FamilyMovementNotification {
	const event = presence === 'home' ? 'arrival' : 'departure';
	const action = event === 'arrival' ? 'arrived home' : 'left home';

	return {
		kind: 'push',
		personId: observation.personId,
		title: `Family movement: ${observation.personName}`,
		body: `${observation.personName} ${action}.`,
		data: {
			event,
			presence,
			occurredAtMs: observation.observedAtMs
		}
	};
}

export function evaluateFamilyMovement(
	observation: FamilyMovementObservation,
	previousState: FamilyMovementState = {},
	options: FamilyMovementMonitorOptions = {}
): FamilyMovementEvaluation {
	if (!Number.isFinite(observation.observedAtMs)) {
		throw new Error('observedAtMs must be a finite timestamp.');
	}

	const minimumConfirmationMs =
		options.minimumConfirmationMs ?? DEFAULT_MINIMUM_CONFIRMATION_MS;
	const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;

	if (minimumConfirmationMs < 0 || cooldownMs < 0) {
		throw new Error('minimumConfirmationMs and cooldownMs must be non-negative.');
	}

	if (
		previousState.lastObservedAtMs !== undefined &&
		observation.observedAtMs <= previousState.lastObservedAtMs
	) {
		return { state: previousState };
	}

	const state: FamilyMovementState = {
		...previousState,
		lastObservedAtMs: observation.observedAtMs
	};

	if (observation.presence === 'unknown') {
		return { state };
	}

	const presence = observation.presence;
	if (state.stablePresence === undefined) {
		return {
			state: {
				...state,
				stablePresence: presence,
				stableSinceMs: observation.observedAtMs
			}
		};
	}

	if (state.stablePresence === presence) {
		return {
			state: {
				...state,
				candidatePresence: undefined,
				candidateSinceMs: undefined
			}
		};
	}

	if (state.candidatePresence !== presence || state.candidateSinceMs === undefined) {
		return {
			state: {
				...state,
				candidatePresence: presence,
				candidateSinceMs: observation.observedAtMs
			}
		};
	}

	if (observation.observedAtMs - state.candidateSinceMs < minimumConfirmationMs) {
		return { state };
	}

	const confirmedState: FamilyMovementState = {
		...state,
		stablePresence: presence,
		stableSinceMs: state.candidateSinceMs,
		candidatePresence: undefined,
		candidateSinceMs: undefined
	};
	const isCoolingDown =
		confirmedState.lastAlertAtMs !== undefined &&
		observation.observedAtMs - confirmedState.lastAlertAtMs < cooldownMs;

	if (isCoolingDown) {
		return { state: confirmedState };
	}

	return {
		state: {
			...confirmedState,
			lastAlertAtMs: observation.observedAtMs
		},
		notification: notificationFor(observation, presence)
	};
}
