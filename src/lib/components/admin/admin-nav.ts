// Single source of truth for the admin information architecture.
// The top-nav renders ADMIN_SECTIONS; each section's sub-nav renders its items.
// Route moves (see docs/plans/admin-consolidation.md) mean old /admin/* URLs are
// 308-redirected to their new homes via ADMIN_ROUTE_REDIRECTS (used in hooks.server.ts).

export type AdminNavItem = {
  label: string;
  href: string;
  /** Custom active test; defaults to exact-or-prefix on href. */
  match?: (path: string) => boolean;
};

export type AdminSection = {
  id: string;
  label: string;
  /** Section landing (its first child). */
  href: string;
  /** Is this section active for the given path? */
  match: (path: string) => boolean;
  /** Sub-nav entries (empty = no sub-nav strip). */
  items: AdminNavItem[];
};

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/admin',
    match: (p) => p === '/admin',
    items: [],
  },
  {
    id: 'content',
    label: 'Content',
    href: '/admin/content/blog',
    match: (p) => p.startsWith('/admin/content'),
    items: [
      { label: 'Blog', href: '/admin/content/blog' },
      { label: 'Responses', href: '/admin/content/comments' },
      { label: 'Hero', href: '/admin/content/hero' },
      { label: 'Voice', href: '/admin/content/voice' },
    ],
  },
  {
    id: 'connections',
    label: 'Connections',
    href: '/admin/connections',
    match: (p) => p.startsWith('/admin/connections'),
    items: [
      { label: 'Accounts', href: '/admin/connections' },
      { label: 'Health', href: '/admin/connections/health' },
      { label: 'Gmail', href: '/admin/connections/gmail' },
      { label: 'Scraper', href: '/admin/connections/scraper' },
      { label: 'Activity', href: '/admin/connections/catalog' },
      { label: 'Credentials', href: '/admin/connections/credentials' },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    href: '/admin/ai/keys',
    match: (p) => p.startsWith('/admin/ai'),
    items: [
      { label: 'Keys', href: '/admin/ai/keys' },
      { label: 'Models', href: '/admin/ai/models' },
      { label: 'Routing', href: '/admin/ai/model-routing' },
      { label: 'Tools', href: '/admin/ai/tools' },
      { label: 'API Registry', href: '/admin/ai/apis' },
      { label: 'Datastore', href: '/admin/ai/datastore' },
      { label: 'Improvement', href: '/admin/ai/improvement' },
      { label: 'Doctor', href: '/admin/ai/doctor' },
      { label: 'Approvals', href: '/admin/ai/approvals' },
    ],
  },
  {
    id: 'ops',
    label: 'Ops',
    // Landing moved off /admin/ops/agent when that page went: it read
    // agent_activity and agent_tasks, both of which have never held a row, so
    // every Ops click landed on three empty panels and a live pill over a
    // stream that had never delivered an event.
    href: '/admin/ops/live',
    match: (p) => p.startsWith('/admin/ops'),
    items: [
      { label: 'Run log', href: '/admin/ops/actions' },
      { label: 'Costs', href: '/admin/ops/costs' },
      { label: 'Tool usage', href: '/admin/ops/tool-usage' },
      { label: 'Live', href: '/admin/ops/live' },
    ],
  },
  {
    id: 'estate',
    // Renamed from "Estate" when /admin/ops/architecture folded in (2026-09-17).
    // The URL does NOT move: both of the repo's completed folds went INTO the
    // address that already had the history and the inbound links (/admin/files →
    // /drive, /admin/ops/releases → /releases), HostStatusStrip already points
    // here, and estate.test.ts asserts this path appears in its own inventory.
    // Minting /admin/architecture instead would have cost a second redirect and
    // left every in-repo link resolving through a 308.
    label: 'Architecture',
    href: '/admin/estate',
    match: (p) => p.startsWith('/admin/estate'),
    items: [],
  },
  {
    id: 'access',
    label: 'Access',
    href: '/admin/access',
    match: (p) => p.startsWith('/admin/access'),
    items: [
      { label: 'Allow-list', href: '/admin/access', match: (p) => p === '/admin/access' },
      { label: 'Devices', href: '/admin/access/devices' },
      { label: 'Security', href: '/admin/access/security' },
    ],
  },
];

/** The section owning a given path (non-overview matched first so /admin exact-only). */
export function activeSection(path: string): AdminSection | undefined {
  return (
    ADMIN_SECTIONS.find((s) => s.id !== 'overview' && s.match(path)) ??
    ADMIN_SECTIONS.find((s) => s.match(path))
  );
}

export function isSectionActive(section: AdminSection, path: string): boolean {
  return section.match(path);
}

export function isItemActive(item: AdminNavItem, path: string): boolean {
  if (item.match) return item.match(path);
  return path === item.href || path.startsWith(item.href + '/');
}

// Old → new page URLs. Longest keys are matched first in hooks.server.ts so that
// e.g. /admin/agent/config (→ ai/config) wins over /admin/agent (→ ops/agent).
export const ADMIN_ROUTE_REDIRECTS: Record<string, string> = {
  '/admin/blog': '/admin/content/blog',
  '/admin/hero': '/admin/content/hero',
  '/admin/health': '/admin/connections/health',
  '/admin/files': '/drive',
  '/admin/connections/files': '/drive',
  '/admin/gmail': '/admin/connections/gmail',
  '/admin/scraper': '/admin/connections/scraper',
  '/admin/integrations': '/admin/connections/credentials',
  '/admin/keys': '/admin/ai/keys',
  '/admin/models': '/admin/ai/models',
  '/admin/tools': '/admin/ai/tools',
  '/admin/jkai-approvals': '/admin/ai/approvals',
  // The assistant config page is gone (2026-09-17). It wrote agent_settings
  // 'system_prompt' and 'memory', and NOTHING in the codebase ever read either
  // key — a settings page for a setting that did not exist. The live jkai prompt
  // stack is assembled in $lib/jkai/prompt.ts and never consulted this table.
  // The two rows are left in place, and the table stays declared in schema.ts:
  // removing a declaration makes drizzle-kit want to DROP the table, and a drop
  // paired with any future CREATE is read as a rename, which needs a TTY that CI
  // does not have.
  '/admin/agent/config': '/admin/ai/keys',
  '/admin/ai/config': '/admin/ai/keys',
  '/admin/agent/actions': '/admin/ops/actions',
  '/admin/agent/costs': '/admin/ops/costs',
  // The agent console and its task board are gone (2026-09-17). They read
  // agent_tasks and agent_activity, and after the external-agent API under
  // /api/agent was deleted neither table had a writer left anywhere in the
  // codebase — both have held zero rows in production for their whole life.
  // These four keys point straight at Live rather than through the dead URLs,
  // so an old bookmark costs one 308 and not two.
  '/admin/agent/tasks': '/admin/ops/live',
  '/admin/agent': '/admin/ops/live',
  '/admin/ops/agent': '/admin/ops/live',
  '/admin/ops/tasks': '/admin/ops/live',
  '/admin/pulse': '/admin/ops/live',
  // The release console folded into /releases (2026-09-07), the same way the
  // admin files page folded into /drive: one page serving the owner the full
  // log and an anonymous reader the public record, rather than two pages two
  // redesigns apart at different addresses.
  '/admin/ops/releases': '/releases',
  // The changelog followed the release console into /releases (2026-09-17), the
  // fourth page to make this move after /health, /drive and the console itself.
  // Its session timeline and its grouping of related changes are band D there,
  // joined to releases on PULL-REQUEST NUMBER — the only key that survives the
  // data (branch is latched at session start so every session says 'master';
  // transcript SHAs are pre-squash and matched master 0 times in 105; the
  // Claude-Session trailer spans up to 107 commits).
  //
  // The ingest pipeline is untouched: the homeserv cron and the SessionEnd hook
  // still POST to /api/claude-changelog/ingest, which now also stores the PR
  // numbers the parser extracts.
  '/admin/ops/claude-changelog': '/releases',
  // The architecture map folded into /admin/estate, which is now labelled
  // Architecture. topology.ts — 107 hand-written lines describing 16 nodes, none
  // of them an extracted app, against a VPS running 30 containers — is gone; the
  // map draws the generated model instead.
  '/admin/ops/architecture': '/admin/estate',
  '/admin/deepdive': '/admin/ai/keys',
  '/admin/login': '/login?callbackUrl=/admin',
};

/** Resolve an old admin path to its new home, preserving any sub-path + query. Longest prefix wins. */
export function resolveAdminRedirect(pathname: string): string | null {
  const keys = Object.keys(ADMIN_ROUTE_REDIRECTS).sort((a, b) => b.length - a.length);
  for (const old of keys) {
    if (pathname === old) return ADMIN_ROUTE_REDIRECTS[old];
    if (pathname.startsWith(old + '/')) {
      return ADMIN_ROUTE_REDIRECTS[old] + pathname.slice(old.length);
    }
  }
  return null;
}
