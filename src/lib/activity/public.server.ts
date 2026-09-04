import type {
  ActivityConnection,
  ActivityConsumerGrantRow,
  ActivityImport,
  ActivitySyncJob,
} from '$lib/db/schema';

/** Deliberately shape browser/API data instead of serializing persistence rows. */
export function publicActivityConnection(row: ActivityConnection) {
  const {
    principalId: _principalId,
    credentialId: _credentialId,
    providerAccountId: _providerAccountId,
    ...safe
  } = row;
  return safe;
}

export function publicActivityGrant(row: ActivityConsumerGrantRow) {
  const { principalId: _principalId, ...safe } = row;
  return safe;
}

export function publicActivityJob(row: ActivitySyncJob) {
  const {
    principalId: _principalId,
    leaseOwner: _leaseOwner,
    leaseExpiresAt: _leaseExpiresAt,
    idempotencyKey: _idempotencyKey,
    checkpoint: _checkpoint,
    ...safe
  } = row;
  return safe;
}

export function publicActivityImport(row: ActivityImport) {
  const {
    principalId: _principalId,
    archiveChecksum: _archiveChecksum,
    storageRef: _storageRef,
    ...safe
  } = row;
  return safe;
}
