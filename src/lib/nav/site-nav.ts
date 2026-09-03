/**
 * Single source of truth for the site's top navigation.
 *
 * Modelled on `$lib/components/admin/admin-nav.ts`, which solved this for
 * /admin and is the only nav in the repo that was ever coherent. The site had
 * five other dialects — `.site-nav-bar`, HealthShell, HubHeader, the field
 * study mastheads, and ~65 pages with no chrome at all — each with its own idea
 * of what "up" meant. This file is the one place that answers, for any path:
 *
 *   which section am I in · what are its siblings · what is my parent
 *   · may an anonymous visitor see this · does this route wear chrome at all
 *
 * It is PURE and has no Svelte imports, so it is unit-testable and safe to
 * import from a `+layout.server.ts`. `SiteHeader.svelte` is its only renderer.
 *
 * Two hard rules, both learned from the survey that produced this file:
 *
 *  1. NOTHING here may be derived from the route tree or from
 *     `.github/public-routes.txt`. `/projects` is a public PREFIX, so
 *     `/projects/landgrab` and `/projects/family-life360-history` are
 *     anonymously reachable at the routing layer and gated only inside their
 *     own loads. Both are deliberately absent from every index. A generated nav
 *     resurrects them as visible destinations on a page share-token holders
 *     reach.
 *  2. `ownerOnly` must be derived from BOTH `$lib/auth.ts` PUBLIC_PATHS and
 *     `$lib/server/gate-bypasses.ts` HOOK_EXACT_BYPASSES. `/health` is public
 *     as an exact match only; every `/health/*` child is owner-gated.
 */

export type NavItem = {
  label: string;
  href: string;
  /** Hidden from signed-out visitors. Every cell they see must be reachable. */
  ownerOnly?: boolean;
  /** Custom active test; defaults to exact-or-prefix on href. */
  match?: (path: string) => boolean;
};

export type NavSection = {
  id: string;
  /** The name that sits in the header's section cell. */
  label: string;
  /** Where the section cell — and every child's back link — points. */
  rootHref: string;
  match: (path: string) => boolean;
  /** Sub-nav cells. Empty = the section renders no second strip. */
  items: NavItem[];
  ownerOnly?: boolean;
  /**
   * The family ABOVE this one, for sections that are themselves a sub-section.
   * `/jkai/intel` is a section in its own right (ten surfaces of its own) but
   * its way out is `/jkai`, not the home icon. Omitted on a top-level section,
   * where the home icon IS the answer and a second back cell is noise.
   */
  parent?: string;
};

/** Prefix helper — exact match, or a genuine path segment beneath it. */
function under(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

/**
 * Routes that deliberately wear no shared header, each with the reason it
 * cannot. Checked by `wearsSharedChrome()`; a route added here must carry a
 * comment saying WHY, because the default is that every page gets the bar.
 */
export const CHROME_EXCLUSIONS: { prefix: string; exact?: boolean; why: string }[] = [
  {
    prefix: '/jkai/run',
    why: 'A `+page@.svelte` that resets to the ROOT layout on purpose — an 820px utility window beside the chat. It is the one route that exists to have no chrome.',
  },
  {
    prefix: '/capture',
    why: 'A separate installable PWA with its own service worker and manifest, on a Tailwind gray shell rather than SR tokens. A site strip would be SW-cached and advertise routes unreachable offline.',
  },
  {
    prefix: '/projects/broads-pilot',
    why: 'A third PWA: display=standalone, scope=/projects/broads-pilot. A link to / navigates outside the manifest scope, which in a standalone launch strands the user in an in-app browser with no back button.',
  },
  {
    prefix: '/login',
    why: 'The auth gate’s own destination. Every owner-only cell on it bounces straight back here.',
  },
  { prefix: '/auth-error', why: 'The auth gate’s failure page — same reason as /login.' },
  {
    prefix: '/broads/speed',
    why: 'Opened from a WhatsApp link by people with no session and no /broads index to be a child of. Full-bleed Leaflet map.',
  },
  {
    prefix: '/deepdive/share',
    why: 'A full-viewport research desk — `position: fixed; inset: 0` declared on both the host and ResearchDesk’s own shell — already wearing CommandBar.',
  },
];

/*
 * `/jkai/shared/[token]` used to be carved out here: it is the one anonymous
 * surface under /jkai, and it inherited the hub masthead, which showed whoever
 * held the share link the day's token spend, the OpenRouter credit balance and
 * the Codex quota. That is fixed at the source instead — the page is now a
 * `+page@.svelte` that resets to the root layout, the way /jkai/run does — so
 * it wears the ordinary bar like everything else.
 */

/** Suffix-matched carve-outs: full-viewport players and machine-read exports. */
const EXCLUDED_SUFFIXES = [
  '/print', // headless-browser PDF + OG poster target; anything above the slides lands in the export
  '/desk', // research desk — fixed inset:0, already wears CommandBar
];

/**
 * Deck player: `/decks/<slug>` exactly. DeckShell is `position: fixed; inset: 0`
 * and scales a 1280x720 stage off its measured host, so a 48px bar changes the
 * rendered slide scale. `/decks` and `/decks/<slug>/edit` DO wear the bar.
 */
function isDeckPlayer(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return parts.length === 2 && parts[0] === 'decks';
}

export function wearsSharedChrome(path: string): boolean {
  if (isDeckPlayer(path)) return false;
  if (EXCLUDED_SUFFIXES.some((s) => path.endsWith(s))) return false;
  return !CHROME_EXCLUSIONS.some((x) => (x.exact ? path === x.prefix : under(x.prefix, path)));
}

/**
 * The site strip — the destinations on offer from any page that is not inside a
 * section of its own. Home is NOT here: it is the icon cell, and offering it
 * twice was the old strip's tell.
 */
export const SITE_ITEMS: NavItem[] = [
  { label: 'Projects', href: '/projects' },
  { label: 'Writing', href: '/blog' },
  { label: 'Decks', href: '/decks' },
  { label: 'Health', href: '/health' },
  { label: 'Shipped', href: '/releases' },
  // Owner-only from here. These used to render for everyone, so a signed-out
  // reader was offered four destinations that each 302 back to /login.
  { label: 'News', href: '/news', ownerOnly: true },
  { label: 'Research', href: '/research', ownerOnly: true },
  { label: 'Drive', href: '/drive', ownerOnly: true },
  { label: 'Live', href: '/live', ownerOnly: true },
  { label: 'jkai', href: '/jkai', ownerOnly: true },
];

/**
 * The sections. Order matters only for `activeSection`, which takes the first
 * match — so the deepest prefixes are declared first.
 */
export const SECTIONS: NavSection[] = [
  {
    id: 'jkai-intel',
    parent: '/jkai',
    label: 'Intel',
    rootHref: '/jkai/intel',
    ownerOnly: true,
    match: (p) => under('/jkai/intel', p),
    items: [
      { label: 'Mail', href: '/jkai/intel/mail' },
      { label: 'Review', href: '/jkai/intel/review' },
      { label: 'Quality', href: '/jkai/intel/quality' },
      { label: 'Entities', href: '/jkai/intel/entities' },
      { label: 'Clusters', href: '/jkai/intel/clusters' },
      { label: 'Dossiers', href: '/jkai/intel/dossiers' },
      { label: 'Timeline', href: '/jkai/intel/timeline' },
      { label: 'Notes', href: '/jkai/intel/notes' },
      { label: 'Search', href: '/jkai/intel/search' },
      { label: 'Alerts', href: '/jkai/intel/alerts' },
    ],
  },
  {
    id: 'jkai-codegraph',
    parent: '/jkai',
    label: 'Codegraph',
    rootHref: '/jkai/codegraph',
    ownerOnly: true,
    match: (p) => under('/jkai/codegraph', p),
    items: [
      { label: 'Ask', href: '/jkai/codegraph/ask' },
      { label: 'Review', href: '/jkai/codegraph/review' },
      { label: 'Relevance', href: '/jkai/codegraph/relevance' },
      { label: 'Serves', href: '/jkai/codegraph/serves' },
    ],
  },
  {
    id: 'jkai-daydreams',
    parent: '/jkai',
    label: 'Daydreams',
    // The family prefix, not the feed. `/jkai/daydreams` 307s to the feed via
    // legacyTabTarget, so the cell still lands on the feed — but every child's
    // back link now walks UP into it instead of sideways onto a sibling, which
    // is what "back" has to mean if it is going to mean anything.
    rootHref: '/jkai/daydreams',
    ownerOnly: true,
    match: (p) => under('/jkai/daydreams', p),
    items: [
      { label: 'Feed', href: '/jkai/daydreams/feed' },
      { label: 'Briefing', href: '/jkai/daydreams/briefing' },
      { label: 'Discoveries', href: '/jkai/daydreams/discoveries' },
      { label: 'Watches', href: '/jkai/daydreams/watches' },
      { label: 'Memory', href: '/jkai/daydreams/memory' },
      { label: 'Engine', href: '/jkai/daydreams/engine' },
      { label: 'Calendar', href: '/jkai/daydreams/calendar' },
      { label: 'Places', href: '/jkai/daydreams/places' },
      { label: 'Money', href: '/jkai/daydreams/money' },
      { label: 'Family', href: '/jkai/daydreams/family' },
      { label: 'Improvement', href: '/jkai/daydreams/improvement' },
    ],
  },
  {
    id: 'jkai',
    label: 'jkai',
    rootHref: '/jkai',
    ownerOnly: true,
    match: (p) => under('/jkai', p),
    items: [
      { label: 'Chat', href: '/jkai', match: (p) => p === '/jkai' },
      { label: 'Canvas', href: '/jkai/canvas' },
      { label: 'Intel', href: '/jkai/intel' },
      { label: 'Codegraph', href: '/jkai/codegraph' },
      { label: 'Builds', href: '/jkai/builds' },
      { label: 'Daydreams', href: '/jkai/daydreams' },
      { label: 'Notes', href: '/jkai/notes' },
      { label: 'Agent team', href: '/jkai/agents' },
      { label: 'Doctor', href: '/jkai/doctor' },
    ],
  },
  {
    id: 'health',
    label: 'Health',
    rootHref: '/health',
    match: (p) => under('/health', p),
    items: [
      // The hub itself is the only anonymous page in the family — `/health` is
      // an EXACT bypass, never a prefix. Every child below is owner-gated.
      { label: 'Dashboard', href: '/health', match: (p) => p === '/health' },
      { label: 'Activities', href: '/health/activities', ownerOnly: true },
      { label: 'Segments', href: '/health/segments', ownerOnly: true },
      { label: 'Routes', href: '/health/routes', ownerOnly: true },
      { label: 'Plan', href: '/health/plan', ownerOnly: true },
      { label: 'Record', href: '/health/record', ownerOnly: true },
    ],
  },
  {
    id: 'news',
    label: 'News',
    rootHref: '/news',
    ownerOnly: true,
    match: (p) => under('/news', p),
    items: [],
  },
  {
    id: 'research',
    label: 'Research',
    rootHref: '/research',
    ownerOnly: true,
    // `/jkai/research` 308s here (it was consolidated into the single /research
    // family in v3), and the brief names this exact journey: research goes back
    // to jkai. The URL moved; where it belongs did not.
    parent: '/jkai',
    match: (p) => under('/research', p) || under('/deepdive', p),
    items: [],
  },
  {
    id: 'blog',
    label: 'Writing',
    rootHref: '/blog',
    match: (p) => under('/blog', p),
    items: [],
  },
  {
    id: 'decks',
    label: 'Decks',
    rootHref: '/decks',
    match: (p) => under('/decks', p),
    items: [],
  },
  {
    id: 'drive',
    label: 'Drive',
    rootHref: '/drive',
    ownerOnly: true,
    match: (p) => under('/drive', p),
    items: [],
  },
  {
    id: 'heart',
    label: 'Heart',
    rootHref: '/heart',
    match: (p) => under('/heart', p),
    items: [],
  },
  {
    id: 'releases',
    label: 'Shipped',
    rootHref: '/releases',
    match: (p) => under('/releases', p),
    items: [],
  },
  {
    id: 'live',
    label: 'Live',
    rootHref: '/live',
    ownerOnly: true,
    match: (p) => under('/live', p),
    items: [],
  },
  {
    id: 'projects',
    label: 'Projects',
    rootHref: '/projects',
    match: (p) => under('/projects', p),
    items: [],
  },
];

/**
 * Path segments that namespace their children without being a page themselves.
 *
 * `/admin/ops/costs` sits under `/admin/ops`, and there is no `+page` there —
 * only a directory. Walking one level up from a leaf therefore lands on a 404
 * for twenty routes across /admin, /blog, /jkai and /news. A back link that
 * 404s is worse than no back link, so `parentHref` skips these and keeps
 * walking. Every entry here is verified against the real route tree by
 * `tests/lib/nav/nav-parents.test.ts` — if a grouping directory ever gains a
 * page, that test fails and the entry comes out.
 */
const GROUPING_SEGMENTS: (string | RegExp)[] = [
  '/admin/ai',
  '/admin/content',
  '/admin/ops',
  '/admin/connections/whatsapp',
  '/blog/preview',
  '/blog/tag',
  '/jkai/shared',
  '/jkai/trace',
  // /news/<source> is a namespace for article ids, never a page of its own.
  /^\/news\/[^/]+$/,
];

function isGrouping(path: string): boolean {
  return GROUPING_SEGMENTS.some((g) => (typeof g === 'string' ? g === path : g.test(path)));
}

/**
 * A parent you cannot leave is not a parent.
 *
 * `/decks/<slug>/edit` sits one level under the deck PLAYER, which is carved
 * out of shared chrome — a full-viewport `position: fixed; inset: 0` stage with
 * no bar on it. Walking "up" into it strands the reader with nothing but the
 * browser's own back button. So a step that lands on a chrome-less route is
 * skipped, the same as a grouping directory: both are places the bar cannot
 * follow you to.
 */
function isDeadEnd(path: string): boolean {
  return isGrouping(path) || !wearsSharedChrome(path);
}

export function activeSection(path: string): NavSection | undefined {
  return SECTIONS.find((s) => s.match(path));
}

export function isItemActive(item: NavItem, path: string): boolean {
  if (item.match) return item.match(path);
  return under(item.href, path);
}

/** Drop owner-only cells for a signed-out visitor. */
export function visibleItems(items: NavItem[], isOwner: boolean): NavItem[] {
  return isOwner ? items : items.filter((i) => !i.ownerOnly);
}

/**
 * An owner-only SECTION hides its whole item list.
 *
 * `visibleItems` filters per item, and the jkai section's nine items carry no
 * flag of their own because the section above them does — so filtering only by
 * item returned all nine to an anonymous visitor. That is reachable today from
 * `/jkai/shared/<token>`, the one public surface under /jkai, and would offer a
 * share-link recipient nine cells that each bounce off the auth gate.
 */
function sectionItems(section: NavSection, isOwner: boolean): NavItem[] {
  if (section.ownerOnly && !isOwner) return [];
  return visibleItems(section.items, isOwner);
}

/**
 * The sub-nav strip for a path: its section's siblings, owner-filtered. Empty
 * when the section has no children, which is what keeps a second strip off the
 * pages that would only ever show one cell.
 */
export function subnavFor(path: string, isOwner = true): NavItem[] {
  const section = activeSection(path);
  if (!section) return [];
  return sectionItems(section, isOwner);
}

/**
 * What the bar actually shows.
 *
 * A section with children of its own shows them — that is the sub-page strip
 * John pointed at on /jkai and /health. A section without children (or no
 * section at all, i.e. the landing page) shows the SITE strip instead, which is
 * the nav the main page has always had. Without this fallback the header
 * rendered an empty band on `/`, `/blog`, `/projects`, `/decks` and
 * `/releases` — every top-level page on the site.
 */
export function navCellsFor(path: string, isOwner = true): NavItem[] {
  const own = subnavFor(path, isOwner);
  if (own.length) return own;
  return visibleItems(SITE_ITEMS, isOwner);
}

/**
 * The "common way back": one level up, never home.
 *
 * `/jkai/research` → `/jkai`, `/jkai/intel/notes/new` → `/jkai/intel/notes`,
 * `/blog/some-post` → `/blog`. Returns null on a section root and on `/`,
 * where the home icon is already the answer and a second one would be noise.
 *
 * Deliberately computed from the PATH, not from a table of every route: a table
 * of 200 parents is a table that goes stale. The section's `rootHref` is the
 * floor, so a path can never walk out of its own family.
 */
export function parentHref(path: string): string | null {
  if (path === '/' || path === '') return null;
  const section = activeSection(path);
  const clean = path.replace(/\/+$/, '');

  if (section) {
    if (clean === section.rootHref) return section.parent ?? null;
    let parent = clean.slice(0, clean.lastIndexOf('/')) || '/';
    // Step over namespace directories — /admin/ops/costs must reach /admin,
    // not the /admin/ops that has no page behind it.
    while (isDeadEnd(parent) && under(section.rootHref, parent) && parent !== section.rootHref) {
      parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
    }
    if (isDeadEnd(parent) || !under(section.rootHref, parent)) return section.rootHref;
    return parent === clean ? section.rootHref : parent;
  }

  let parent = clean.slice(0, clean.lastIndexOf('/')) || '/';
  while (isDeadEnd(parent) && parent !== '/') {
    parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
  }
  return parent === clean ? null : parent;
}

/** The label for the back cell — the parent's own section or last segment. */
export function parentLabel(path: string): string | null {
  const href = parentHref(path);
  if (!href) return null;
  if (href === '/') return 'Home';
  const section = SECTIONS.find((s) => s.rootHref === href);
  if (section) return section.label;
  const item = SECTIONS.flatMap((s) => s.items).find((i) => i.href === href);
  if (item) return item.label;
  const last = href.slice(href.lastIndexOf('/') + 1);
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
}
