<script lang="ts">
  // The foot of /projects: the home page's footer, in the view on screen, so
  // the page closes the way the home page does rather than on a generic strip.
  // Same links, same rail-band shape and the same per-view coat as the
  // landing's `.site-foot` (src/routes/+page.svelte): a hairline under the
  // sentence, the night shore under the place, a torn dashed edge on the
  // notes. The rambler's two links are left on the home page, where he is.
  import type { HeroView } from '$lib/landing/hero-view';

  let { view, owner }: { view: HeroView; owner: boolean } = $props();
</script>

<footer class="pf" data-view={view}>
  <p class="brand pf-brand">strange ramblings</p>
  <nav class="pf-links" aria-label="Footer">
    <a href="https://github.com/jkrup" target="_blank" rel="noopener" class="nav-link">GitHub</a>
    <a href="mailto:john@strangeramblings.com" class="nav-link">Email</a>
    <a href="/rss.xml" class="nav-link">RSS</a>
    <a href="https://library.strangeramblings.com" class="nav-link">Library</a>
    {#if owner}<a href="/admin" class="nav-link">Admin</a>{/if}
    <a href="/privacy" class="nav-link">Privacy</a>
    <a href="/tos" class="nav-link">Terms</a>
  </nav>
</footer>

<style>
  .pf {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 18px clamp(24px, 5vw, 64px);
    border-top: 1px solid var(--line-strong);
    background: var(--surface-rail);
    color: var(--text-primary);
  }
  .pf-brand {
    margin: 0;
    font-size: var(--fs-nav);
    color: var(--text-muted);
  }
  .pf-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
  }
  .pf-links > :global(.nav-link) {
    min-height: 44px;
    align-items: center;
  }

  /* The sentence ends on a hairline, like the foot of a printed page. */
  .pf[data-view='sentence'] {
    background: var(--bg);
    border-top: 2px solid var(--text-primary);
  }
  /* The place: the shore at night, the links lit like the town's windows. */
  .pf[data-view='place'] {
    background: var(--place-night);
    border-top-color: var(--on-ink-16);
  }
  .pf[data-view='place'] .pf-brand {
    color: var(--on-ink-70);
  }
  .pf[data-view='place'] .pf-brand::before {
    color: var(--accent-on-dark);
  }
  .pf[data-view='place'] .pf-links > :global(.nav-link) {
    color: var(--on-ink-80);
  }
  .pf[data-view='place'] .pf-links > :global(.nav-link:hover) {
    color: var(--accent-on-dark);
    border-color: var(--on-ink-30);
  }
  .pf[data-view='place'] .pf-links > :global(.nav-link:focus-visible) {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  /* The notes: the last ruled line, torn off with a dashed edge. */
  .pf[data-view='notes'] {
    background: var(--bg) repeating-linear-gradient(transparent 0 31px, var(--line-hair) 31px 32px);
    border-top: 1px dashed var(--text-secondary);
  }

  @media print {
    .pf {
      display: none;
    }
  }
</style>
