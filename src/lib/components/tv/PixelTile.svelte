<script lang="ts">
  // A pixel mark on its own gradient square, the way the app icon draws the
  // SR: rounded cells in white on a hue ground. `art` is a tile's (pixel.ts);
  // without one it is the app icon itself, Prism's four-corner ground and the
  // bar under the mark. Sized by its container (width: 100%).
  import { PRISM_GROUND, SR_MARK, cells, type TileArt } from './pixel';

  let { art = null, label = '' }: { art?: TileArt | null; label?: string } = $props();

  // A gradient id per instance (several tiles share one page), the same on the server and in the browser.
  const id = $props.id();
  const uid = `pt${id}`;
  const grid = $derived(art?.grid ?? SR_MARK);
  const w = $derived(Math.max(...grid.map((r) => r.length)));
  const h = $derived(grid.length);
  // The mark fills 64% of the tile, centred; the logo leaves room for its bar.
  const cell = $derived(64 / Math.max(w, h + (art ? 0 : 2)));
  const x0 = $derived((100 - w * cell) / 2);
  const y0 = $derived((100 - (h + (art ? 0 : 2)) * cell) / 2);
</script>

<svg class="pixel-tile" viewBox="0 0 100 100" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}>
  <defs>
    {#if art}
      <linearGradient id="{uid}g" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color={art.hue.base} />
        <stop offset="1" stop-color={art.hue.glow} />
      </linearGradient>
    {:else}
      <!-- Four corners, as the icon renderer blends them: two horizontal blends, mixed vertically. -->
      <linearGradient id="{uid}t" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color={PRISM_GROUND[0]} />
        <stop offset="1" stop-color={PRISM_GROUND[1]} />
      </linearGradient>
      <linearGradient id="{uid}b" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color={PRISM_GROUND[2]} />
        <stop offset="1" stop-color={PRISM_GROUND[3]} />
      </linearGradient>
      <linearGradient id="{uid}m" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" />
        <stop offset="1" stop-color="#000" />
      </linearGradient>
      <mask id="{uid}k"><rect width="100" height="100" fill="url(#{uid}m)" /></mask>
    {/if}
    <radialGradient id="{uid}s" cx="0" cy="0" r="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.22" />
      <stop offset="0.75" stop-color="#fff" stop-opacity="0" />
    </radialGradient>
  </defs>
  {#if art}
    <rect width="100" height="100" fill="url(#{uid}g)" />
  {:else}
    <rect width="100" height="100" fill="url(#{uid}b)" />
    <rect width="100" height="100" fill="url(#{uid}t)" mask="url(#{uid}k)" />
  {/if}
  <rect width="100" height="100" fill="url(#{uid}s)" />
  {#each cells(grid) as [cx, cy] (`${cx},${cy}`)}
    <rect x={x0 + cx * cell + cell * 0.07} y={y0 + cy * cell + cell * 0.07} width={cell * 0.86} height={cell * 0.86} rx={cell * 0.2} fill="#fff" />
  {/each}
  {#if !art}
    <rect x={x0} y={y0 + (h + 1.2) * cell} width={w * cell} height={cell * 0.45} rx={cell * 0.22} fill="#fff" />
  {/if}
</svg>

<style>
  .pixel-tile {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1;
  }
</style>
