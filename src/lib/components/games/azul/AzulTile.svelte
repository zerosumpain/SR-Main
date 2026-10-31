<script lang="ts">
  // One Azul tile, or the first-player marker, or (ghost) the faint square a
  // wall keeps for a colour not yet placed. Each colour carries its own mark,
  // so the five can be told apart without colour vision.
  let { c, ghost = false, fresh = false }: { c: string; ghost?: boolean; fresh?: boolean } = $props();
</script>

<span class="tile {c}" class:ghost class:fresh aria-hidden="true">
  <svg viewBox="0 0 20 20">
    {#if c === 'blue'}
      <path d="M10 3c1.6 2.6 1.6 4.4 0 7-1.6-2.6-1.6-4.4 0-7zM10 17c-1.6-2.6-1.6-4.4 0-7 1.6 2.6 1.6 4.4 0 7zM3 10c2.6-1.6 4.4-1.6 7 0-2.6 1.6-4.4 1.6-7 0zM17 10c-2.6 1.6-4.4 1.6-7 0 2.6-1.6 4.4-1.6 7 0z" />
    {:else if c === 'yellow'}
      <circle cx="10" cy="10" r="4.6" fill="none" stroke-width="1.6" />
      <circle cx="10" cy="10" r="1.6" />
    {:else if c === 'red'}
      <path d="M10 3.5 16.5 10 10 16.5 3.5 10z" fill="none" stroke-width="1.6" />
      <path d="M10 7.6 12.4 10 10 12.4 7.6 10z" />
    {:else if c === 'black'}
      <path d="M10 2.8 11.6 8.4 17.2 10 11.6 11.6 10 17.2 8.4 11.6 2.8 10 8.4 8.4z" />
    {:else if c === 'white'}
      <circle cx="10" cy="6.2" r="2.4" fill="none" stroke-width="1.3" />
      <circle cx="10" cy="13.8" r="2.4" fill="none" stroke-width="1.3" />
      <circle cx="6.2" cy="10" r="2.4" fill="none" stroke-width="1.3" />
      <circle cx="13.8" cy="10" r="2.4" fill="none" stroke-width="1.3" />
    {:else}
      <text x="10" y="14.6" text-anchor="middle">1</text>
    {/if}
  </svg>
</span>

<style>
  .tile {
    --face: #ccc;
    --mark: rgba(237, 228, 212, 0.85);
    display: block;
    width: var(--t, 2.4cqw);
    height: var(--t, 2.4cqw);
    border-radius: 2px;
    background: var(--face);
    box-sizing: border-box;
    position: relative;
  }
  /* Glazed: a lighter top-left and a darker bottom-right edge, drawn inside the tile. */
  .tile::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 45%, rgba(0, 0, 0, 0.16));
    pointer-events: none;
  }
  svg {
    position: absolute;
    inset: 12%;
    width: 76%;
    height: 76%;
    fill: var(--mark);
    stroke: var(--mark);
  }
  text {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 13px;
    fill: var(--mark);
  }
  .blue {
    --face: #1f4f8f;
  }
  .yellow {
    --face: #d9a22b;
    --mark: rgba(60, 36, 4, 0.7);
  }
  .red {
    --face: #b4472c;
  }
  .black {
    --face: #23201f;
    --mark: rgba(127, 184, 192, 0.9);
  }
  .white {
    --face: #ece4d2;
    --mark: #1f4f8f;
  }
  .first {
    --face: var(--accent-on-dark);
    --mark: #1a1008;
  }
  .ghost {
    opacity: 0.17;
  }
  .ghost::after {
    display: none;
  }
  .fresh {
    animation: glow 1.6s ease-out 1;
  }
  @keyframes glow {
    0% {
      outline: 0.25cqw solid rgba(232, 134, 58, 0.95);
      outline-offset: 0;
    }
    100% {
      outline: 0.25cqw solid rgba(232, 134, 58, 0);
      outline-offset: 0.6cqw;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fresh {
      animation: none;
      outline: 2px solid var(--accent-on-dark);
    }
  }
</style>
