import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activityConnections,
  activityOnboardingSessions,
  type ActivityOnboardingSession,
} from '$lib/db/schema';
import { isActivityOnboardingOutcomeId, type ActivityOnboardingOutcomeId } from '../onboarding';
import { getCatalogProvider } from '../providers/catalog';
import { ACTIVITY_DATA_CLASSES, type ActivityDataClass } from '../contracts';
import { randomActivityId } from './ids';

export const ACTIVITY_ONBOARDING_STATUSES = [
  'choosing_source',
  'preparing',
  'waiting_export',
  'connecting',
  'verifying',
  'choosing_uses',
  'syncing',
  'complete',
  'paused',
] as const;

export type ActivityOnboardingStatus = (typeof ACTIVITY_ONBOARDING_STATUSES)[number];

export class ActivityOnboardingError extends Error {
  constructor(
    readonly code:
      'session_not_found' | 'invalid_outcome' | 'invalid_provider' | 'connection_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'ActivityOnboardingError';
  }
}

function validateOutcomes(outcomes: string[]): ActivityOnboardingOutcomeId[] {
  const unique = [...new Set(outcomes)];
  if (unique.length === 0 || unique.some((outcome) => !isActivityOnboardingOutcomeId(outcome))) {
    throw new ActivityOnboardingError(
      'invalid_outcome',
      'Choose at least one recognized onboarding outcome',
    );
  }
  return unique as ActivityOnboardingOutcomeId[];
}

function validateProvider(providerId: string | null): string | null {
  if (!providerId) return null;
  const provider = getCatalogProvider(providerId);
  if (!provider || provider.manifest.hidden) {
    throw new ActivityOnboardingError('invalid_provider', 'Unknown activity provider');
  }
  return providerId;
}

function validateDataClasses(
  providerId: string | null,
  values: string[] | undefined,
): ActivityDataClass[] {
  if (!providerId) return [];
  const manifest = getCatalogProvider(providerId)!.manifest;
  const requested = values === undefined ? manifest.dataClasses : [...new Set(values)];
  if (
    requested.length === 0 ||
    requested.some(
      (value) =>
        !ACTIVITY_DATA_CLASSES.includes(value as ActivityDataClass) ||
        !manifest.dataClasses.includes(value as ActivityDataClass),
    )
  ) {
    throw new ActivityOnboardingError(
      'invalid_provider',
      'Choose at least one data class offered by this provider',
    );
  }
  return requested as ActivityDataClass[];
}

export async function getActivityOnboardingSession(
  principalId: string,
  sessionId: string,
): Promise<ActivityOnboardingSession | null> {
  const [row] = await db
    .select()
    .from(activityOnboardingSessions)
    .where(
      and(
        eq(activityOnboardingSessions.id, sessionId),
        eq(activityOnboardingSessions.principalId, principalId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function requireActivityOnboardingSession(
  principalId: string,
  sessionId: string,
): Promise<ActivityOnboardingSession> {
  const row = await getActivityOnboardingSession(principalId, sessionId);
  if (!row) {
    throw new ActivityOnboardingError('session_not_found', 'Activity onboarding journey not found');
  }
  return row;
}

export async function getLatestActivityOnboardingSession(
  principalId: string,
): Promise<ActivityOnboardingSession | null> {
  const [row] = await db
    .select()
    .from(activityOnboardingSessions)
    .where(
      and(
        eq(activityOnboardingSessions.principalId, principalId),
        ne(activityOnboardingSessions.status, 'complete'),
      ),
    )
    .orderBy(desc(activityOnboardingSessions.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function saveActivityOnboardingSelection(input: {
  principalId: string;
  sessionId?: string | null;
  outcomes: string[];
  selectedProvider?: string | null;
  dataClasses?: string[];
}): Promise<ActivityOnboardingSession> {
  const outcomes = validateOutcomes(input.outcomes);
  const selectedProvider = validateProvider(input.selectedProvider ?? null);
  const dataClasses = validateDataClasses(selectedProvider, input.dataClasses);
  let status: ActivityOnboardingStatus = selectedProvider ? 'preparing' : 'choosing_source';
  if (!input.sessionId) {
    const [created] = await db
      .insert(activityOnboardingSessions)
      .values({
        id: randomActivityId('aonb'),
        principalId: input.principalId,
        outcomes,
        selectedProvider,
        dataClasses,
        status,
      })
      .returning();
    return created;
  }

  const current = await requireActivityOnboardingSession(input.principalId, input.sessionId);
  const preserveExportWait =
    current.status === 'waiting_export' && current.selectedProvider === selectedProvider;
  if (preserveExportWait) status = 'waiting_export';
  const [updated] = await db
    .update(activityOnboardingSessions)
    .set({
      outcomes,
      selectedProvider,
      dataClasses,
      status,
      exportRequestedAt: preserveExportWait ? current.exportRequestedAt : null,
      remindAt: preserveExportWait ? current.remindAt : null,
      version: sql`${activityOnboardingSessions.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(activityOnboardingSessions.id, input.sessionId),
        eq(activityOnboardingSessions.principalId, input.principalId),
      ),
    )
    .returning();
  if (!updated) {
    throw new ActivityOnboardingError('session_not_found', 'Activity onboarding journey not found');
  }
  return updated;
}

export async function recordActivityExportRequest(input: {
  principalId: string;
  sessionId: string;
  now?: Date;
}): Promise<ActivityOnboardingSession> {
  const session = await requireActivityOnboardingSession(input.principalId, input.sessionId);
  const provider = session.selectedProvider ? getCatalogProvider(session.selectedProvider) : null;
  if (!provider || !provider.manifest.modes.includes('import')) {
    throw new ActivityOnboardingError(
      'invalid_provider',
      'This onboarding journey is not using an archive provider',
    );
  }
  const now = input.now ?? new Date();
  const reminderDays = session.selectedProvider === 'youtube_takeout' ? 1 : 7;
  const remindAt = new Date(now.getTime() + reminderDays * 86_400_000);
  const [updated] = await db
    .update(activityOnboardingSessions)
    .set({
      status: 'waiting_export',
      exportRequestedAt: now,
      remindAt,
      version: sql`${activityOnboardingSessions.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(activityOnboardingSessions.id, input.sessionId),
        eq(activityOnboardingSessions.principalId, input.principalId),
      ),
    )
    .returning();
  return updated;
}

export async function attachActivityOnboardingConnection(input: {
  principalId: string;
  sessionId: string;
  connectionId: string;
}): Promise<ActivityOnboardingSession> {
  const [connection] = await db
    .select({
      id: activityConnections.id,
      provider: activityConnections.provider,
    })
    .from(activityConnections)
    .where(
      and(
        eq(activityConnections.id, input.connectionId),
        eq(activityConnections.principalId, input.principalId),
      ),
    )
    .limit(1);
  const session = await requireActivityOnboardingSession(input.principalId, input.sessionId);
  if (!connection || connection.provider !== session.selectedProvider) {
    throw new ActivityOnboardingError(
      'connection_mismatch',
      'The connection does not belong to this onboarding source',
    );
  }
  const [updated] = await db
    .update(activityOnboardingSessions)
    .set({
      connectionId: connection.id,
      status: 'connecting',
      version: sql`${activityOnboardingSessions.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(activityOnboardingSessions.id, input.sessionId),
        eq(activityOnboardingSessions.principalId, input.principalId),
      ),
    )
    .returning();
  return updated;
}

export async function updateActivityOnboardingProgress(input: {
  principalId: string;
  sessionId: string;
  connectionId: string;
  step: number;
}): Promise<ActivityOnboardingSession> {
  const session = await requireActivityOnboardingSession(input.principalId, input.sessionId);
  if (session.connectionId !== input.connectionId) {
    throw new ActivityOnboardingError(
      'connection_mismatch',
      'The connection does not belong to this onboarding journey',
    );
  }
  const statusByStep: Record<number, ActivityOnboardingStatus> = {
    3: 'connecting',
    4: 'connecting',
    5: 'verifying',
    6: 'choosing_uses',
    7: 'syncing',
    8: 'complete',
  };
  const status = statusByStep[Math.max(3, Math.min(8, Math.floor(input.step)))] ?? 'connecting';
  const now = new Date();
  const [updated] = await db
    .update(activityOnboardingSessions)
    .set({
      status,
      completedAt: status === 'complete' ? now : null,
      version: sql`${activityOnboardingSessions.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(activityOnboardingSessions.id, input.sessionId),
        eq(activityOnboardingSessions.principalId, input.principalId),
      ),
    )
    .returning();
  return updated;
}

export function publicActivityOnboardingSession(row: ActivityOnboardingSession) {
  const { principalId: _principalId, ...safe } = row;
  return safe;
}
