<script lang="ts">
  import { page } from '$app/state';
  import { getContext } from 'svelte';
  import { ADMIN_SECTIONS, activeSection, isSectionActive } from './admin-nav';

  const adminToken = getContext<string>('adminToken');

  function tokenHref(href: string): string {
    if (!adminToken) return href;
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}token=${adminToken}`;
  }

  const path = $derived(page.url.pathname);

  /**
   * The way back, one level up.
   *
   * Admin answers this from its OWN manifest rather than from
   * `$lib/nav/site-nav`'s `parentHref()`. Not because that function 404s —
   * checked, it does not: `SECTIONS` has no /admin entry so it falls through to
   * generic path-walking, but its `GROUPING_SEGMENTS` already lists
   * `/admin/ai`, `/admin/content` and `/admin/ops`, so `/admin/ops/costs`
   * correctly reaches `/admin`. Two other answers are the reason:
   *
   *  * `parentHref('/admin')` is `/` — which is exactly what the home icon two
   *    cells to the left already is. Here that case has no back cell at all.
   *  * `parentHref` sends `/admin/access/security` to `/admin/access` and
   *    `/admin/connections/gmail` to `/admin/connections`. Both targets are
   *    entries in the SAME sub-nav strip sitting directly under this bar — a
   *    sideways move dressed up as an up-move. `admin-nav.ts` is the only file
   *    that knows which paths are in that strip, so it has to decide.
   *
   * THE RULE: every ADMIN_SECTIONS entry's `href` IS its own first sub-nav
   * item, and the sections strip is permanently on screen. So a page that
   * appears in either strip has one honest parent, `/admin`. Only a page BELOW
   * the sub-nav — a post editor, a datastore collection, the WhatsApp pairing
   * page — walks up to the strip entry that owns it.
   */
  const back = $derived.by((): { href: string; label: string } | null => {
    const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
    if (clean === '/admin') return null;

    const section = activeSection(clean);
    if (section) {
      const inStrip = clean === section.href || section.items.some((i) => i.href === clean);
      if (!inStrip) {
        // Deepest strip entry that genuinely owns this path.
        const owner = [section.href, ...section.items.map((i) => i.href)]
          .filter((h) => clean.startsWith(h + '/'))
          .sort((a, b) => b.length - a.length)[0];
        if (owner) {
          const label = section.items.find((i) => i.href === owner)?.label ?? section.label;
          return { href: owner, label };
        }
      }
    }

    return { href: '/admin', label: 'Admin' };
  });
</script>

<header class="site-nav-bar admin-top-nav">
  <!-- Top-left on every page, sitewide. NOT token-threaded: it leaves admin for
       the public site, where a ?token= is meaningless and would only follow the
       reader around. -->
  <a href="/" class="admin-home" aria-label="Home" title="Home">
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <path
        d="M2 7.2 8 2.2l6 5M3.4 6v7.3h9.2V6"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="square"
        stroke-linejoin="miter"
      />
    </svg>
  </a>

  {#if back}
    <a class="admin-back" href={tokenHref(back.href)} title="Back to {back.label}">
      <span class="back-arrow" aria-hidden="true">←</span>
      <span class="back-word">{back.label}</span>
    </a>
  {/if}

  <a
    href={tokenHref('/admin')}
    class="brand admin-wordmark"
    aria-label="Strange Ramblings admin — dashboard"
  >
    <span class="wordmark-text">strange ramblings</span><span class="admin-tag">admin</span>
  </a>

  <nav class="admin-sections" aria-label="Admin sections">
    {#each ADMIN_SECTIONS as s, i (s.id)}
      <a
        href={tokenHref(s.href)}
        class="nav-link"
        data-index={String(i + 1).padStart(2, '0')}
        aria-current={isSectionActive(s, page.url.pathname) ? 'page' : undefined}
      >
        {s.label}
      </a>
    {/each}
  </nav>

  <a href="/" class="view-site" aria-label="Back to main site">
    View site
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2.5 7.5L7.5 2.5M7.5 2.5H3.5M7.5 2.5V6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="square" />
    </svg>
  </a>
</header>

<style>
  /* Admin wears the same cell strip as the site nav: each section is a cell of
     one grid, divided by hairlines, and the current one is cut out with an
     accent seam. Cells own their own padding — .site-nav-bar has none.
     That strip is INK now, so every paper token here is relit the same way
     SiteNav and PageHeader were. */

  /* The first two cells are the ones SiteHeader.svelte carries sitewide: the
     home icon, then the way back. Same shape, same padding rhythm, same
     cream-alpha hairline as every other cell on the ink band. */
  .admin-home,
  .admin-back {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    border-right: 1px solid rgba(237, 228, 212, 0.14);
    text-decoration: none;
    white-space: nowrap;
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }

  .admin-home {
    padding: 0 14px;
    color: rgba(237, 228, 212, 0.72);
  }
  .admin-home:hover {
    color: var(--bg);
    background: rgba(237, 228, 212, 0.07);
  }
  .admin-home svg {
    display: block;
  }

  .admin-back {
    gap: 7px;
    padding: 0 14px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.62);
  }
  .admin-back:hover {
    color: var(--accent-on-dark);
    background: rgba(237, 228, 212, 0.07);
  }
  .back-arrow {
    font-size: var(--fs-label);
    line-height: 1;
  }

  .admin-wordmark {
    flex-shrink: 0;
    font-size: var(--fs-body-sm);
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 20px;
    border-right: 1px solid rgba(237, 228, 212, 0.14);
    color: var(--bg);
    text-decoration: none;
  }
  .admin-wordmark::before {
    color: var(--accent-on-dark);
    opacity: 1;
  }
  .wordmark-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .admin-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--accent-on-dark);
  }

  .admin-sections {
    margin-left: auto;
    display: flex;
    align-items: stretch;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .admin-sections::-webkit-scrollbar {
    display: none;
  }
  .admin-sections :global(.nav-link) {
    display: inline-flex;
    align-items: center;
    flex: none;
    padding: 0 16px;
    border: none;
    border-right: 1px solid rgba(237, 228, 212, 0.14);
    border-radius: 0;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.62);
    white-space: nowrap;
  }
  .admin-sections :global(.nav-link::after) {
    display: none;
  }
  .admin-sections :global(.nav-link:first-child) {
    border-left: 1px solid rgba(237, 228, 212, 0.14);
  }
  .admin-sections :global(.nav-link:hover) {
    color: var(--bg);
    background: rgba(232, 134, 58, 0.14);
  }
  .admin-sections :global(.nav-link[aria-current='page']) {
    color: var(--text-primary);
    background: var(--bg);
    box-shadow: inset 0 -3px 0 var(--accent);
  }
  .admin-sections :global(.nav-link[aria-current='page']::before) {
    color: var(--accent);
  }

  .view-site {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 18px;
    border-left: 1px solid rgba(237, 228, 212, 0.14);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.7);
    text-decoration: none;
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }
  .view-site:hover {
    color: var(--bg);
    background: rgba(232, 134, 58, 0.14);
  }

  /* The strip scrolls rather than wrapping on a phone — a second row would
     double the height of a bar that is meant to be one 48px band. */
  @media (max-width: 640px) {
    .admin-wordmark {
      padding: 0 14px;
    }
    .admin-tag {
      display: none;
    }
    /* Same trade SiteHeader makes: the back cell keeps its arrow, drops its
       word, and the sections strip gets the width back. */
    .back-word {
      display: none;
    }
    .admin-home,
    .admin-back {
      padding: 0 12px;
    }

    /* MEASURED, at 375px: home 39 + back 38 + wordmark 172 + view-site 85 =
       334 of 375, which left `.admin-sections` — Overview, Content,
       Connections, AI, Ops, Estate, Access, i.e. the whole of admin's
       wayfinding — at ZERO pixels, and pushed the document into horizontal
       scroll. Two cells give the width back:

        * The wordmark is capped the way SiteHeader caps its title cell
          (38vw, ellipsis), because on a phone the brand is not the thing
          you came to the bar for.
        * `.view-site` goes. Its destination is `/` — the SAME destination
          as the home icon two cells to its left, which is present at every
          width now and was not before. It is kept on a wide screen, where
          the label is worth its 85px and nothing is competing for them. */
    .admin-wordmark {
      max-width: 38vw;
    }
    .view-site {
      display: none;
    }
  }
</style>
