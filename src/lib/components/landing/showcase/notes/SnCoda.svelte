<svelte:options css="injected" />

<script lang="ts">
  // The last page: three more things the site does, written smaller, each
  // with a hand-drawn arrow pointing at its link and a pencilled line on
  // what it's up to now. The family is private, so it says only that.
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { rng } from '$lib/landing/notes-ink';
  import { PAGES, codaItems, inkArrow, type FairRow } from '$lib/landing/showcase-notes';
  import SnPage from './SnPage.svelte';
  import { snap } from './snap';

  let { v, now, fair }: { v: LandingVitals | null; now: number; fair: FairRow[] } = $props();

  let items = $derived(codaItems(v, now));
  const ARROWS = [
    inkArrow(rng(401), 6, 6, 58, 44, 0.32),
    inkArrow(rng(402), 10, 4, 54, 46, -0.28),
    inkArrow(rng(403), 4, 10, 60, 42, 0.4),
  ];
</script>

<SnPage id="rest" page={PAGES.rest} {fair}>
  <ul class="cd" use:scenery use:snap>
    {#each items as it, i (it.id)}
      <li class="cd-i">
        <svg viewBox="0 0 64 50" aria-hidden="true" focusable="false"><path d={ARROWS[i].shaft} /><path d={ARROWS[i].head} /></svg>
        <div>
          <a class="cd-a" href={it.href}>{it.name}</a>
          <p class="sn-a cd-l">
            {#if it.spoken}<span aria-hidden="true">{it.line}</span><span class="vh">{it.spoken}</span>{:else}{it.line}{/if}
          </p>
        </div>
      </li>
    {/each}
  </ul>
</SnPage>

<style>
  .cd {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 32px clamp(24px, 3vw, 48px);
    margin: 64px 0 0;
    padding: 0;
    list-style: none;
  }
  .cd-i {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  .cd-i svg {
    width: 64px;
    height: 50px;
    overflow: visible;
  }
  .cd-i path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .cd-a {
    display: inline-flex;
    align-items: center;
    min-height: 64px;
    margin-top: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(22px, 2vw, 28px);
    line-height: 1.05;
    letter-spacing: -0.025em;
    color: var(--text-primary);
    text-decoration: underline;
    text-decoration-color: var(--accent);
    text-decoration-thickness: 2px;
    text-underline-offset: 6px;
  }
  .cd-a:hover {
    color: var(--accent-hover);
  }
  .cd-a:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 4px;
    border-radius: 2px;
  }
  .cd-l {
    margin-top: 0;
  }
  @media (max-width: 900px) {
    .cd {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
