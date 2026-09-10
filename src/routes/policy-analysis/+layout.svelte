<script lang="ts">
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import { currentPath } from '$lib/nav/page-path';
  let { children } = $props();

  /**
   * A shared copy has a different reader, and the chrome has to know it.
   *
   * The masthead derives its way back from the URL, which on a share link reads
   * "← SHARED" and points at `/policy-analysis/shared` — a path with no page,
   * for a reader with no account. `back={null}` removes it; the footer stops
   * calling somebody else's report "private"; and the nav stays the site's
   * shared one, which is what every anonymous visitor already sees.
   */
  const shared = $derived(currentPath().startsWith('/policy-analysis/shared'));
</script>
<!--
  `unifiedNav` puts the site's shared 48px cell bar above this page rather than
  the /health family's editorial masthead. Every owner surface outside /health
  itself — /research, /decks, /projects, /blog, /drive — does the same; without
  it this page would wear another section's chrome.
-->
<HealthShell
  path="/policy-analysis"
  unifiedNav
  kicker="Red team"
  back={shared ? null : undefined}
  navBack={!shared}
  footer={shared ? ['Shared copy — read only', 'Incentives · evidence · uncertainty'] : ['Private assessment', 'Incentives · evidence · uncertainty']}
>
  <main class="policy-page">{@render children()}</main>
</HealthShell>
<style>
  /* Wider than a reading page, because the workspaces are dashboards: the actor
     atlas, the network's small multiples and the stress lab's two columns all
     want the room. The prose inside them keeps its own measure. */
  .policy-page { max-width: 1400px; margin: auto; padding: clamp(1rem, 3vw, 2.75rem); min-width: 0; }
  :global(.policy-page h1) { font-family: var(--font-display); font-size: clamp(2rem, 5vw, 3.8rem); line-height: 1.06; overflow-wrap: anywhere; margin: 1rem 0; }
  :global(.policy-page h2) { font-family: var(--font-display); font-size: var(--fs-display-xs); margin: 1.5rem 0 1rem; }
  :global(.policy-page p) { line-height: 1.65; max-width: 75ch; }
  :global(.policy-page button:focus-visible), :global(.policy-page a:focus-visible) { outline: 2px solid var(--accent); outline-offset: 3px; }
  :global(.policy-page .ruled) { padding: 1rem 0; border-bottom: 1px solid var(--line-strong); }
  :global(.policy-page .toolbar) { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; margin: 1rem 0; }
  :global(.policy-page .muted) { color: var(--text-muted); font-size: var(--fs-label); }
  :global(.policy-page .eyebrow) { font-family: var(--font-mono); color: var(--accent); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; }
  :global(.policy-page .warning) { background: var(--surface-sunken); border-left: 3px solid var(--accent); padding: .75rem 1rem; margin: .75rem 0; }
  :global(.policy-page a) { color: var(--accent-ink); overflow-wrap: anywhere; }

  /*
   * PRINT. The assessment is a document people take into a meeting, so the
   * printed copy is a deliverable rather than a fallback.
   *
   * The site chrome goes: the nav strip and the footer are solid ink and would
   * print as black bands across the first and last page. Colour is kept where it
   * CARRIES something — an exposure band, a plot fill — which needs
   * `print-color-adjust`, because a browser drops backgrounds by default and
   * those marks would print as empty outlines.
   */
  @media print {
    @page { margin: 16mm 14mm; }
    /* White ground on paper. The cream is the site's, and a printed report that
       floods every page with it burns toner and leaves a hard-edged block
       wherever the container stops short of the page. Colour that MEANS
       something — bands, plot fills — is kept below. */
    :global(html), :global(body), :global(.hs), :global(.policy-page) { background: #fff !important; }
    :global(.hs-grain), :global(.site-nav-bar), :global(.hs-head), :global(.hs-foot), :global(header), :global(footer) { display: none !important; }
    :global(.policy-page) { max-width: none; padding: 0; }
    :global(.policy-page .nm-save-btn), :global(.policy-page button.nm-save-btn) { display: none !important; }
    /* Every other button on these pages opens the inspector, which is not there
       on paper. The ones whose label is CONTENT — a play's name on an actor
       card — must survive, so they become text rather than disappearing. */
    :global(.policy-page button) { text-decoration: none !important; color: inherit !important; background: none !important; border: 0 !important; padding: 0 !important; }
    :global(.policy-page h1) { font-size: 2.2rem; }
    :global(.policy-page h2) { break-after: avoid; }
    :global(.policy-page p), :global(.policy-page li) { orphans: 3; widows: 3; }
    /* A band, a plot mark and a tile only mean anything with their fill. */
    :global(.policy-page [class*="band"]), :global(.policy-page svg), :global(.policy-page .tile) {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    :global(.policy-page details) { break-inside: avoid; }
    :global(.policy-page summary) { display: none; }
  }
</style>
