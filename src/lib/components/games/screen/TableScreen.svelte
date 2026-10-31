<script lang="ts" generics="R">
  // A family game's TV board, any game: the full-viewport ink stage, the
  // pairing code while nobody has picked this TV, and the game's own board
  // (a snippet) once a phone has. The stream lives in `screen-stream.ts`.
  //
  // Built for a television across the room: one 16:9 stage scaled to the
  // viewport (every size inside is in `cqw`), no pointer needed, the screen
  // kept awake while it is open.
  import { onMount, type Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { openScreen, type ScreenState } from './screen-stream';

  let {
    game,
    title,
    board,
  }: {
    game: string;
    title: string;
    board: Snippet<[R, number]>;
  } = $props();

  let view = $state<ScreenState<R>>({ kind: 'connecting' });
  let full = $state(false);

  // Plain handles, never reactive (svelte5-pitfalls §1).
  let close: (() => void) | null = null;
  let lock: { release(): Promise<void> } | null = null;

  function connect(forget = false) {
    close?.();
    close = openScreen<R>(game, (s) => (view = s), { forget });
  }

  async function keepAwake() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
    } catch {
      /* not offered here: the TV's own settings decide */
    }
  }

  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }

  onMount(() => {
    connect();
    void keepAwake();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void keepAwake();
    };
    const onFull = () => (full = !!document.fullscreenElement);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('fullscreenchange', onFull);
    return () => {
      close?.();
      close = null;
      void lock?.release().catch(() => {});
      lock = null;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('fullscreenchange', onFull);
    };
  });

  const letters = $derived(view.kind === 'code' ? [...view.code] : []);
</script>

<svelte:head>
  <title>{title} · TV board</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="screen">
  <div class="stage">
    {#if view.kind === 'room'}
      <div class="fill" in:fade={{ duration: 400 }}>
        {@render board(view.room, view.skewMs)}
      </div>
    {:else}
      <div class="pair" in:fade={{ duration: 400 }}>
        <p class="brand"><span class="mark">sr.</span> games</p>
        <h1>{title}</h1>
        {#if view.kind === 'code'}
          <p class="lead">On a phone in the game, tap <strong>Show on TV</strong> and type</p>
          <div class="code" aria-label="Code {letters.join(' ')}">
            {#each letters as ch, i (i + ch)}
              <span class="letter" style:animation-delay="{i * 70}ms">{ch}</span>
            {/each}
          </div>
          <p class="foot">strangeramblings.com/games/{game} · a new code every twenty minutes</p>
        {:else}
          <p class="lead">Connecting…</p>
        {/if}
      </div>
    {/if}
  </div>

  <div class="controls">
    <button type="button" onclick={toggleFull}>{full ? 'Exit full screen' : 'Full screen'}</button>
    {#if view.kind === 'room'}
      <button type="button" onclick={() => connect(true)}>Disconnect</button>
    {/if}
  </div>
</div>

<style>
  .screen {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--chrome-bg);
    color: var(--chrome-ink);
    overflow: hidden;
  }
  /* One 16:9 stage, as large as the viewport allows; everything inside sizes in cqw. */
  .stage {
    position: relative;
    width: min(100vw, calc(100vh * 16 / 9));
    aspect-ratio: 16 / 9;
    container-type: size;
  }
  .fill {
    position: absolute;
    inset: 0;
  }
  .pair {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.6cqw;
    text-align: center;
  }
  .brand {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.3cqw;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .mark {
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
  .lead {
    margin: 1.2cqw 0 0;
    font-family: var(--font-body);
    font-size: 1.9cqw;
    color: var(--on-ink-80);
  }
  .lead strong {
    color: var(--accent-on-dark);
    font-weight: 600;
  }
  .code {
    display: flex;
    gap: 1.4cqw;
  }
  .letter {
    display: grid;
    place-items: center;
    width: 9cqw;
    height: 11cqw;
    border: 2px solid var(--on-ink-30);
    border-radius: 4px;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 7.5cqw;
    color: var(--chrome-ink);
    background: var(--on-ink-05);
    animation: rise 520ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .foot {
    margin: 1cqw 0 0;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    color: var(--on-ink-45);
  }
  .controls {
    position: fixed;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 8px;
    opacity: 0;
    transition: opacity 200ms ease;
  }
  .screen:hover .controls,
  .controls:focus-within {
    opacity: 1;
  }
  .controls button {
    padding: 6px 12px;
    border: 1px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--chrome-bg);
    color: var(--on-ink-80);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
  }
  .controls button:hover {
    color: var(--chrome-ink);
    border-color: var(--on-ink-55);
  }
  @keyframes rise {
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
    .letter {
      animation: none;
    }
  }
</style>
