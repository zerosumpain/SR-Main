<script lang="ts">
  import { app } from '../lib/appState.svelte';

  interface Props {
    kicker: string;
    title: string;
    thesis: string;
    thesisEli5?: string;
    asks?: string[];
    askLabel?: string;
  }
  let { kicker, title, thesis, thesisEli5, asks, askLabel = 'What this demands of the strategy' }: Props = $props();
  const eli = $derived(app.narrative === 'eli5');
</script>

<header class="sm">
  <span class="sm-kicker">{kicker}</span>
  <h1 class="pe-h1">{title}</h1>
  <p class="pe-lede sm-thesis">{eli && thesisEli5 ? thesisEli5 : thesis}</p>
  {#if asks && asks.length}
    <div class="sm-ask">
      <span class="sm-ask-lab">▸ {askLabel}</span>
      <ul>
        {#each asks as ask}<li>{ask}</li>{/each}
      </ul>
    </div>
  {/if}
</header>

<style>
  .sm { margin: 0 0 18px; }
  .sm-kicker { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--ink-soft, rgba(28,22,17,0.62)); margin-bottom: 7px; }
  .sm-thesis { margin: 0 0 14px; max-width: 78ch; }
  .sm-ask { border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-round); padding: 10px 14px; max-width: 78ch; }
  .sm-ask-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--accent-ink); margin-bottom: 6px; }
  .sm-ask ul { margin: 0; padding-left: 18px; }
  .sm-ask li { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); margin-bottom: 3px; }
</style>
