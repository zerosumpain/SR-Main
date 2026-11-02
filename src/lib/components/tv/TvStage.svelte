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
  /* The iPhone app's Prism palette in its dark mode (SR-AppleApp
     Design/SRPalette.swift), poured into the site's dark tokens so every TV
     page and game board inherits it; type, square corners and the sr. mark
     stay the site's. Only here: phones and the web games keep the site's ink. */
  .tv-screen {
    --chrome-bg: #0b0a1c;
    --chrome-ink: #f4f3fb;
    --tv-surface: #1a1838;
    --tv-ink-2: #c8c4ee;
    --accent: #a194ff;
    --accent-hover: #b8adff;
    --accent-on-dark: #a194ff;
    --accent-ink: #4fd8e0;
    --good-on-dark: #4ade80;
    --success: #4ade80;
    --warn: #ffc24b;
    --error: #ff6b85;
    --on-ink-05: rgba(244, 243, 251, 0.05);
    --on-ink-08: rgba(244, 243, 251, 0.08);
    --on-ink-12: rgba(244, 243, 251, 0.12);
    --on-ink-14: rgba(244, 243, 251, 0.14);
    --on-ink-16: rgba(244, 243, 251, 0.16);
    --on-ink-30: rgba(244, 243, 251, 0.3);
    --on-ink-45: rgba(244, 243, 251, 0.45);
    --on-ink-55: rgba(244, 243, 251, 0.6);
    --on-ink-70: rgba(244, 243, 251, 0.7);
    --on-ink-80: rgba(244, 243, 251, 0.8);
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    /* The app's ground: midnight, lit faintly from the icon's corners. */
    background:
      radial-gradient(60% 50% at 0% 0%, rgba(255, 122, 89, 0.1), transparent 70%),
      radial-gradient(60% 50% at 100% 0%, rgba(244, 114, 182, 0.08), transparent 70%),
      radial-gradient(70% 60% at 0% 100%, rgba(124, 58, 237, 0.14), transparent 70%),
      radial-gradient(70% 60% at 100% 100%, rgba(59, 75, 245, 0.12), transparent 70%),
      var(--chrome-bg);
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
