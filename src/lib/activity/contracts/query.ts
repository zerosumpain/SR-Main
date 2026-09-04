import type { EvidenceMode } from './event';
import { ActivityContractError } from './event';

export type ActivityCoverage =
  | 'complete'
  | 'partial'
  | 'snapshot_only'
  | 'stale'
  | 'unavailable';

export interface ActivityEventQuery {
  connectionIds?: string[];
  categories?: string[];
  evidenceModes?: EvidenceMode[];
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface BoundedActivityEventQuery extends ActivityEventQuery {
  limit: number;
}

export const DEFAULT_EVENT_PAGE_SIZE = 40;
export const MAX_EVENT_PAGE_SIZE = 100;
export const MAX_EVENT_QUERY_DAYS = 366;

export function boundActivityEventQuery(query: ActivityEventQuery): BoundedActivityEventQuery {
  const limit = Math.max(
    1,
    Math.min(MAX_EVENT_PAGE_SIZE, Math.floor(query.limit ?? DEFAULT_EVENT_PAGE_SIZE)),
  );

  if (query.from && !Number.isFinite(Date.parse(query.from))) {
    throw new ActivityContractError('invalid_event', 'from must be an ISO date-time');
  }
  if (query.to && !Number.isFinite(Date.parse(query.to))) {
    throw new ActivityContractError('invalid_event', 'to must be an ISO date-time');
  }
  if (query.from && query.to) {
    const span = Date.parse(query.to) - Date.parse(query.from);
    if (span < 0) throw new ActivityContractError('invalid_event', 'to must not be before from');
    if (span > MAX_EVENT_QUERY_DAYS * 86_400_000) {
      throw new ActivityContractError(
        'invalid_event',
        `event query may span at most ${MAX_EVENT_QUERY_DAYS} days`,
      );
    }
  }

  return { ...query, limit };
}
