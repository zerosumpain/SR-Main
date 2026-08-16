<script lang="ts">
  // PageFoot — previous/next through the study's reading order, derived from lib/nav.ts so
  // the order lives in exactly one place.
  import { page } from '$app/stores';
  import { neighbours } from '../lib/nav';

  const nav = $derived(neighbours($page.url.pathname));
</script>

<nav class="pf" aria-label="Study navigation">
  {#if nav.prev}
    <a class="pf-link prev" href={nav.prev.href}>
      <span class="pf-dir">← Previous</span>
      <span class="pf-lab">{nav.prev.label}</span>
    </a>
  {:else}<span></span>{/if}
  {#if nav.next}
    <a class="pf-link next" href={nav.next.href}>
      <span class="pf-dir">Next →</span>
      <span class="pf-lab">{nav.next.label}</span>
    </a>
  {/if}
</nav>

<style>
  .pf { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    margin: 26px 0 6px; padding-top: 14px; border-top: 1px solid rgba(28,22,17,0.12); }
  .pf-link { display: flex; flex-direction: column; gap: 2px; text-decoration: none; max-width: 46ch;
    padding: 9px 14px; border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.5); transition: background 0.13s, border-color 0.13s; }
  .pf-link:hover { background: rgba(255,255,255,0.85); border-color: rgba(28,22,17,0.36); }
  .pf-link.next { margin-left: auto; text-align: right; }
  .pf-dir { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent-ink); }
  .pf-lab { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); color: var(--text-primary); line-height: 1.25; }
</style>
