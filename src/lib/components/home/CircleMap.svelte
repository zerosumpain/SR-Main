<script lang="ts">
  // Where the sharing household is, on a map — the Family Circle's view.
  //
  // Tiles are plain <img> elements, as on /apple-app's map, not a WebGL library:
  // the site CSP already allows https images, a map library would need
  // connect-src and blob: workers, and a still picture of five dots does not
  // need one. Each tile sends only the ORIGIN as referrer, which the URL-
  // restricted Mapbox token needs; with no token (or no answer) the dots draw on
  // a plain ground and still say where everyone is relative to each other.
  //
  // Positions come from the page load, already filtered to people who share,
  // and rounded to ~11 m there.
  import { onMount } from 'svelte';

  type Position = { subject: string; label: string; lat: number; lon: number; at: string; isHome: boolean | null };
  let { positions }: { positions: Position[] } = $props();

  const TILE = 512;
  const HEIGHT = 360;
  const PAD = 48;
  const MAX_ZOOM = 16;
  const MAX_LAT = 85.0511287798;

  let width = $state(0);
  let tileUrl = $state<((z: number, x: number, y: number) => string) | null>(null);

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  function project(lon: number, lat: number, z: number): [number, number] {
    const size = TILE * 2 ** z;
    const sin = Math.sin((clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180);
    return [((lon + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
  }

  /** The zoom and centre that fit every dot, in pixel space at that zoom. */
  const view = $derived.by(() => {
    if (!positions.length || width <= 0) return null;
    let zoom = MAX_ZOOM;
    for (; zoom > 2; zoom--) {
      const pts = positions.map((p) => project(p.lon, p.lat, zoom));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      if (Math.max(...xs) - Math.min(...xs) <= width - PAD * 2 && Math.max(...ys) - Math.min(...ys) <= HEIGHT - PAD * 2) break;
    }
    const pts = positions.map((p) => project(p.lon, p.lat, zoom));
    const cx = (Math.max(...pts.map((p) => p[0])) + Math.min(...pts.map((p) => p[0]))) / 2;
    const cy = (Math.max(...pts.map((p) => p[1])) + Math.min(...pts.map((p) => p[1]))) / 2;
    return { zoom, left: cx - width / 2, top: cy - HEIGHT / 2 };
  });

  const tiles = $derived.by(() => {
    if (!view || !tileUrl) return [];
    const n = 2 ** view.zoom;
    const out: { key: string; src: string; x: number; y: number }[] = [];
    for (let tx = Math.floor(view.left / TILE); tx <= Math.floor((view.left + width) / TILE); tx++) {
      for (let ty = Math.floor(view.top / TILE); ty <= Math.floor((view.top + HEIGHT) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        out.push({ key: `${view.zoom}/${tx}/${ty}`, src: tileUrl(view.zoom, wx, ty), x: tx * TILE - view.left, y: ty * TILE - view.top });
      }
    }
    return out;
  });

  const dots = $derived.by(() => {
    if (!view) return [];
    return positions.map((p) => {
      const [x, y] = project(p.lon, p.lat, view.zoom);
      return { ...p, x: x - view.left, y: y - view.top };
    });
  });

  function ago(iso: string): string {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/maps/config');
      if (!res.ok) return;
      const cfg = (await res.json()) as { accessToken?: string; style?: string };
      if (!cfg.accessToken) return;
      const style = (cfg.style ?? 'mapbox://styles/mapbox/outdoors-v12').replace('mapbox://styles/', '');
      const token = encodeURIComponent(cfg.accessToken);
      tileUrl = (z, x, y) => `https://api.mapbox.com/styles/v1/${style}/tiles/512/${z}/${x}/${y}?access_token=${token}`;
    } catch {
      // No streets under the dots: the map still says who is where relative to whom.
    }
  });
</script>

<div class="circle-map" bind:clientWidth={width} style:height="{HEIGHT}px" role="img" aria-label="Where the household is now">
  {#each tiles as t (t.key)}
    <img
      class="tile"
      src={t.src}
      alt=""
      width={TILE}
      height={TILE}
      style:left="{t.x}px"
      style:top="{t.y}px"
      referrerpolicy="strict-origin-when-cross-origin"
      loading="lazy"
      draggable="false"
    />
  {/each}
  {#each dots as d (d.subject)}
    <div class="dot" class:home={d.isHome} style:left="{d.x}px" style:top="{d.y}px">
      <span class="pin" aria-hidden="true"></span>
      <span class="name">{d.label}</span>
      <span class="when">{ago(d.at)}</span>
    </div>
  {/each}
  {#if !positions.length}
    <p class="empty">Nobody sharing a recent position.</p>
  {/if}
</div>
{#if tileUrl}
  <p class="credit">© Mapbox © OpenStreetMap</p>
{/if}

<style>
  .circle-map {
    position: relative;
    overflow: hidden;
    width: 100%;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
  }
  .tile {
    position: absolute;
    width: 512px;
    height: 512px;
    user-select: none;
  }
  .dot {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    pointer-events: none;
  }
  .pin {
    width: 14px;
    height: 14px;
    border-radius: 100px;
    background: var(--accent);
    border: 2px solid var(--bg);
  }
  .dot.home .pin {
    background: var(--accent-ink);
  }
  .name,
  .when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--bg);
    color: var(--text-primary);
    padding: 0 4px;
    border-radius: 2px;
    white-space: nowrap;
  }
  .when {
    color: var(--text-muted);
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .credit {
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-align: right;
  }
</style>
