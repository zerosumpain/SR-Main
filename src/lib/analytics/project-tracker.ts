/**
 * The tracker for project applications (Spine, Local Plan Navigator, the
 * supply-chain monitor …), served at `/sr-analytics.js` and injected into their
 * pages by the SR-Infra gateway, which is the one place that sees every one of
 * them and knows which share link opened a page. The apps carry no analytics
 * code of their own.
 *
 * The gateway's tag says, as data attributes:
 *   data-app        the application              data-project  the project key
 *   data-access     share | public | owner       data-pack     the link's audience pack
 *   data-share-ref  first 8 of the link's row id data-share-label  the owner's label
 *   data-visitor    8 hex of the gateway's per-browser visitor id (share only)
 *   data-record     1 = replay + heatmaps (share and public visits; never the owner)
 *   data-alias      1 = served on an alias host (data-spine.com …)
 *
 * What it does with them:
 *   - removes `?t=` from the address bar first (the gateway has already set
 *     the project's share cookie, so a reload still works), so the token
 *     reaches neither Umami's URLs nor a replay's recorded page address;
 *   - redacts every URL it sends (`makeAnalyticsHelpers`, shared with the
 *     site's own tracker);
 *   - tags the visit `project:<key>`, and a share visit with the link
 *     ("DfE team · 3f9a2c1b") as its distinct id and session properties, so
 *     every visit through one link, from one browser, is one Umami visitor;
 *   - `share-open` once per page load, `engaged` after 30 s of visible time on
 *     a page, outbound-link and download events: the funnel steps;
 *   - session replay and heatmaps when `data-record` says so, inputs masked.
 *
 * `runProjectTracker` is serialised with `toString()`, so like the helpers it
 * may reference nothing outside itself.
 */
import type { LinkClick, UmamiPayload } from './umami';
import { makeAnalyticsHelpers } from './umami';

export type ProjectTrackerConfig = {
  siteId: string;
  scriptUrl: string;
  domains: string;
};

type Helpers = ReturnType<typeof makeAnalyticsHelpers>;

export function runProjectTracker(H: Helpers, CFG: ProjectTrackerConfig): void {
  const me = document.currentScript;
  if (!me || !CFG.siteId || !CFG.scriptUrl) return;
  const attr = (k: string) => me.getAttribute(`data-${k}`) || null;
  const access = attr('access');
  const project = attr('project') || attr('app') || 'project';
  const ref = attr('share-ref');
  const label = attr('share-label');
  const pack = attr('pack');
  const visitor = attr('visitor');
  const record = attr('record') === '1';
  const domains = attr('alias') === '1' ? `${CFG.domains},${location.hostname}` : CFG.domains;
  const link = ref ? (label ? `${label} · ${ref}` : ref) : null;
  const distinct =
    access === 'owner' ? 'owner' : access === 'share' && ref ? `link-${ref}${visitor ? `-${visitor}` : ''}` : null;

  type Umami = { track: (n: string, d?: Record<string, unknown>) => void; identify: (id: string, d?: Record<string, unknown>) => void };
  const umami = () => (window as unknown as { umami?: Umami }).umami;
  const w = window as unknown as Record<string, unknown>;
  if (w.__srProjectTracker) return;
  w.__srProjectTracker = true;

  // 1. The token never outlives the page that redeemed it.
  if (access === 'share') {
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('t')) {
        u.searchParams.delete('t');
        history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`);
      }
    } catch {
      /* an unparseable address is left alone */
    }
  }

  w.__srUmamiBeforeSend = (_type: string, payload: UmamiPayload) => H.redactPayload(payload);
  const common: Record<string, unknown> = { project, ...(link ? { link } : {}), ...(pack ? { pack } : {}) };

  function inject(src: string, attrs: Record<string, string>, onload?: () => void) {
    const el = document.createElement('script');
    el.async = true;
    el.src = src;
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
    if (onload) el.addEventListener('load', onload, { once: true });
    document.head.appendChild(el);
  }

  const tag: Record<string, string> = {
    'data-website-id': CFG.siteId,
    'data-tag': `project:${project}`,
    'data-domains': domains,
    'data-performance': 'true',
    'data-before-send': '__srUmamiBeforeSend',
  };
  if (distinct) tag['data-distinct-id'] = distinct;
  inject(CFG.scriptUrl, tag, () => {
    const u = umami();
    if (!u) return;
    if (distinct) u.identify(distinct, { access, ...common });
    if (access === 'share') u.track('share-open', { ...common, path: location.pathname });
  });

  if (record) {
    inject(CFG.scriptUrl.replace(/script\.js(\?.*)?$/, 'recorder.js'), { 'data-website-id': CFG.siteId });
  }

  document.addEventListener(
    'click',
    (event) => {
      const a = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('data-umami-event')) return;
      const hit: LinkClick | null = H.classifyLink(a.getAttribute('href') ?? '', location.hostname, a.hasAttribute('download'));
      if (hit) umami()?.track(hit.event, { ...hit.data, ...common });
    },
    { capture: true },
  );

  // `engaged`: 30 s of VISIBLE time on one page, once per path. A tab left in
  // the background is not reading.
  const engagedPaths = new Set<string>();
  let path = location.pathname;
  let visibleMs = 0;
  let since = document.visibilityState === 'visible' ? Date.now() : 0;
  setInterval(() => {
    if (location.pathname !== path) {
      path = location.pathname;
      visibleMs = 0;
      since = document.visibilityState === 'visible' ? Date.now() : 0;
    }
    if (since) {
      visibleMs += Date.now() - since;
      since = Date.now();
    }
    if (visibleMs >= 30_000 && !engagedPaths.has(path)) {
      engagedPaths.add(path);
      umami()?.track('engaged', { ...common, path });
    }
  }, 2000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') since = Date.now();
    else {
      if (since) visibleMs += Date.now() - since;
      since = 0;
    }
  });
}

/** The script body: both functions serialised, run with this host's config. */
export function projectTrackerScript(cfg: ProjectTrackerConfig): string {
  return `/* Strange Ramblings project analytics. See SR-Main src/lib/analytics/project-tracker.ts */
(function () {
  var H = (${makeAnalyticsHelpers.toString()})();
  (${runProjectTracker.toString()})(H, ${JSON.stringify(cfg)});
})();
`;
}
