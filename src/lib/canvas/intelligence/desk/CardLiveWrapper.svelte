<!-- src/lib/canvas/intelligence/desk/CardLiveWrapper.svelte -->
<!--
  Liveness wrapper that sits INSIDE the position host (.desk-card-host) and
  OUTSIDE the ArtefactCard. This separation is deliberate:

    .desk-card-host  → position + morph (transform: translate, transition)
    .desk-card-live  → liveness (entrance scale/opacity, idle breathing, fresh
                       pulse) — its OWN transform/opacity, fully independent of
                       the host's position transform so neither clobbers the other
    .ac (the button) → content + hover micro-transform (unchanged)

  All animations here are pure CSS on transform/opacity/box-shadow only (GPU
  friendly, no layout-triggering props). The only reactive state is a PLAIN
  `let` timer that clears the fresh flag after ~1s; it is never $state read from
  inside an $effect (see CLAUDE.md Svelte 5 footguns).
-->
<script lang="ts">
  import { onDestroy } from 'svelte';

  let {
    enterDelayMs = 0,
    fresh = false,
    breathing = false,
    children,
  } = $props<{
    /** Staggered entrance delay (ms) within this card's arrival batch. */
    enterDelayMs?: number;
    /** True at arrival → ~1s fresh-pulse glow, then settles. */
    fresh?: boolean;
    /** True while the engine is actively running → barely-perceptible breathe. */
    breathing?: boolean;
    children?: import('svelte').Snippet;
  }>();

  const FRESH_MS = 1000;

  // Latch `fresh` once at arrival; never re-arm. Cleared by a PLAIN `let` timer.
  let freshActive = $state(false);
  let freshTimer: ReturnType<typeof setTimeout> | null = null;
  let latched = false;

  $effect(() => {
    const isFresh = fresh; // tracked read so the effect runs once fresh is known
    if (latched) return;
    latched = true;
    if (!isFresh) return;
    freshActive = true;
    freshTimer = setTimeout(() => {
      freshActive = false;
      freshTimer = null;
    }, FRESH_MS);
  });

  onDestroy(() => {
    if (freshTimer !== null) {
      clearTimeout(freshTimer);
      freshTimer = null;
    }
  });
</script>

<div
  class="desk-card-live"
  class:fresh={freshActive}
  class:breathing
  style:--enter-delay="{enterDelayMs}ms"
>
  {@render children?.()}
</div>

<style>
  /* Liveness wrapper — its OWN transform-origin + animations. Never carries the
     position translate (that's on the host). display:contents would drop the
     box; we keep a real box but make it shrink-wrap and not affect pointer flow. */
  .desk-card-live {
    transform-origin: 50% 40%;
    /* Entrance plays ONCE on mount: opacity 0→1 + scale 0.85→1 + a tiny drop.
       animation-delay staggers a flush's new cards across ~120ms. */
    animation: card-enter 360ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--enter-delay, 0ms) both;
  }

  @keyframes card-enter {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.85);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* Idle breathing — barely-perceptible continuous scale, only while running.
     Layered AFTER entrance so it starts cleanly once entrance has settled. */
  .desk-card-live.breathing {
    /* Promote a compositor layer ONLY while the engine is running (breathing
       active); released when idle/complete so hundreds of finished cards don't
       each permanently retain a layer. Entrance/fresh are brief one-shots and
       don't need a standing hint. */
    will-change: transform;
    animation:
      card-enter 360ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--enter-delay, 0ms) both,
      card-breathe 3.6s ease-in-out 360ms infinite;
  }

  @keyframes card-breathe {
    0%,
    100% { transform: scale(1); }
    50%  { transform: scale(1.012); }
  }

  /* Fresh pulse — accent glow ring for ~1s after arrival (box-shadow + outline,
     no transform, so it composes with the entrance/breathe transforms). */
  .desk-card-live.fresh {
    animation:
      card-enter 360ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--enter-delay, 0ms) both,
      card-fresh-pulse 1000ms ease-out 1 both;
  }
  .desk-card-live.fresh.breathing {
    animation:
      card-enter 360ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--enter-delay, 0ms) both,
      card-breathe 3.6s ease-in-out 360ms infinite,
      card-fresh-pulse 1000ms ease-out 1 both;
  }

  @keyframes card-fresh-pulse {
    0% {
      filter: drop-shadow(0 0 0 rgba(196, 87, 10, 0));
    }
    25% {
      filter: drop-shadow(0 0 6px rgba(196, 87, 10, 0.55));
    }
    100% {
      filter: drop-shadow(0 0 0 rgba(196, 87, 10, 0));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .desk-card-live,
    .desk-card-live.breathing,
    .desk-card-live.fresh,
    .desk-card-live.fresh.breathing {
      animation: none;
      opacity: 1;
      transform: none;
      filter: none;
    }
  }
</style>
