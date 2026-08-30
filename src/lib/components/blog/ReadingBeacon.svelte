<script lang="ts">
  /**
   * First-party reading telemetry: dwell, scroll depth, completion.
   *
   * Why this exists at all, given Umami is already on /blog: Umami answers
   * pageviews, visitors and referrers well, and time-on-page only as a
   * site-wide average derived from the gap between two pageviews. A blog post
   * that is opened, read, and closed produces exactly one pageview, so its
   * dwell is either zero or missing. Dwell is the number that says whether a
   * piece was actually read, so it is measured here rather than approximated
   * there.
   *
   * What it does NOT collect, deliberately:
   *  - no identity. `sessionId` is a random id in sessionStorage. It identifies
   *    a READ, not a person: it does not survive a browser restart, it is never
   *    joined to anything, and there is no logged-in reader identity on /blog
   *    to join it to.
   *  - no full referrer. Only the host. A full referrer URL carries search
   *    terms and path-embedded identifiers.
   *  - no owner views. The author reading their own post is not a reader.
   *
   * Only VISIBLE time accumulates. A post left open in a background tab
   * overnight would otherwise report a fourteen-hour read and poison every
   * average the admin panel computes.
   *
   * Every handle here is a plain `let`. `flush()` and `accumulate()` both read
   * and write them and are called from event listeners — the exact shape that
   * loops an effect if the values are made reactive. Nothing in this component
   * renders, so none of it needs to be.
   */
  import { onMount } from 'svelte';

  let {
    slug,
    articleEl,
    enabled = true,
  }: {
    /** The post slug. The SERVER resolves it to an id and checks it is
     *  published — the client is never trusted with a post id, so a beacon
     *  cannot be aimed at a draft. */
    slug: string;
    /** The article body, used for scroll depth and the completion test. */
    articleEl?: HTMLElement | null;
    /** False for owner and preview views. */
    enabled?: boolean;
  } = $props();

  const endpoint = $derived(`/blog/${encodeURIComponent(slug)}/track`);
  const SESSION_KEY = 'sr-read-session';
  /** Below this a "read" is a bounce and not worth a row. */
  const MIN_DWELL_MS = 1500;

  let sessionId = '';
  let dwellMs = 0;
  let maxScrollPct = 0;
  let completed = false;
  let visibleSince: number | null = null;
  let lastSentDwell = -1;
  let frame: number | null = null;
  let observer: IntersectionObserver | null = null;

  function newSessionId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function readSessionId(): string {
    try {
      const existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      const fresh = newSessionId();
      sessionStorage.setItem(SESSION_KEY, fresh);
      return fresh;
    } catch {
      // Private window or storage disabled: still measure, just never
      // de-duplicate across pages in this visit.
      return newSessionId();
    }
  }

  function deviceClass(): 'mobile' | 'tablet' | 'desktop' {
    const w = window.innerWidth;
    if (w < 640) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function referrerHost(): string | null {
    try {
      if (!document.referrer) return null;
      const host = new URL(document.referrer).hostname;
      // Internal navigation is not a referrer worth reporting.
      if (host === location.hostname) return null;
      return host.slice(0, 120);
    } catch {
      return null;
    }
  }

  /** Fold the currently-open visible window into the running total. */
  function accumulate() {
    if (visibleSince === null) return;
    dwellMs += Date.now() - visibleSince;
    visibleSince = Date.now();
  }

  function measureScroll() {
    frame = null;
    const el = articleEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = Math.max(1, rect.height);
    const seen = Math.min(Math.max(window.innerHeight - rect.top, 0), total);
    const pct = Math.round((seen / total) * 100);
    if (pct > maxScrollPct) maxScrollPct = Math.min(pct, 100);
  }

  function onScroll() {
    if (frame !== null) return;
    frame = requestAnimationFrame(measureScroll);
  }

  function flush(final: boolean) {
    if (!enabled) return;
    accumulate();
    if (dwellMs < MIN_DWELL_MS) return;
    // Nothing has changed since the last beacon — a tab toggled twice should
    // not cost two writes.
    if (!final && dwellMs === lastSentDwell) return;
    lastSentDwell = dwellMs;

    const body = JSON.stringify({
      sessionId,
      dwellMs: Math.min(dwellMs, 4 * 60 * 60 * 1000),
      maxScrollPct,
      completed,
      referrerHost: referrerHost(),
      deviceClass: deviceClass(),
    });

    try {
      const blob = new Blob([body], { type: 'application/json' });
      if (!navigator.sendBeacon?.(endpoint, blob)) {
        void fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Telemetry must never break the page it is measuring.
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      flush(false);
      accumulate();
      visibleSince = null;
    } else {
      visibleSince = Date.now();
    }
  }

  onMount(() => {
    if (!enabled) return;

    sessionId = readSessionId();
    visibleSince = document.visibilityState === 'visible' ? Date.now() : null;

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    // `pagehide` rather than `unload`: `unload` is ignored by the back/forward
    // cache and never fires on mobile Safari, which is most of the reads that
    // matter here.
    const onHide = () => flush(true);
    window.addEventListener('pagehide', onHide);

    if (articleEl) {
      // A sentinel at the end of the body: once it has been on screen the
      // reader reached the end. Cheaper and more honest than inferring
      // completion from a scroll percentage, which a long comment thread or a
      // tall footer would otherwise satisfy on its own.
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              completed = true;
              observer?.disconnect();
              observer = null;
            }
          }
        },
        { rootMargin: '0px 0px -15% 0px', threshold: 0 },
      );
      const sentinel = articleEl.querySelector('[data-article-end]');
      if (sentinel) observer.observe(sentinel);
    }

    measureScroll();

    return () => {
      flush(true);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      observer?.disconnect();
      observer = null;
    };
  });
</script>
