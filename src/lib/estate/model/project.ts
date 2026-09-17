/**
 * Project the estate model onto the map.
 *
 * `ArchitectureMap.svelte` survives the retirement of `topology.ts` and is worth
 * keeping: 450 lines of column layout, bezier edge routing, neighbour
 * highlighting, zoom and fullscreen, and it is a pure function of
 * (groups, nodes, edges, health) that knows nothing about what a node means.
 * "Bin the current approach" was about the hand-typed data, not the drawing.
 *
 * So these types move here from topology.ts rather than dying with it, and this
 * module is the adapter between the generated model and the renderer.
 *
 * THE LAYOUT DECISION. The estate is 30 containers across 8 applications. Drawn
 * one node per container it is spaghetti, and a map nobody can read is worse
 * than no map because it still looks authoritative. So the projection aggregates
 * to the APPLICATION — one node per app, carrying its own runtime state — and
 * orders them by cloudflared's first-match `routeOrder`, which means the picture
 * reads top-to-bottom in the order a request is actually matched. Main sits last
 * because it is the deliberate fallback that keeps a half-finished extraction
 * safe, and on the map that is visible rather than a footnote.
 */
import registry from '../registry/apps.generated.json';
import type { EstateModel } from './types';

export type NodeKind =
  | 'client'
  | 'edge'
  | 'app'
  | 'datastore'
  | 'storage'
  | 'service'
  | 'external'
  | 'repo';

/** `static` = nothing probes it and nothing claims to. Distinct from `unknown`,
 *  which means a probe ran and could not tell. */
export type HealthStatus = 'up' | 'degraded' | 'down' | 'unknown' | 'static';

export interface ArchGroup {
  id: string;
  label: string;
  provider: 'client' | 'cloudflare' | 'hetzner' | 'home' | 'azure' | 'google' | 'llm' | 'messaging' | 'backup';
  col: number;
}

export interface ArchNode {
  id: string;
  label: string;
  kind: NodeKind;
  group: string;
  note?: string;
  url?: string;
  healthId?: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
  kind?: 'primary' | 'data' | 'backup' | 'control';
}

export interface MapProjection {
  groups: ArchGroup[];
  nodes: ArchNode[];
  edges: ArchEdge[];
  health: Record<string, HealthStatus>;
}

const GROUPS: ArchGroup[] = [
  { id: 'client', label: 'Clients', provider: 'client', col: 0 },
  { id: 'edge', label: 'Cloudflare', provider: 'cloudflare', col: 1 },
  { id: 'apps', label: 'Applications · cloudflared first-match order', provider: 'hetzner', col: 2 },
  { id: 'data', label: 'Data', provider: 'hetzner', col: 3 },
  { id: 'repos', label: 'Repositories', provider: 'backup', col: 4 },
];

/**
 * One application's state, from what the runtime feed actually observed.
 *
 * `static` rather than `up` when nothing was probed: a map that paints a node
 * green because no one looked is the failure this whole model exists to end —
 * the surface it replaces returned `site: 'up'` as a string literal, so it could
 * never go red about the app it was drawn on.
 */
function appHealth(model: EstateModel, key: string): HealthStatus {
  const containers = model.nodes.filter((n) => n.layer === 'container' && n.id.startsWith(`container:${key}-`));
  if (!containers.length) return 'static';

  const serving = (role: string) =>
    containers.find((c) => c.id === `container:${key}-${role}`)?.facts?.serving === true;

  const hasGateway = containers.some((c) => c.id === `container:${key}-gateway`);
  if (hasGateway && !serving('gateway')) return 'down';
  // A gateway up with no primary behind it is the staged-never-promoted shape:
  // it answers, but it is serving a candidate. Degraded, not up.
  const hasPrimary = containers.some((c) => c.id === `container:${key}-primary`);
  if (hasPrimary && !serving('primary')) return 'degraded';
  // A declared worker that is not running is degraded too — that is how
  // SR-Health's health-sync lane reads today.
  const hasWorker = containers.some((c) => c.id === `container:${key}-worker`);
  if (hasWorker && !serving('worker')) return 'degraded';
  return 'up';
}

export function projectMap(model: EstateModel): MapProjection {
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const health: Record<string, HealthStatus> = {};

  nodes.push({ id: 'users', label: 'Visitors / You', kind: 'client', group: 'client', note: 'browser' });
  nodes.push({
    id: 'cf',
    label: 'cloudflared',
    kind: 'edge',
    group: 'edge',
    note: `${registry.canonicalHost} · first match wins`,
    healthId: 'cf',
  });
  health.cf = 'static';
  edges.push({ from: 'users', to: 'cf', label: 'HTTPS', kind: 'primary' });

  // routeOrder IS the routing rule, so it is also the drawing order.
  const ordered = [...registry.apps].sort(
    (a, b) => registry.routeOrder.indexOf(a.key) - registry.routeOrder.indexOf(b.key),
  );

  for (const app of ordered) {
    const id = `app-${app.key}`;
    const status = appHealth(model, app.key);
    const ports = Object.entries(app.ports)
      .map(([role, p]) => `${role} ${p}`)
      .join(' · ');
    nodes.push({
      id,
      label: app.key,
      kind: 'app',
      group: 'apps',
      note: app.status === 'live' ? ports : `${app.status} · ${ports}`,
      healthId: id,
    });
    health[id] = app.status === 'live' ? status : 'static';

    edges.push({
      from: 'cf',
      to: id,
      label: app.paths.slice(0, 2).join(' ') || '—',
      kind: 'primary',
    });

    if (app.repo) {
      const repoId = `repo-${app.repo.split('/')[1] ?? app.repo}`;
      if (!nodes.some((n) => n.id === repoId)) {
        nodes.push({
          id: repoId,
          label: app.repo.split('/')[1] ?? app.repo,
          kind: 'repo',
          group: 'repos',
          note: app.branch ? `branch ${app.branch}` : undefined,
          url: `https://github.com/${app.repo}`,
        });
      }
      edges.push({ from: id, to: repoId, label: 'built from', kind: 'backup' });
    }
  }

  // The one datastore every application shares. Drawn from the model's table
  // count rather than asserted, so the note cannot drift from the schema.
  const tables = model.nodes.filter((n) => n.layer === 'table').length;
  nodes.push({
    id: 'db',
    label: 'PostgreSQL 16',
    kind: 'datastore',
    group: 'data',
    note: `${tables} relations · pgvector`,
    healthId: 'db',
  });
  health.db = 'static';
  edges.push({ from: 'app-main', to: 'db', label: 'SQL', kind: 'data' });

  return { groups: GROUPS, nodes, edges, health };
}
