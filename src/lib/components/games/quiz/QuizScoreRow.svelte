<script lang="ts">
  // One line of the Quiz Night scoreboard on the TV: the name, a tick once
  // they have answered (never what), and the score counting up at the reveal
  // with the points it gained popping beside it.
  import { untrack } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  let {
    name,
    score,
    place,
    ticking = false,
    answered = false,
    gained = null,
    leading = false,
  }: {
    name: string;
    score: number;
    place: number;
    /** A question is open: show the answered marks. */
    ticking?: boolean;
    answered?: boolean;
    gained?: number | null;
    leading?: boolean;
  } = $props();

  const shown = new Tween(untrack(() => score), { duration: 1200, easing: cubicOut });
  $effect(() => {
    const target = score;
    // After the right answer has lifted.
    const t = setTimeout(() => shown.set(target), 600);
    return () => clearTimeout(t);
  });
</script>

<div class="row" class:answered class:leading>
  <span class="place">{place}</span>
  <span class="name">{name}</span>
  <span class="tick" class:off={!ticking} aria-hidden="true">
    <svg viewBox="0 0 16 16"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
  </span>
  <span class="score">{Math.round(shown.current)}</span>
  {#if gained}
    <span class="gain">+{gained}</span>
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 2cqw minmax(0, 1fr) 2cqw auto;
    align-items: center;
    gap: 0.8cqw;
    padding: 0.9cqw 1.1cqw;
    border: 1px solid var(--on-ink-14);
    border-radius: 4px;
    background: var(--on-ink-05);
    transition:
      border-color 300ms ease,
      background-color 300ms ease;
  }
  .row.leading {
    border-color: var(--accent-on-dark);
  }
  .place {
    font-family: var(--font-mono);
    font-size: 1cqw;
    color: var(--on-ink-55);
  }
  .name {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.8cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tick {
    width: 1.8cqw;
    height: 1.8cqw;
    border-radius: 100px;
    border: 1px solid var(--on-ink-16);
    display: grid;
    place-items: center;
    transition:
      background-color 260ms ease,
      border-color 260ms ease,
      transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1.4);
  }
  .tick.off {
    visibility: hidden;
  }
  .tick svg {
    width: 70%;
    height: 70%;
    fill: none;
    stroke: var(--chrome-bg);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0;
    transition: opacity 200ms ease;
  }
  .answered .tick {
    background: var(--good-on-dark);
    border-color: var(--good-on-dark);
    transform: scale(1.12);
  }
  .answered .tick svg {
    opacity: 1;
  }
  .score {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.8cqw;
    font-variant-numeric: tabular-nums;
    min-width: 5cqw;
    text-align: right;
  }
  .gain {
    position: absolute;
    right: -0.4cqw;
    top: -1.2cqw;
    padding: 0.15cqw 0.5cqw;
    border-radius: 2px;
    background: var(--good-on-dark);
    color: var(--chrome-bg);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.1cqw;
    animation: pop 1.8s cubic-bezier(0.2, 0.7, 0.2, 1) 300ms both;
  }
  @keyframes pop {
    0% {
      opacity: 0;
      transform: translateY(0.8cqw) scale(0.7);
    }
    18% {
      opacity: 1;
      transform: none;
    }
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0.85;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .gain {
      animation: none;
    }
  }
</style>
