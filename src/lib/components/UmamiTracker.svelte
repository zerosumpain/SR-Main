<script lang="ts">
  /**
   * Umami, configured for as much signal as it can give without collecting
   * anything that identifies a reader.
   *
   * Vendored VERBATIM (with `$lib/analytics/umami.ts`) into SR-Health and
   * SR-Drive: they pass `tag` and no `identity`, and pick up the label SR-Main
   * last stored in this origin's localStorage.
   *
   * What it turns on, beyond the bare pageview tag it replaced:
   *  - Web Vitals (`data-performance`): LCP, INP, CLS, FCP, TTFB per page.
   *  - `data-tag`: which application served the page (main / health / drive).
   *  - `data-domains`: a preview or local stack never writes into production.
   *  - `data-before-send`: capability tokens are redacted from every URL and
   *    referrer before they leave the browser (see `redactUrl`).
   *  - identify: signed-in sessions carry a role and a one-way id, so the
   *    owner's and family's use can be filtered rather than mistaken for
   *    readers. Anonymous readers are never identified.
   *  - Outbound-link, download and HTTP-error events.
   *  - Session replay, for anonymous visits to public pages only, inputs
   *    masked. Leaving the public allow-list blocks the rest of the page.
   *
   * The script is injected on mount rather than rendered in <svelte:head>: the
   * before-send hook must exist on `window` before the tracker reads it.
   */
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { page } from '$app/state';
  import {
    classifyLink,
    isReplayablePath,
    redactPayload,
    type AnalyticsIdentity,
    type UmamiPayload,
  } from '$lib/analytics/umami';

  let {
    tag,
    identity,
    replay = false,
  }: {
    /** Which application rendered the page. */
    tag: string;
    /** SR-Main passes what the server resolved (null = anonymous); an app
     *  that cannot resolve it leaves it undefined and reuses the stored one. */
    identity?: AnalyticsIdentity | null;
    /** Load the session recorder for anonymous visits to public pages. */
    replay?: boolean;
  } = $props();

  const siteId = env.PUBLIC_UMAMI_SITE_ID;
  const scriptUrl = env.PUBLIC_UMAMI_SCRIPT_URL;
  const domains = env.PUBLIC_UMAMI_DOMAINS || 'strangeramblings.com,www.strangeramblings.com';
  const IDENTITY_KEY = 'sr-analytics-identity';
  const BEFORE_SEND = '__srUmamiBeforeSend';
  const REPLAY_OFF = 'data-sr-replay-off';

  type Umami = {
    track: (name: string, data?: Record<string, unknown>) => void;
    identify: (id: string, data?: Record<string, unknown>) => void;
  };
  const umami = (): Umami | undefined => (window as unknown as { umami?: Umami }).umami;

  // Plain lets: written from listeners, never rendered.
  let recording = false;
  let lastErrorKey = '';

  function resolveIdentity(): AnalyticsIdentity | null {
    try {
      if (identity !== undefined) {
        if (identity) localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
        else localStorage.removeItem(IDENTITY_KEY);
        return identity;
      }
      const stored = localStorage.getItem(IDENTITY_KEY);
      return stored ? (JSON.parse(stored) as AnalyticsIdentity) : null;
    } catch {
      return identity ?? null;
    }
  }

  function inject(src: string, attrs: Record<string, string>, onload?: () => void) {
    const el = document.createElement('script');
    el.async = true;
    el.src = src;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (onload) el.addEventListener('load', onload, { once: true });
    document.head.appendChild(el);
  }

  function onClick(event: MouseEvent) {
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute('data-umami-event')) return;
    const hit = classifyLink(anchor.getAttribute('href') ?? '', location.hostname, anchor.hasAttribute('download'));
    if (hit) umami()?.track(hit.event, hit.data);
  }

  onMount(() => {
    if (!siteId || !scriptUrl) return;
    const who = resolveIdentity();

    (window as unknown as Record<string, unknown>)[BEFORE_SEND] = (_type: string, payload: UmamiPayload) =>
      redactPayload(payload);

    inject(
      scriptUrl,
      {
        'data-website-id': siteId,
        'data-tag': tag,
        'data-domains': domains,
        'data-performance': 'true',
        'data-before-send': BEFORE_SEND,
      },
      () => {
        if (who) umami()?.identify(who.id, { role: who.role, app: tag });
        trackErrorPage();
      },
    );

    if (replay && !who && isReplayablePath(location.pathname)) {
      recording = true;
      inject(scriptUrl.replace(/script\.js(\?.*)?$/, 'recorder.js'), {
        'data-website-id': siteId,
        'data-sample-rate': '1',
        'data-mask-level': 'moderate',
        'data-max-duration': String(15 * 60 * 1000),
        'data-block-selector': `[${REPLAY_OFF}], [data-analytics-private]`,
      });
    }

    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  });

  /** A 404 or 500 is a pageview Umami records as normal; this says it failed. */
  function trackErrorPage() {
    const status = page.status;
    if (status < 400) return;
    const key = `${status}|${page.url.pathname}`;
    if (key === lastErrorKey) return;
    lastErrorKey = key;
    umami()?.track('http-error', { status, path: redactPayload({ url: page.url.pathname }).url });
  }

  // Client-side navigation: keep the error event and the replay fence in step
  // with the page. Reads `page`, writes only DOM and plain lets.
  $effect(() => {
    const path = page.url.pathname;
    void page.status;
    if (typeof window === 'undefined') return;
    if (umami()) trackErrorPage();
    if (recording) document.body.toggleAttribute(REPLAY_OFF, !isReplayablePath(path));
  });
</script>
