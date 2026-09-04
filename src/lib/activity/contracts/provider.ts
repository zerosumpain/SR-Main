import type { ActivityDataClass, ActivityEventV1, EvidenceMode } from './event';

export const CONNECTION_MODES = ['oauth', 'openid', 'api_key', 'import', 'device'] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export const PROVIDER_AVAILABILITY = [
  'available',
  'beta',
  'approval_required',
  'planned',
  'disabled',
] as const;
export type ProviderAvailability = (typeof PROVIDER_AVAILABILITY)[number];

export interface ProviderScope {
  id: string;
  label: string;
  description: string;
  dataClasses: ActivityDataClass[];
  required?: boolean;
}

export interface ProviderManifest {
  id: string;
  name: string;
  category: 'games' | 'music_podcasts' | 'social' | 'work' | 'health' | 'home';
  description: string;
  availability: ProviderAvailability;
  availabilityNote: string;
  modes: ConnectionMode[];
  evidenceModes: EvidenceMode[];
  eventTypes: string[];
  dataClasses: ActivityDataClass[];
  scopes: ProviderScope[];
  supportsIncrementalSync: boolean;
  supportsBackfill: boolean;
  supportsWebhooks: boolean;
  requiredSecrets: string[];
  policyGate?: string;
  hidden?: boolean;
}

export interface ActivityConnectionContext {
  principalId: string;
  connectionId: string;
  providerId: string;
  providerAccountId?: string | null;
  mode: ConnectionMode;
  scopes: string[];
  /** Opaque vault row id; adapters resolve it server-side after ownership checks. */
  credentialId?: string | null;
  observedAt: string;
  cursor?: Record<string, unknown> | null;
}

export interface ProviderPage {
  events: ActivityEventV1[];
  /** Redacted object metadata that is safe to show in an import report. */
  objectSummaries?: Array<{
    providerObjectId: string;
    providerRevision?: string;
    checksum?: string;
    dataClass: ActivityDataClass;
  }>;
  nextCursor?: Record<string, unknown> | null;
  hasMore: boolean;
  warnings?: string[];
}

export interface ProviderHealthResult {
  status: 'healthy' | 'private' | 'rate_limited' | 'credential_error' | 'provider_error';
  message: string;
  retryAt?: string;
}

export interface ImportInspection {
  format: string;
  formatVersion?: string;
  recognizedFiles: string[];
  ignoredFiles: string[];
  estimatedRecords: number;
  expandedBytes?: number;
  dateRange?: { from: string; to: string };
  warnings: string[];
}

export interface ActivityProviderAdapter {
  manifest: ProviderManifest;
  testConnection?(context: ActivityConnectionContext): Promise<ProviderHealthResult>;
  sync?(context: ActivityConnectionContext): AsyncIterable<ProviderPage>;
  inspectImport?(input: { name: string; bytes: Uint8Array }): Promise<ImportInspection>;
  import?(
    context: ActivityConnectionContext,
    input: { importId: string; name: string; bytes: Uint8Array },
  ): AsyncIterable<ProviderPage>;
  disconnect?(context: ActivityConnectionContext): Promise<void>;
}

export function assertProviderCanEmit(
  manifest: ProviderManifest,
  event: ActivityEventV1,
): void {
  if (event.source !== manifest.id) {
    throw new Error(`provider ${manifest.id} cannot emit source ${event.source}`);
  }
  if (!manifest.eventTypes.includes(event.type)) {
    throw new Error(`provider ${manifest.id} cannot emit event type ${event.type}`);
  }
  if (!manifest.evidenceModes.includes(event.evidenceMode)) {
    throw new Error(`provider ${manifest.id} cannot emit evidence ${event.evidenceMode}`);
  }
}
