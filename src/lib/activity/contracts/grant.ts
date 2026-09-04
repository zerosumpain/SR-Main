import type { ActivityDataClass } from './event';

export const ACTIVITY_CONSUMERS = [
  'jkai',
  'daydream',
  'briefing',
  'workflow',
  'intel',
  'mcp',
] as const;

export type ActivityConsumer = (typeof ACTIVITY_CONSUMERS)[number];

export interface ActivityConsumerGrant {
  id: string;
  principalId: string;
  connectionId: string;
  consumer: ActivityConsumer;
  dataClass: ActivityDataClass;
  /** Null means every category on this connection. */
  category: string | null;
  allowed: boolean;
  version: number;
}

export interface ActivityReadRequest {
  principalId: string;
  connectionId: string;
  consumer: ActivityConsumer;
  dataClass: ActivityDataClass;
  category: string;
}

export type ActivityAuthorization =
  | { allowed: true; grantId: string; grantVersion: number }
  | { allowed: false; reason: 'no_grant' | 'explicit_deny' | 'principal_mismatch' };

export type ActivityGrantRecord = Pick<
  ActivityConsumerGrant,
  'id' | 'principalId' | 'connectionId' | 'category' | 'allowed' | 'version'
> & {
  /** Persistence rows are DB-checked strings; unknown values never match a typed request. */
  consumer: string;
  dataClass: string;
};

/**
 * Fail-closed grant resolution. A category-specific grant beats a connection-
 * wide one; an explicit deny wins within the same specificity.
 */
export function authorizeActivityRead(
  request: ActivityReadRequest,
  grants: readonly ActivityGrantRecord[],
): ActivityAuthorization {
  const related = grants.filter(
    (grant) =>
      grant.connectionId === request.connectionId &&
      grant.consumer === request.consumer &&
      grant.dataClass === request.dataClass &&
      (grant.category === null || grant.category === request.category),
  );

  if (related.some((grant) => grant.principalId !== request.principalId)) {
    return { allowed: false, reason: 'principal_mismatch' };
  }

  const specific = related.filter((grant) => grant.category === request.category);
  const candidates = specific.length > 0 ? specific : related.filter((grant) => grant.category === null);
  if (candidates.length === 0) return { allowed: false, reason: 'no_grant' };

  const newest = candidates.reduce((best, grant) => (grant.version > best.version ? grant : best));
  if (!newest.allowed) return { allowed: false, reason: 'explicit_deny' };
  return { allowed: true, grantId: newest.id, grantVersion: newest.version };
}

export function defaultConsumerGrants(input: {
  principalId: string;
  connectionId: string;
  dataClasses: ActivityDataClass[];
}): ActivityConsumerGrant[] {
  const defaults: Array<{ consumer: ActivityConsumer; allowed: boolean }> = [
    { consumer: 'jkai', allowed: true },
    { consumer: 'daydream', allowed: true },
    { consumer: 'briefing', allowed: true },
    { consumer: 'workflow', allowed: false },
    { consumer: 'intel', allowed: false },
    { consumer: 'mcp', allowed: false },
  ];

  return defaults.flatMap(({ consumer, allowed }) =>
    input.dataClasses.map((dataClass) => ({
      id: `${input.connectionId}:${consumer}:${dataClass}:all`,
      principalId: input.principalId,
      connectionId: input.connectionId,
      consumer,
      dataClass,
      category: null,
      // Raw content and location are always opt-in, regardless of consumer.
      allowed: allowed && dataClass !== 'raw_content' && dataClass !== 'location',
      version: 1,
    })),
  );
}
