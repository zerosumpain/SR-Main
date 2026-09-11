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
<!--
  NO <style> BLOCK HERE ANY MORE.

  This page's chrome — `.pa-band`, `.pa-wrap`, `.pa-sheet`, `.pa-seg`, the
  element defaults and the whole @media print section — lives at the END of
  `src/app.css`, under the heading "/policy-analysis — THE PAGE CHROME".

  It moved because the offline pack (`npm run build:offline`) compiles the same
  dashboard into a standalone file and needs the same chrome, and that build
  cannot import this component: it would pull in HealthShell and the site nav,
  which a file:// page has no use for. Keeping a second copy beside it is how the
  shared report once lost two chapters, so there is one copy and it is there.
-->
