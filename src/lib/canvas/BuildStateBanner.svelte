<script lang="ts">
  // A canvas that is being built from a description (Describe it, on the
  // list or the iPhone). The graph lands in one write when the generator
  // finishes; the /live stream's `build_complete` reloads the page, and this
  // polls the build state as a backstop for a tab that opened late or lost
  // its stream. A failed build says why, and points at the prompt bar.
  import { untrack } from 'svelte';

  type Props = {
    slug: string;
    building: boolean;
    buildError: string | null;
    /** The build settled (either way) — reload the canvas. */
    onSettled: () => void;
  };
  let { slug, building, buildError, onSettled }: Props = $props();

  const POLL_MS = 4000;
  let elapsed = $state(0);

  $effect(() => {
    // Tracked: only whether a build is in flight, and for which canvas.
    const active = building;
    const s = slug;
    if (!active) return;
    // Internal handles — never read by the template (svelte5-pitfalls §1).
    let stopped = false;
    const started = Date.now();
    const tick = setInterval(() => (elapsed = Math.round((Date.now() - started) / 1000)), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/canvas/${encodeURIComponent(s)}/build-state`);
        if (!res.ok || stopped) return;
        const state = (await res.json()) as { building?: boolean };
        if (state.building === false && !stopped) {
          stopped = true;
          untrack(() => onSettled());
        }
      } catch {
        /* offline — the next tick tries again */
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  });
</script>

{#if building}
  <section class="bstate bstate--building" aria-live="polite">
    <span class="bstate-dot" aria-hidden="true"></span>
    <span class="bstate-hd">Building from your description</span>
    <span class="bstate-text">jkai is choosing the steps and checking them — they land here together when it is done.</span>
    <span class="bstate-time">{elapsed}s</span>
  </section>
{:else if buildError}
  <section class="bstate bstate--failed" role="alert">
    <span class="bstate-hd">{buildError.startsWith('built, but') ? 'Built — did not pass its test run' : 'Build did not finish'}</span>
    <span class="bstate-text">{buildError}</span>
    <span class="bstate-text bstate-muted">Say what to change in the prompt bar below, or add steps by hand.</span>
  </section>
{/if}

<style>
  .bstate {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 14px;
    border-bottom: 1px solid var(--line-hair);
    flex-shrink: 0;
  }
  .bstate--building {
    background: var(--accent-tint-08);
  }
  .bstate--failed {
    background: var(--error-bg);
    border-left: 3px solid var(--error);
  }
  .bstate-dot {
    width: 8px;
    height: 8px;
    border-radius: 100px;
    background: var(--accent);
    align-self: center;
    animation: bstate-pulse 1.2s ease-in-out infinite;
  }
  .bstate-hd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-primary);
  }
  .bstate--failed .bstate-hd {
    color: var(--error);
  }
  .bstate-text {
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .bstate-muted {
    color: var(--text-muted);
  }
  .bstate-time {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  @keyframes bstate-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @media (prefers-reduced-motion: reduce) {
    .bstate-dot { animation: none; }
  }
</style>
