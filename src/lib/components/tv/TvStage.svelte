<script lang="ts">
  // The TV's stage: one 16:9 box as large as the screen allows, every size
  // inside it in `cqw` (the shape of games/screen/TableScreen), on ink, with
  // the screen kept awake while it is open. sr. tv pages render inside it.
  import { onMount, type Snippet } from 'svelte';

  /**
   * `art`: the painting behind the stage (a path under static/tv-art), or none.
   * `quiet` dims it further, for a game board that needs the attention.
   */
  let { children, art = null, quiet = false }: { children: Snippet; art?: string | null; quiet?: boolean } = $props();

  let lock: { release(): Promise<void> } | null = null;

  async function keepAwake() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
    } catch {
      /* the Android shell keeps the screen on itself */
    }
  }

  onMount(() => {
    void keepAwake();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void keepAwake();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
      lock = null;
    };
  });
</script>

<div class="tv-screen">
  {#if art}<div class="tv-art" class:tv-art-quiet={quiet} style="background-image: url({art})" aria-hidden="true"></div>{/if}
  <div class="tv-stage">
    {@render children()}
  </div>
</div>

<style>
  /* The site's own night: browns and creams, the burnt-orange accent (the
     tokens /jkai's night uses). The app's pixel SR stays as the logo. Behind
     everything, a generated painting (static/tv-art, made by
     scripts/tv-art.mjs), dimmed under a wash so it is a mood, not a picture. */
  .tv-screen {
    --chrome-bg: #0b0806;
    --chrome-ink: #ece3d6;
    --tv-surface: #1e1913;
    --tv-ink-2: #cdc2b2;
    --accent: #e07b2a;
    --accent-hover: #f0913f;
    --accent-on-dark: #e07b2a;
    --accent-ink: #3fa3b0;
    --success: #5eb36c;
    --warn: #d4ab4a;
    --error: #e06a6a;
    --on-ink-05: rgba(236, 227, 214, 0.05);
    --on-ink-08: rgba(236, 227, 214, 0.08);
    --on-ink-12: rgba(236, 227, 214, 0.12);
    --on-ink-14: rgba(236, 227, 214, 0.14);
    --on-ink-16: rgba(236, 227, 214, 0.16);
    --on-ink-30: rgba(236, 227, 214, 0.3);
    --on-ink-45: rgba(236, 227, 214, 0.45);
    --on-ink-55: rgba(236, 227, 214, 0.6);
    --on-ink-70: rgba(236, 227, 214, 0.7);
    --on-ink-80: rgba(236, 227, 214, 0.8);
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--chrome-bg);
    color: var(--chrome-ink);
    overflow: hidden;
  }
  .tv-art {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    opacity: 0.45;
    filter: saturate(0.9);
    transition: opacity 1.2s ease;
  }
  /* Darker where the words are: the left and the top, where the menu reads. */
  .tv-art::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(11, 8, 6, 0.85) 0%, rgba(11, 8, 6, 0.35) 55%, rgba(11, 8, 6, 0.15) 100%),
      linear-gradient(0deg, rgba(11, 8, 6, 0.6) 0%, transparent 40%);
  }
  .tv-art.tv-art-quiet {
    opacity: 0.12;
  }
  .tv-stage {
    position: relative;
    width: min(100vw, calc(100vh * 16 / 9));
    aspect-ratio: 16 / 9;
    container-type: size;
    font-family: var(--font-body);
  }
  /* Every control on the TV is a button with a ring you can see from the sofa. */
  .tv-stage :global([data-tv]) {
    outline: none;
    transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
  }
  .tv-stage :global([data-tv]:focus-visible),
  .tv-stage :global([data-tv]:focus) {
    border-color: var(--accent-on-dark) !important;
    background: var(--on-ink-08);
    transform: scale(1.04);
  }
</style>
