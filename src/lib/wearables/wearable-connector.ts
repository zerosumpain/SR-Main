export type FatigueLevel = 'low' | 'moderate' | 'high';

export interface SourceStamped {
	/** Identifier supplied by the wearable provider. */
	sourceId: string;
	/** Time the value or activity occurred, as reported by the provider. */
	observedAt: string;
	/** Time the provider last changed this record, when available. */
	sourceUpdatedAt?: string;
}

export interface Vo2MaxReading extends SourceStamped {
	value: number;
	unit: 'ml/kg/min';
}

export interface HeartRateZone {
	name: string;
	lowerBpm: number;
	upperBpm: number;
}

export interface HeartRateZoneSet extends SourceStamped {
	zones: HeartRateZone[];
}

export interface Workout extends SourceStamped {
	sport: string;
	startedAt: string;
	durationSeconds: number;
	distanceMetres?: number;
	averageHeartRateBpm?: number;
	trainingLoad?: number;
}

export interface WearableProviderPayload {
	accountId: string;
	vo2max?: Vo2MaxReading[];
	heartRateZones?: HeartRateZoneSet[];
	workouts?: Workout[];
}

export interface Imported<T extends SourceStamped> {
	importKey: string;
	provider: string;
	accountId: string;
	importedAt: string;
	record: T;
}

export interface WearableImportSnapshot {
	provider: string;
	accountId: string;
	importedAt: string;
	vo2max: Imported<Vo2MaxReading>[];
	heartRateZones: Imported<HeartRateZoneSet>[];
	workouts: Imported<Workout>[];
}

export type AuthorizedFetch = (
	input: string,
	init: { headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface WearableConnectorConfig<TPayload> {
	provider: string;
	endpoint: string;
	mapPayload(payload: TPayload): WearableProviderPayload;
	fetcher?: AuthorizedFetch;
	now?: () => Date;
}

export interface AuthorizedWearableConnector {
	importSnapshot(accessToken: string): Promise<WearableImportSnapshot>;
}

function assertNonEmpty(value: string, field: string): void {
	if (!value.trim()) throw new Error(`${field} must not be empty`);
}

function assertTimestamp(value: string, field: string): void {
	if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO-compatible timestamp`);
}

function validateSourceStamped(record: SourceStamped, label: string): void {
	assertNonEmpty(record.sourceId, `${label}.sourceId`);
	assertTimestamp(record.observedAt, `${label}.observedAt`);
	if (record.sourceUpdatedAt) assertTimestamp(record.sourceUpdatedAt, `${label}.sourceUpdatedAt`);
}

function validatePayload(payload: WearableProviderPayload): void {
	assertNonEmpty(payload.accountId, 'accountId');

	for (const reading of payload.vo2max ?? []) {
		validateSourceStamped(reading, 'vo2max');
		if (!Number.isFinite(reading.value) || reading.value <= 0) {
			throw new Error('vo2max.value must be a positive number');
		}
	}

	for (const zoneSet of payload.heartRateZones ?? []) {
		validateSourceStamped(zoneSet, 'heartRateZones');
		if (zoneSet.zones.length === 0) throw new Error('heartRateZones.zones must not be empty');
		let previousUpper = -1;
		for (const zone of zoneSet.zones) {
			assertNonEmpty(zone.name, 'heartRateZones.zones.name');
			if (!Number.isFinite(zone.lowerBpm) || !Number.isFinite(zone.upperBpm) || zone.lowerBpm <= 0 || zone.upperBpm < zone.lowerBpm) {
				throw new Error('heartRateZones contain invalid BPM bounds');
			}
			if (zone.lowerBpm <= previousUpper) throw new Error('heartRateZones must not overlap');
			previousUpper = zone.upperBpm;
		}
	}

	for (const workout of payload.workouts ?? []) {
		validateSourceStamped(workout, 'workouts');
		assertNonEmpty(workout.sport, 'workouts.sport');
		assertTimestamp(workout.startedAt, 'workouts.startedAt');
		if (!Number.isFinite(workout.durationSeconds) || workout.durationSeconds <= 0) {
			throw new Error('workouts.durationSeconds must be a positive number');
		}
		if (workout.distanceMetres !== undefined && (!Number.isFinite(workout.distanceMetres) || workout.distanceMetres < 0)) {
			throw new Error('workouts.distanceMetres must be non-negative');
		}
	}
}

function deduplicate<T extends SourceStamped>(records: T[]): T[] {
	const latestBySourceId = new Map<string, T>();
	for (const record of records) {
		const existing = latestBySourceId.get(record.sourceId);
		const candidateTime = Date.parse(record.sourceUpdatedAt ?? record.observedAt);
		const existingTime = existing ? Date.parse(existing.sourceUpdatedAt ?? existing.observedAt) : -Infinity;
		if (!existing || candidateTime >= existingTime) latestBySourceId.set(record.sourceId, record);
	}
	return [...latestBySourceId.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}

function imported<T extends SourceStamped>(
	provider: string,
	accountId: string,
	kind: string,
	records: T[],
	importedAt: string
): Imported<T>[] {
	return deduplicate(records).map((record) => ({
		importKey: `${provider}:${accountId}:${kind}:${record.sourceId}`,
		provider,
		accountId,
		importedAt,
		record
	}));
}

/**
 * Creates a connector with an injected mapper, keeping provider-specific API shapes
 * outside the application domain and ensuring bearer credentials are never returned.
 */
export function createAuthorizedWearableConnector<TPayload>(
	config: WearableConnectorConfig<TPayload>
): AuthorizedWearableConnector {
	assertNonEmpty(config.provider, 'provider');
	assertNonEmpty(config.endpoint, 'endpoint');
	const fetcher = config.fetcher ?? fetch;
	const now = config.now ?? (() => new Date());

	return {
		async importSnapshot(accessToken: string): Promise<WearableImportSnapshot> {
			assertNonEmpty(accessToken, 'accessToken');
			const response = await fetcher(config.endpoint, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: 'application/json'
				}
			});
			if (!response.ok) throw new Error(`Wearable import failed with HTTP ${response.status}`);

			const payload = config.mapPayload((await response.json()) as TPayload);
			validatePayload(payload);
			const importedAt = now().toISOString();
			return {
				provider: config.provider,
				accountId: payload.accountId,
				importedAt,
				vo2max: imported(config.provider, payload.accountId, 'vo2max', payload.vo2max ?? [], importedAt),
				heartRateZones: imported(config.provider, payload.accountId, 'heart-rate-zones', payload.heartRateZones ?? [], importedAt),
				workouts: imported(config.provider, payload.accountId, 'workout', payload.workouts ?? [], importedAt)
			};
		}
	};
}

export interface SixWeekPlanInput {
	workouts: readonly Workout[];
	vo2max: readonly Vo2MaxReading[];
	heartRateZones: readonly HeartRateZoneSet[];
	fatigue: FatigueLevel;
	/** Absolute user/clinician limit; must be between one and seven sessions. */
	maximumSessionsPerWeek: number;
	now?: Date;
}

export interface SixWeekPlanWeek {
	week: number;
	maximumSessions: number;
	focus: 'recovery' | 'aerobic-base' | 'progression';
}

export interface SixWeekFrequencyPlan {
	weeks: SixWeekPlanWeek[];
	evidence: {
		fatigue: FatigueLevel;
		recentWorkoutDays: number;
		latestVo2max?: { value: number; observedAt: string };
		latestHeartRateZonesObservedAt?: string;
	};
}

/** Builds a frequency-capped plan; it deliberately does not prescribe medical advice or intensity targets. */
export function buildSixWeekFrequencyPlan(input: SixWeekPlanInput): SixWeekFrequencyPlan {
	if (!Number.isInteger(input.maximumSessionsPerWeek) || input.maximumSessionsPerWeek < 1 || input.maximumSessionsPerWeek > 7) {
		throw new Error('maximumSessionsPerWeek must be an integer between 1 and 7');
	}
	const now = input.now ?? new Date();
	const cutoff = now.getTime() - 28 * 24 * 60 * 60 * 1000;
	const recentDays = new Set(
		input.workouts
			.filter((workout) => Date.parse(workout.startedAt) >= cutoff)
			.map((workout) => workout.startedAt.slice(0, 10))
	);
	const historicalWeeklyFrequency = Math.ceil(recentDays.size / 4);
	const sustainableCap = Math.max(1, Math.min(input.maximumSessionsPerWeek, Math.max(2, historicalWeeklyFrequency)));
	const fatigueReduction = input.fatigue === 'high' ? 2 : input.fatigue === 'moderate' ? 1 : 0;
	const fatigueCap = Math.max(1, sustainableCap - fatigueReduction);
	const focus = input.fatigue === 'high' ? 'recovery' : input.fatigue === 'moderate' ? 'aerobic-base' : 'progression';
	const latestVo2max = [...input.vo2max].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
	const latestZones = [...input.heartRateZones].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];

	return {
		weeks: Array.from({ length: 6 }, (_, index) => ({ week: index + 1, maximumSessions: fatigueCap, focus })),
		evidence: {
			fatigue: input.fatigue,
			recentWorkoutDays: recentDays.size,
			latestVo2max: latestVo2max && { value: latestVo2max.value, observedAt: latestVo2max.observedAt },
			latestHeartRateZonesObservedAt: latestZones?.observedAt
		}
	};
}
