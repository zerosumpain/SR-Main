/**
 * Assemble the estate model from its feeds.
 *
 * Every feed is wrapped so that a feed which cannot run produces a ledger row
 * saying so, rather than silently contributing nothing. That distinction is the
 * reason this module exists: the surface it replaces reported a confident,
 * month-stale inventory because a filesystem scan SUCCEEDED against a directory
 * the deploy does not update. An empty answer must never look like a complete
 * one.
 */
import { existsSync } from 'node:fs';
import net from 'node:net';
import { is, getTableName } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '$lib/db/schema';
import { readApiSurface } from '../api-surface.server';
import { EXTRACTED_TRIGGERS } from '$lib/workflows/trigger-ownership';
import { listHandlers } from '$lib/heartbeat/registry';
import registry from '../registry/apps.generated.json';
import {
  nodeId,
  type EstateEdge,
  type EstateFinding,
  type EstateModel,
  type EstateNode,
  type FeedStamp,
} from './types';

/** How long a vendored registry may go unsynced before the page calls it stale. */
const REGISTRY_STALE_DAYS = 30;
const PORT_TIMEOUT_MS = 700;

/** True on the box that actually runs the extracted apps. Everywhere else a
 *  closed port means "not here", not "down" — the distinction a previous probe
 *  got wrong for months by treating every non-homeserv host as the VPS. */
function onReleaseHost(): boolean {
  return existsSync('/opt/strange-rambling-svelte');
}

function tcpOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(PORT_TIMEOUT_MS);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, '127.0.0.1');
  });
}

interface Feed {
  name: string;
  run: (ctx: { nodes: EstateNode[]; edges: EstateEdge[]; findings: EstateFinding[] }) => Promise<FeedStamp>;
}

/* ─────────────────────────── applications + repositories ────────────────── */

const appsFeed: Feed = {
  name: 'apps',
  async run({ nodes, edges, findings }) {
    const order = new Map(registry.routeOrder.map((k, i) => [k, i]));

    for (const app of registry.apps) {
      const id = nodeId('app', app.key);
      nodes.push({
        id,
        layer: 'app',
        label: app.key,
        provenance: 'generated',
        feed: 'apps',
        facts: {
          status: app.status,
          repo: app.repo,
          'ingress order': order.has(app.key) ? order.get(app.key)! + 1 : null,
          paths: app.paths.join(' '),
          'public patterns': app.publicPatterns.length,
          'passthrough patterns': app.passthroughPatterns.length,
          'queue triggers': app.queueTriggers.join(' ') || '—',
          'release dir': app.releaseDir,
          'execution owner': app.executionOwner,
        },
        warning: app.status !== 'live' ? `declared ${app.status}` : undefined,
      });

      if (app.repo) {
        const repoId = nodeId('repo', app.repo);
        if (!nodes.some((n) => n.id === repoId)) {
          nodes.push({
            id: repoId,
            layer: 'repo',
            label: app.repo,
            provenance: 'generated',
            feed: 'apps',
            url: `https://github.com/${app.repo}`,
            facts: { branch: app.branch, workflows: app.workflows.join(' ') || '—' },
          });
        }
        edges.push({ from: repoId, to: id, kind: 'builds', provenance: 'generated', feed: 'apps' });
      }

      // cloudflared is first-match, so the ordering IS the routing rule.
      for (const p of app.paths) {
        edges.push({
          from: nodeId('edge', 'cloudflared'),
          to: id,
          kind: 'routes',
          label: p,
          provenance: 'generated',
          feed: 'apps',
        });
      }
    }

    nodes.push({
      id: nodeId('edge', 'cloudflared'),
      layer: 'edge',
      label: 'cloudflared ingress',
      provenance: 'generated',
      feed: 'apps',
      facts: {
        host: registry.canonicalHost,
        'match order': registry.routeOrder.join(' → '),
        'first match wins': true,
      },
    });

    const age = daysSince(registry.syncedAt);
    if (age !== null && age > REGISTRY_STALE_DAYS) {
      findings.push({
        kind: 'stale',
        severity: 'medium',
        title: `The application registry was last synced ${age} days ago`,
        detail:
          `src/lib/estate/registry/apps.generated.json is vendored from SR-Infra, which lives only on ` +
          `homeserv. Run \`node scripts/sync-app-registry.mjs\` there and commit the result. Until then ` +
          `everything on this page about ports, paths and ingress order is ${age} days old.`,
      });
    }

    return {
      feed: 'apps',
      provenance: 'generated',
      describes: 'applications, repositories and the cloudflared ingress order',
      refresh: 'vendored from SR-Infra + a drift gate',
      count: registry.apps.length,
      asOf: registry.syncedAt,
    };
  },
};

/* ──────────────────────────────── containers ────────────────────────────── */

const runtimeFeed: Feed = {
  name: 'runtime',
  async run({ nodes, edges, findings }) {
    if (!onReleaseHost()) {
      return {
        feed: 'runtime',
        provenance: 'observed',
        describes: 'which declared port is actually serving',
        refresh: 'live loopback probe',
        count: null,
        error:
          'Not the release host. These ports bind 127.0.0.1 on the VPS, so probing them from ' +
          'anywhere else could only ever report "closed" — which would read as "down" rather ' +
          'than "not here".',
      };
    }

    let observed = 0;
    for (const app of registry.apps) {
      const roles = Object.entries(app.ports) as [string, number][];
      const open = await Promise.all(roles.map(async ([role, port]) => [role, port, await tcpOpen(port)] as const));
      for (const [role, port, isOpen] of open) {
        observed++;
        const id = nodeId('container', `${app.key}-${role}`);
        nodes.push({
          id,
          layer: 'container',
          label: `${app.key} · ${role}`,
          provenance: 'observed',
          feed: 'runtime',
          facts: { port, serving: isOpen },
          warning: isOpen ? undefined : 'declared, not answering',
        });
        edges.push({ from: id, to: nodeId('app', app.key), kind: 'runs', provenance: 'observed', feed: 'runtime' });
      }

      // The promotion model: a gateway in front, a primary behind it, a
      // candidate staged alongside. A candidate serving with no primary is an
      // extraction that was staged and never promoted — real, and invisible
      // everywhere else in the console.
      const by = Object.fromEntries(open.map(([role, , isOpen]) => [role, isOpen]));
      if (by.candidate && by.primary === false) {
        findings.push({
          kind: 'gap',
          severity: 'medium',
          title: `${app.key} is staged but never promoted`,
          detail:
            `Its candidate port (${app.ports.candidate}) is serving and its primary ` +
            `(${app.ports.primary}) is not. The registry says status "${app.status}".`,
          nodes: [nodeId('app', app.key)],
        });
      }
      if (app.status === 'live' && by.gateway === false) {
        findings.push({
          kind: 'mismatch',
          severity: 'high',
          title: `${app.key} is declared live and its gateway is not answering`,
          detail: `Nothing is listening on 127.0.0.1:${app.ports.gateway}. Anything routed to it is failing now.`,
          nodes: [nodeId('app', app.key)],
        });
      }
    }

    return {
      feed: 'runtime',
      provenance: 'observed',
      describes: 'which declared port is actually serving',
      refresh: 'live loopback probe on every load',
      count: observed,
    };
  },
};

/* ─────────────────────────────── routes + gates ─────────────────────────── */

const routesFeed: Feed = {
  name: 'routes',
  async run({ nodes }) {
    const surface = readApiSurface();
    if (!surface.available) {
      return {
        feed: 'routes',
        provenance: 'generated',
        describes: 'every page and API path this codebase serves, with its real gate',
        refresh: 'baked at build time by vite-plugins/route-manifest.mjs',
        count: null,
        error: surface.reason,
      };
    }

    for (const r of surface.routes) {
      nodes.push({
        id: nodeId('route', r.path),
        layer: 'route',
        label: r.path,
        provenance: 'generated',
        feed: 'routes',
        facts: { kind: r.kind, methods: r.methods.join(' ') || '—', gate: r.gate, guard: r.guard ?? null },
        warning: r.gate === 'open' ? 'anonymous' : undefined,
      });
    }

    return {
      feed: 'routes',
      provenance: 'generated',
      describes: 'every page and API path this codebase serves, classified by the REAL gate',
      refresh: 'baked at build time by vite-plugins/route-manifest.mjs',
      count: surface.routes.length,
    };
  },
};

/* ──────────────────────────────── data stores ───────────────────────────── */

const tablesFeed: Feed = {
  name: 'tables',
  async run({ nodes }) {
    let n = 0;
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      n++;
      const name = getTableName(value);
      nodes.push({
        id: nodeId('table', name),
        layer: 'table',
        label: name,
        provenance: 'generated',
        feed: 'tables',
      });
    }
    return {
      feed: 'tables',
      provenance: 'generated',
      describes: 'every relation declared in the Drizzle schema',
      refresh: 'read from the schema module in the running build',
      count: n,
    };
  },
};

/* ──────────────────── activities, and the repos behind them ─────────────── */

const activitiesFeed: Feed = {
  name: 'activities',
  async run({ nodes, edges, findings }) {
    const handlers = listHandlers();
    for (const h of handlers) {
      nodes.push({
        id: nodeId('activity', h.name),
        layer: 'activity',
        label: h.name,
        provenance: 'generated',
        feed: 'activities',
        facts: { cadence: `${Math.round(h.defaultCadenceSeconds / 60)} min`, description: h.description },
      });
    }

    // THE LINK: which repository underpins which activity.
    //
    // An app's worker claims a queue trigger; that trigger names a lane of work;
    // the app is built from a repository. So the registry already contains the
    // join — it had simply never been read on this side.
    for (const app of registry.apps) {
      for (const trigger of app.queueTriggers) {
        edges.push({
          from: nodeId('app', app.key),
          to: nodeId('activity', trigger),
          kind: 'owns-worker',
          label: `trigger "${trigger}"`,
          provenance: 'generated',
          feed: 'activities',
        });
        if (!nodes.some((n) => n.id === nodeId('activity', trigger))) {
          nodes.push({
            id: nodeId('activity', trigger),
            layer: 'activity',
            label: trigger,
            provenance: 'generated',
            feed: 'activities',
            facts: { 'claimed by': app.key, kind: 'queue trigger' },
          });
        }
      }
    }

    // The registry says what a repo INTENDS to own. EXTRACTED_TRIGGERS says what
    // a worker is actually live and claiming. These are different statements and
    // deriving one from the other is a trap: it would stop Main's generic worker
    // claiming a lane while no dedicated worker existed to claim it, and the
    // queue would fill with no owner and no error. So: report, never reconcile.
    const declared = new Set<string>(EXTRACTED_TRIGGERS);
    for (const app of registry.apps) {
      for (const trigger of app.queueTriggers) {
        if (!declared.has(trigger)) {
          findings.push({
            kind: 'mismatch',
            severity: 'medium',
            title: `${app.key} declares the "${trigger}" queue trigger, and Main still claims that lane`,
            detail:
              `SR-Infra's registry lists "${trigger}" under ${app.key}, but EXTRACTED_TRIGGERS in ` +
              `src/lib/workflows/trigger-ownership.ts does not, so this process still executes it. ` +
              `That is correct while no ${app.key} worker is live — the two lists answer different ` +
              `questions, and only a human edit should change the claim predicate. Worth checking ` +
              `whether that worker has since gone live.`,
            nodes: [nodeId('app', app.key), nodeId('activity', trigger)],
          });
        }
      }
    }

    return {
      feed: 'activities',
      provenance: 'generated',
      describes: 'heartbeat activities, and which repository owns each queue lane',
      refresh: 'the handler registry + the vendored app registry, both in the build',
      count: handlers.length,
    };
  },
};

/* ──────────────────────────────── assembly ──────────────────────────────── */

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

const FEEDS: Feed[] = [appsFeed, runtimeFeed, routesFeed, tablesFeed, activitiesFeed];

export async function assembleEstateModel(): Promise<EstateModel> {
  const nodes: EstateNode[] = [];
  const edges: EstateEdge[] = [];
  const findings: EstateFinding[] = [];
  const ledger: FeedStamp[] = [];

  for (const feed of FEEDS) {
    try {
      ledger.push(await feed.run({ nodes, edges, findings }));
    } catch (err) {
      // A feed that throws must still appear, with null rather than zero. Zero
      // is a claim about the estate; null is a claim about the reading.
      ledger.push({
        feed: feed.name,
        provenance: 'generated',
        describes: '(feed failed)',
        refresh: '—',
        count: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const blind = ledger.filter((l) => l.count === null);
  if (blind.length) {
    findings.push({
      kind: 'gap',
      severity: blind.some((b) => b.feed === 'routes') ? 'high' : 'low',
      title: `${blind.length} of ${ledger.length} feeds could not be read here`,
      detail: blind.map((b) => `${b.feed}: ${b.error ?? 'no reason given'}`).join(' · '),
    });
  }

  return { nodes, edges, findings, ledger, builtAt: new Date().toISOString() };
}
