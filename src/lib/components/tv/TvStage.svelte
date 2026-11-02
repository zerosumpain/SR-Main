<script lang="ts">
  // The TV's stage: one 16:9 box as large as the screen allows, every size
  // inside it in `cqw` (the shape of games/screen/TableScreen), on ink, with
  // the screen kept awake while it is open. sr. tv pages render inside it.
  import { onMount, type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

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
  <div class="tv-stage">
    {@render children()}
  </div>
</div>

<style>
  .tv-screen {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--chrome-bg);
    color: var(--chrome-ink);
    overflow: hidden;
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
