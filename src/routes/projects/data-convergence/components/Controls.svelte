<script lang="ts">
  import type { ResolvedModel, ZoomLevel } from '../lib/types';
  import { ZOOM_SPECS } from '../lib/types';

  interface Props {
    model: ResolvedModel;
    playhead: number;
    playing: boolean;
    speed: number;
    zoom: ZoomLevel;
    onChange: (next: { playhead?: number; playing?: boolean; speed?: number; zoom?: ZoomLevel }) => void;
  }
  let { model, playhead, playing, speed, zoom, onChange }: Props = $props();

  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
  const ZOOMS: ZoomLevel[] = ['6m', '1y', '10y', 'adult'];

  let scrubRef: HTMLDivElement;
  let scrubbing = $state(false);

  function fmt(t: number): string {
    return new Date(t).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  function pct(): number {
    const r = model.tEnd - model.tStart;
    if (r <= 0) return 0;
    return ((playhead - model.tStart) / r) * 100;
  }

  function startScrub(e: PointerEvent) {
    scrubbing = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    onChange({ playing: false });
    moveScrub(e);
  }
  function moveScrub(e: PointerEvent) {
    if (!scrubbing) return;
    if (!scrubRef) return;
    const r = scrubRef.getBoundingClientRect();
    const ratio = clamp01((e.clientX - r.left) / r.width);
    const t = model.tStart + ratio * (model.tEnd - model.tStart);
    onChange({ playhead: t });
  }
  function endScrub(e: PointerEvent) {
    if (scrubbing) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    scrubbing = false;
  }

  function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }
</script>

<div class="ctl-bar">
  <div class="zooms" role="group" aria-label="Zoom level">
    {#each ZOOMS as z}
      <button
        type="button"
        class:active={zoom === z}
        onclick={() => onChange({ zoom: z })}
        title={ZOOM_SPECS[z].desc}
      >
        {ZOOM_SPECS[z].label}
      </button>
    {/each}
  </div>

  <div class="play-row">
    <button class="btn play" onclick={() => onChange({ playing: !playing })} aria-label={playing ? 'Pause' : 'Play'}>
      {#if playing}
        <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2" width="3.5" height="12" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor"/></svg>
      {:else}
        <svg viewBox="0 0 16 16" width="14" height="14"><polygon points="3,2 13,8 3,14" fill="currentColor"/></svg>
      {/if}
    </button>

    <button class="btn" title="Restart" onclick={() => onChange({ playhead: model.tStart })} aria-label="Restart">
      <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3a5 5 0 1 1-4.9 6h1.6A3.5 3.5 0 1 0 8 4.5V6L4 4l4-2v1zM2.5 3.5h1V6h-1z" fill="currentColor"/></svg>
    </button>

    <div class="scrub-wrap">
      <div
        class="scrub"
        bind:this={scrubRef}
        onpointerdown={startScrub}
        onpointermove={moveScrub}
        onpointerup={endScrub}
        onpointercancel={endScrub}
        role="slider"
        aria-label="Timeline scrubber"
        aria-valuemin={model.tStart}
        aria-valuemax={model.tEnd}
        aria-valuenow={playhead}
        tabindex="0"
      >
        <div class="scrub-track"></div>
        <div class="scrub-fill" style="width:{pct()}%"></div>
        <div class="scrub-thumb" style="left:{pct()}%">
          <span class="thumb-label">{fmt(playhead)}</span>
        </div>
      </div>
    </div>

    <div class="speed">
      <span class="lab">×</span>
      <select
        value={speed}
        onchange={(e) => onChange({ speed: Number((e.currentTarget as HTMLSelectElement).value) })}
        aria-label="Playback speed"
      >
        {#each SPEEDS as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </div>
  </div>
</div>

<style>
  .ctl-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 18px;
    background: var(--paper);
    border-top: 1px solid rgba(28, 22, 17, 0.12);
    color: var(--ink);
    font-family: 'DM Sans', system-ui, sans-serif;
  }

  /* Zoom buttons sit on the left, then play row stretches across the rest. */
  .zooms {
    display: inline-flex;
    gap: 2px;
    background: rgba(28, 22, 17, 0.06);
    padding: 3px;
    border-radius: var(--radius-round);
    flex-shrink: 0;
  }
  .zooms button {
    background: transparent;
    border: none;
    color: var(--ink);
    padding: 6px 10px;
    border-radius: var(--radius-round);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.14s, color 0.14s;
  }
  .zooms button:hover { background: rgba(28, 22, 17, 0.08); }
  .zooms button.active {
    background: var(--ink);
    color: var(--paper);
  }

  .play-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .btn {
    height: 34px;
    min-width: 34px;
    padding: 0 8px;
    border: 1px solid rgba(28, 22, 17, 0.18);
    background: rgba(255, 255, 255, 0.35);
    color: var(--ink);
    border-radius: var(--radius-round);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.14s, transform 0.06s;
    flex-shrink: 0;
  }
  .btn:hover { background: rgba(255,255,255,0.7); }
  .btn:active { transform: scale(0.97); }
  .btn.play {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .btn.play:hover { background: #2c241c; }

  .scrub-wrap { flex: 1; min-width: 120px; }
  .scrub {
    position: relative;
    height: 34px;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    padding: 14px 0;
  }
  .scrub-track {
    position: absolute;
    inset: 16px 0 16px 0;
    background: rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-sharp);
  }
  .scrub-fill {
    position: absolute;
    top: 16px;
    bottom: 16px;
    left: 0;
    background: var(--ink);
    border-radius: var(--radius-sharp);
    pointer-events: none;
  }
  .scrub-thumb {
    position: absolute;
    top: 4px;
    width: 14px;
    height: 24px;
    transform: translateX(-50%);
    background: var(--ink);
    border-radius: var(--radius-sharp);
    pointer-events: none;
  }
  .thumb-label {
    position: absolute;
    bottom: -22px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    white-space: nowrap;
    color: rgba(28, 22, 17, 0.72);
  }

  .speed {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: rgba(28, 22, 17, 0.7);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
    flex-shrink: 0;
  }
  .speed select {
    background: rgba(255,255,255,0.5);
    border: 1px solid rgba(28, 22, 17, 0.2);
    color: var(--ink);
    padding: 5px 6px;
    border-radius: var(--radius-round);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  @media (max-width: 720px) {
    .ctl-bar { flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 12px; }
    .zooms { justify-content: center; }
    .play-row { gap: 8px; }
    .btn { height: 38px; min-width: 38px; }
    .thumb-label { font-size: 10px; }
  }
</style>
