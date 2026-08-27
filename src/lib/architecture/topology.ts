// Data model for the /admin/ops/architecture map. The diagram is *generated*
// from this — add a node/edge here and it renders, no layout code to touch.
// Reflects the real homeserv/Hetzner/Azure/Google/Cloudflare estate.

export type NodeKind =
  | 'client'
  | 'edge'
  | 'app'
  | 'datastore'
  | 'storage'
  | 'service'
  | 'external'
  | 'backup';

export type HealthStatus = 'up' | 'degraded' | 'down' | 'unknown' | 'static';

export interface ArchGroup {
  id: string;
  label: string;
  /** Provider family — drives the accent colour + legend. */
  provider: 'client' | 'cloudflare' | 'hetzner' | 'home' | 'azure' | 'google' | 'llm' | 'messaging' | 'backup';
  /** Layout column, left→right (roughly request-flow order). */
  col: number;
}

export interface ArchNode {
  id: string;
  label: string;
  kind: NodeKind;
  group: string;
  note?: string;
  url?: string;
  /** Key in the /api/admin/architecture/health response. Absent = no live probe (static). */
  healthId?: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
  kind?: 'primary' | 'data' | 'backup' | 'control';
}

export const GROUPS: ArchGroup[] = [
  { id: 'client', label: 'Clients', provider: 'client', col: 0 },
  { id: 'cloudflare', label: 'Cloudflare', provider: 'cloudflare', col: 1 },
  { id: 'hetzner', label: 'Hetzner VPS · 157.180.19.38', provider: 'hetzner', col: 2 },
  { id: 'home', label: 'homeserv (home · residential IP)', provider: 'home', col: 2 },
  { id: 'azure', label: 'Azure · UK South', provider: 'azure', col: 3 },
  { id: 'google', label: 'Google', provider: 'google', col: 3 },
  { id: 'llm', label: 'LLM providers', provider: 'llm', col: 3 },
  { id: 'messaging', label: 'Messaging', provider: 'messaging', col: 3 },
  { id: 'backup', label: 'Backup & Recovery', provider: 'backup', col: 4 },
];

export const NODES: ArchNode[] = [
  { id: 'users', label: 'Visitors / You', kind: 'client', group: 'client', note: 'browser · WebDAV' },

  { id: 'cf', label: 'Cloudflare', kind: 'edge', group: 'cloudflare', note: 'DNS · Tunnel · CDN', healthId: 'site' },

  // Hetzner VPS (production)
  { id: 'vps-app', label: 'SvelteKit app', kind: 'app', group: 'hetzner', note: ':4173 · adapter-node', url: 'https://strangeramblings.com', healthId: 'workflow-engine' },
  { id: 'vps-db', label: 'PostgreSQL 16', kind: 'datastore', group: 'hetzner', note: 'Docker · pgvector', healthId: 'database' },
  { id: 'vps-builder', label: 'jkai-builder', kind: 'service', group: 'hetzner', note: 'sidecar · unix socket' },
  { id: 'vps-wa', label: 'jkai-wa-worker', kind: 'service', group: 'hetzner', note: 'sidecar · :3110 · owns the WhatsApp session', healthId: 'whatsapp' },
  { id: 'vps-cf', label: 'cloudflared', kind: 'service', group: 'hetzner', note: 'tunnel client' },

  // homeserv (home)
  { id: 'hs-svc', label: 'SvelteKit (dev)', kind: 'app', group: 'home', note: ':5173 · scrape proxy', healthId: 'homeserv' },
  { id: 'hs-sandbox', label: 'jkai-sandbox', kind: 'service', group: 'home', note: 'Docker · Playwright' },

  // Azure
  { id: 'az-blob', label: 'Blob Storage', kind: 'storage', group: 'azure', note: 'srdrive4bbb12aa · Cool · LRS', healthId: 'azure' },
  { id: 'az-containers', label: 'drive · media · blog', kind: 'storage', group: 'azure', note: '+ tfstate (Terraform)' },

  // Google
  { id: 'google', label: 'Google', kind: 'external', group: 'google', note: 'OAuth · Gmail · Calendar' },

  // LLM
  { id: 'openrouter', label: 'OpenRouter', kind: 'external', group: 'llm', note: 'all models · incl. GLM via z-ai/*' },

  // Messaging
  { id: 'whatsapp', label: 'WhatsApp', kind: 'external', group: 'messaging', note: 'via the wa-worker' },

  // Backup & Recovery
  { id: 'b2', label: 'Backblaze B2', kind: 'backup', group: 'backup', note: 'restic · daily 03:00' },
  { id: 'github', label: 'GitHub', kind: 'backup', group: 'backup', note: 'SR-Main · homeserv-infra · recovery' },
];

export const EDGES: ArchEdge[] = [
  { from: 'users', to: 'cf', label: 'HTTPS', kind: 'primary' },
  { from: 'cf', to: 'vps-app', label: 'tunnel → :4173', kind: 'primary' },
  { from: 'vps-cf', to: 'cf', label: 'outbound tunnel', kind: 'control' },
  { from: 'vps-app', to: 'vps-db', label: 'SQL', kind: 'data' },
  { from: 'vps-app', to: 'vps-builder', label: 'builds', kind: 'control' },
  { from: 'vps-app', to: 'az-blob', label: 'files / media / blog', kind: 'data' },
  { from: 'az-blob', to: 'az-containers' },
  { from: 'vps-app', to: 'google', label: 'OAuth · Gmail', kind: 'data' },
  { from: 'vps-app', to: 'openrouter', label: 'LLM gateway', kind: 'data' },
  { from: 'vps-app', to: 'hs-svc', label: 'scrape proxy (Tailscale)', kind: 'control' },
  { from: 'hs-svc', to: 'hs-sandbox', label: 'stealth scrape' },
  { from: 'vps-app', to: 'vps-wa', label: 'delegated sends', kind: 'control' },
  { from: 'vps-wa', to: 'whatsapp', label: 'send / receive', kind: 'data' },
  { from: 'vps-db', to: 'b2', label: 'restic', kind: 'backup' },
  { from: 'vps-db', to: 'hs-svc', label: 'DB pull 02:30', kind: 'backup' },
  { from: 'vps-app', to: 'github', label: 'deploy from', kind: 'backup' },
];
