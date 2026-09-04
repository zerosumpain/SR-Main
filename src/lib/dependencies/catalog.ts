/**
 * External and platform dependencies whose failure changes what the site can
 * do. The dashboard is generated from this catalogue: adding a dependency is
 * one data change plus one probe, rather than another hand-built card.
 */
export type DependencyState = 'green' | 'amber' | 'red' | 'unknown';
export type DependencyImpact = 'delivery' | 'feature' | 'operations';

export interface DependencyDefinition {
  id: string;
  label: string;
  impact: DependencyImpact;
  affects: string;
  detail: string;
  statusUrl: string;
}

export interface DependencyObservation {
  dependencyId: string;
  state: DependencyState;
  summary: string;
  checkedAt: Date;
  latencyMs: number | null;
}

export interface DependencyDay {
  date: string;
  state: DependencyState;
}

export interface DependencyCard extends DependencyDefinition {
  state: DependencyState;
  summary: string;
  checkedAt: string | null;
  stale: boolean;
  healthyPct: number | null;
  availablePct: number | null;
  coveragePct: number | null;
  largestGapMinutes: number | null;
  knownChecks: number;
  degradedChecks: number;
  downChecks: number;
  unknownChecks: number;
  lastDegradedAt: string | null;
  days: DependencyDay[];
}

export interface DependencyOverview {
  dependencies: DependencyCard[];
  checkedAt: string | null;
  observedFrom: string | null;
  pollEveryMs: number;
  userImpact: {
    state: DependencyState;
    confirmed: boolean;
    evidenceGap: boolean;
    affectedDependencies: number;
    summary: string;
  };
}

export const DEPENDENCY_POLL_INTERVAL_MS = 5 * 60 * 1_000;
export const DEPENDENCY_HISTORY_DAYS = 30;
export const DEPENDENCY_RETENTION_DAYS = 90;

export const DEPENDENCIES: DependencyDefinition[] = [
  {
    id: 'public-site',
    label: 'Public experience',
    impact: 'delivery',
    affects: 'Every visitor',
    detail: 'DNS → Cloudflare edge → tunnel → SvelteKit origin',
    statusUrl: 'https://strangeramblings.com/',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    impact: 'delivery',
    affects: 'Every visitor',
    detail: 'Authoritative DNS, CDN, Access, Tunnel and UK edge',
    statusUrl: 'https://www.cloudflarestatus.com/',
  },
  {
    id: 'hetzner',
    label: 'Hetzner Cloud',
    impact: 'delivery',
    affects: 'Every visitor',
    detail: 'Production VPS compute and network',
    statusUrl: 'https://status.hetzner.com/',
  },
  {
    id: 'azure',
    label: 'Azure Blob Storage',
    impact: 'feature',
    affects: 'Files, media and blog images',
    detail: 'UK South drive, media and blog containers',
    statusUrl: 'https://azure.status.microsoft/en-gb/status/',
  },
  {
    id: 'google',
    label: 'Google',
    impact: 'feature',
    affects: 'Sign-in, Gmail and Calendar',
    detail: 'Identity and Workspace APIs',
    statusUrl: 'https://www.google.com/appsstatus/dashboard/',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    impact: 'feature',
    affects: 'AI and generation features',
    detail: 'Model catalogue and inference gateway',
    statusUrl: 'https://status.openrouter.ai/',
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    impact: 'feature',
    affects: 'Home-backed features',
    detail: 'Coordination, DERP and cross-host tailnet',
    statusUrl: 'https://status.tailscale.com/',
  },
  {
    id: 'github',
    label: 'GitHub',
    impact: 'operations',
    affects: 'Builds and deployments',
    detail: 'Git operations and Actions release lane',
    statusUrl: 'https://www.githubstatus.com/',
  },
  {
    id: 'backblaze',
    label: 'Backblaze B2',
    impact: 'operations',
    affects: 'Disaster recovery',
    detail: 'Nightly off-site backup target',
    statusUrl: 'https://status.backblaze.com/',
  },
];

const STATE_WEIGHT: Record<DependencyState, number> = {
  green: 0,
  unknown: 1,
  amber: 2,
  red: 3,
};

export function worstState(states: DependencyState[]): DependencyState {
  if (!states.length) return 'unknown';
  return states.slice(1).reduce((worst, state) =>
    STATE_WEIGHT[state] > STATE_WEIGHT[worst] ? state : worst,
  states[0]);
}
