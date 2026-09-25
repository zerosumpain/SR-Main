<script lang="ts">
  /**
   * The frame /privacy and /tos share — a plain reading page: the site bar, a
   * kicker, a display title, the date it last changed, then prose. Kept apart
   * so the two documents cannot drift in how they look.
   */
  import type { Snippet } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  let { title, updated, children }: { title: string; updated: string; children: Snippet } = $props();
</script>

<PageHeader {title} />

<main class="legal">
  <p class="legal-kicker">strange ramblings · last updated {updated}</p>
  <h1 class="legal-title">{title}</h1>
  <div class="legal-body">
    {@render children()}
  </div>
</main>

<SiteFooter />

<style>
  .legal {
    max-width: 44rem;
    margin: 0 auto;
    padding: 2.5rem 1rem 4rem;
    color: var(--text-primary);
  }
  @media (min-width: 640px) {
    .legal {
      padding: 3.5rem 2.5rem 5rem;
    }
  }
  .legal-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
    margin: 0 0 0.75rem;
  }
  .legal-title {
    font-family: var(--font-display);
    font-size: clamp(2.25rem, 7vw, 3.5rem);
    line-height: 1;
    margin: 0 0 2rem;
    padding-bottom: 1.25rem;
    border-bottom: 2px solid var(--line-strong);
  }
  .legal-body {
    font-family: var(--font-body);
    font-size: 1.0625rem;
    line-height: 1.65;
    color: var(--text-secondary);
  }
  .legal-body :global(h2) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-sm, 0.8rem);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-primary);
    margin: 2.25rem 0 0.75rem;
  }
  .legal-body :global(p),
  .legal-body :global(ul) {
    margin: 0 0 1rem;
  }
  .legal-body :global(ul) {
    padding-left: 1.25rem;
    list-style: square;
  }
  .legal-body :global(li) {
    margin-bottom: 0.4rem;
  }
  .legal-body :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
  }
  .legal-body :global(strong) {
    color: var(--text-primary);
  }
</style>
