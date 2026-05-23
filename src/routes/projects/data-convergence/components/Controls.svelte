<script lang="ts">
  import type { ResolvedModel } from '../lib/types';

  interface Props {
    model: ResolvedModel;
    playhead: number;
    playing: boolean;
    speed: number; // 1 = baseline
    onChange: (next: { playhead?: number; playing?: boolean; speed?: number }) => void;
  }
  let { model, playhead, playing, speed, onChange }: Props = $props();

  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

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

<style>
  .ctl-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    background: var(--paper, #f1ead6);
    border-top: 1px solid rgba(28, 22, 17, 0.12);
    color: var(--ink, #1c1611);
    font-family: 'DM Sans', system-ui, sans-serif;
  }
  .btn {
    height: 36px;
    min-width: 36px;
    padding: 0 8px;
    border: 1px solid rgba(28, 22, 17, 0.18);
    background: rgba(255, 255, 255, 0.35);
    color: var(--ink);
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.14s, transform 0.06s;
  }
  .btn:hover { background: rgba(255,255,255,0.7); }
  .btn:active { transform: scale(0.97); }
  .btn.play {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .btn.play:hover {
    background: #2c241c;
  }

  .scrub-wrap { flex: 1; min-width: 120px; }
  .scrub {
    position: relative;
    height: 36px;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    padding: 14px 0;
  }
  .scrub-track {
    position: absolute;
    inset: 16px 0 16px 0;
    background: rgba(28, 22, 17, 0.18);
    border-radius: 3px;
  }
  .scrub-fill {
    position: absolute;
    top: 16px;
    bottom: 16px;
    left: 0;
    background: var(--ink);
    border-radius: 3px;
    pointer-events: none;
  }
  .scrub-thumb {
    position: absolute;
    top: 6px;
    width: 14px;
    height: 24px;
    transform: translateX(-50%);
    background: var(--ink);
    border-radius: 3px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.18);
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
  }
  .speed select {
    background: rgba(255,255,255,0.5);
    border: 1px solid rgba(28, 22, 17, 0.2);
    color: var(--ink);
    padding: 6px 8px;
    border-radius: 5px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  @media (max-width: 640px) {
    .ctl-bar { padding: 10px 12px; gap: 8px; }
    .btn { height: 40px; min-width: 40px; }
    .thumb-label { font-size: 10px; }
  }
</style>
