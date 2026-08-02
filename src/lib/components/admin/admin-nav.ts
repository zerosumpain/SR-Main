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
      { label: 'Hero', href: '/admin/content/hero' },
      { label: 'Effects', href: '/admin/content/effects' },
    ],
  },
  {
    id: 'connections',
    label: 'Connections',
    href: '/admin/connections/health',
    match: (p) => p.startsWith('/admin/connections'),
    items: [
      { label: 'Health', href: '/admin/connections/health' },
      { label: 'Gmail', href: '/admin/connections/gmail' },
      { label: 'Scraper', href: '/admin/connections/scraper' },
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
      { label: 'Config', href: '/admin/ai/config' },
    ],
  },
  {
    id: 'ops',
    label: 'Ops',
    href: '/admin/ops/agent',
    match: (p) => p.startsWith('/admin/ops'),
    items: [
      { label: 'Agent', href: '/admin/ops/agent', match: (p) => p === '/admin/ops/agent' },
      { label: 'Tasks', href: '/admin/ops/tasks' },
      { label: 'Actions', href: '/admin/ops/actions' },
      { label: 'Costs', href: '/admin/ops/costs' },
      { label: 'Engine', href: '/admin/ops/engine', match: (p) => p === '/admin/ops/engine' },
      { label: 'Tool usage', href: '/admin/ops/tool-usage' },
      { label: 'Sessions', href: '/admin/ops/sessions' },
      { label: 'Cron', href: '/admin/ops/cron' },
      { label: 'Live', href: '/admin/ops/live' },
      { label: 'Architecture', href: '/admin/ops/architecture' },
      { label: 'Releases', href: '/admin/ops/releases' },
      { label: 'Changelog', href: '/admin/ops/claude-changelog' },
    ],
  },
  {
    id: 'access',
    label: 'Access',
    href: '/admin/access',
    match: (p) => p.startsWith('/admin/access'),
    items: [],
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
  '/admin/biome': '/admin/content/effects',
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
  '/admin/agent/config': '/admin/ai/config',
  '/admin/agent/tasks': '/admin/ops/tasks',
  '/admin/agent/actions': '/admin/ops/actions',
  '/admin/agent/costs': '/admin/ops/costs',
  '/admin/agent': '/admin/ops/agent',
  '/admin/hermes/cron': '/admin/ops/cron',
  '/admin/hermes/sessions': '/admin/ops/sessions',
  '/admin/hermes': '/admin/ops/engine',
  '/admin/pulse': '/admin/ops/live',
  '/admin/deepdive': '/admin/ai/keys',
  '/admin/scheduled': '/admin/ops/cron',
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
