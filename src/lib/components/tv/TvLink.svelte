<script lang="ts">
  // An unlinked TV: four letters for the owner to type at /admin/access/tvs.
  // Once approved, the token is kept as this TV's cookie and the page reloads
  // into the menu (`tv-stream` openLink).
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import TvStage from './TvStage.svelte';
  import { openLink, type LinkState } from './tv-stream';
  import { STING } from '$lib/games/kelly';

  let view = $state<LinkState>({ kind: 'connecting' });

  onMount(() => {
    const close = openLink((s) => {
      view = s;
      if (s.kind === 'linked') setTimeout(() => location.reload(), 1_200);
    });
    const w = window as Window & { srTvBack?: () => boolean };
    w.srTvBack = () => false;
    return close;
  });

  const letters = $derived(view.kind === 'code' ? [...view.code] : []);
</script>

<TvStage>
  <div class="tv-link" in:fade={{ duration: 300 }}>
    <p class="tv-brand"><span class="tv-mark">sr.</span> tv</p>
    {#if view.kind === 'linked'}
      <h1>Linked</h1>
      <p class="tv-lead">This is <strong>{view.name}</strong> now. Opening the games…</p>
    {:else if view.kind === 'failed'}
      <h1>That did not take</h1>
      <p class="tv-lead">Reload this page for a fresh code.</p>
    {:else}
      <h1>Link this TV</h1>
      {#if view.kind === 'code'}
        <p class="tv-lead">On John's phone, open <strong>strangeramblings.com/admin/access/tvs</strong> and type</p>
        <div class="tv-code" aria-label="Code {letters.join(' ')}">
          {#each letters as ch, i (i + ch)}
            <span class="tv-letter" style:animation-delay="{i * 70}ms">{ch}</span>
          {/each}
        </div>
        <p class="tv-foot">Once is enough — this TV remembers. A new code every twenty minutes.</p>
      {:else}
        <p class="tv-lead">Connecting…</p>
      {/if}
    {/if}
    <p class="tv-sting">{STING}</p>
  </div>
</TvStage>

<style>
  .tv-link {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.6cqw;
    text-align: center;
  }
  .tv-brand {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.4cqw;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .tv-mark {
    font-family: var(--font-brand);
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent-on-dark);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 6cqw;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .tv-lead {
    margin: 0.6cqw 0 0;
    font-size: 1.9cqw;
    color: var(--on-ink-80);
  }
  .tv-lead strong {
    color: var(--accent-on-dark);
    font-weight: 600;
  }
  .tv-code {
    display: flex;
    gap: 1.4cqw;
  }
  .tv-letter {
    display: grid;
    place-items: center;
    width: 9cqw;
    height: 11cqw;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 7.5cqw;
    background: var(--on-ink-05);
    animation: tv-rise 520ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .tv-foot {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--on-ink-45);
  }
  .tv-sting {
    position: absolute;
    bottom: 2.4cqw;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-ink-45);
  }
  @keyframes tv-rise {
    from {
      opacity: 0;
      transform: translateY(1.2cqw);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tv-letter {
      animation: none;
    }
  }
</style>
