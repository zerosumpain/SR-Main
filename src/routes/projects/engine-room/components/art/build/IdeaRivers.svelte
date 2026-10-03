<script lang="ts">
  // IdeaRivers — every channel that can file a backlog idea, drawn as a stream falling into
  // one queue. The point is the shape: many ways in, exactly one way through.
  //
  // The channel names are HTML, so they stay legible on a phone; the drawing beneath carries
  // no text at all. Picking a channel lights its stream and names it. Ideas travel the streams
  // while the drawing is on screen, unless the reader has asked for reduced motion.
  import { onMount } from 'svelte';
  import { inView } from '../../../lib/motion';
  import { still } from '../../../lib/motion';

  interface Props {
    sources: Array<{ id: string; label: string }>;
    /** Optional sentence under the picked channel. */
    note?: (id: string) => string;
  }
  let { sources, note }: Props = $props();

  const W = 900, H = 230;
  const QX = W / 2, QY = 188;
  const n = $derived(sources.length);
  const x = (i: number) => ((i + 0.5) / n) * W;
  const path = (i: number) => {
    const sx = x(i), off = (i - (n - 1) / 2) * 7;
    return `M ${sx} 0 C ${sx} ${H * 0.45}, ${QX + off} ${H * 0.4}, ${QX + off} ${QY - 34}`;
  };

  let picked = $state<string | null>(null);
  let svg: SVGSVGElement | undefined = $state();
  let moving = $state(false);
  onMount(() => {
    if (still() || !svg) return;
    moving = true;
    return inView(svg, () => { svg?.unpauseAnimations(); return () => svg?.pauseAnimations(); }, { amount: 0 });
  });
</script>

<div class="rivers" class:focused={!!picked} style="--n:{n}">
  <div class="chips" role="group" aria-label="Where ideas come from">
    {#each sources as s, i (s.id)}
      <button class="chip" class:on={picked === s.id} aria-pressed={picked === s.id}
              onclick={() => (picked = picked === s.id ? null : s.id)}
              onpointerenter={() => (picked = s.id)}>
        <span class="c-dot" style="--i:{i}"></span>{s.label}
      </button>
    {/each}
  </div>

  <svg bind:this={svg} viewBox="0 0 {W} {H + 40}" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    {#each sources as s, i (s.id)}
      <path class="stream" class:on={picked === s.id} d={path(i)} />
      {#if moving}
        {#each [0, 1] as k}
          <rect class="idea" class:on={picked === s.id} x="-7" y="-5" width="14" height="10" rx="2">
            <animateMotion dur="{3.2 + (i % 3) * 0.5}s" begin="{-(i * 0.7 + k * 1.7)}s" repeatCount="indefinite" path={path(i)} rotate="auto" />
          </rect>
        {/each}
      {/if}
    {/each}
    <g class="queue">
      <path class="funnel" d="M {QX - 90} {QY - 40} L {QX + 90} {QY - 40} L {QX + 40} {QY} L {QX - 40} {QY} Z" />
      {#each Array(4) as _, i}
        <rect class="tkt" x={QX - 70} y={QY + 8 + i * 16} width="140" height="11" rx="2" style="opacity:{1 - i * 0.2}" />
      {/each}
    </g>
  </svg>

  <p class="caption" aria-live="polite">
    {#if picked}
      {@const s = sources.find((x) => x.id === picked)}
      <b>{s?.label}</b>{note ? ` — ${note(picked)}` : ''}
    {:else}
      {n} ways in, one queue. Pick a channel to follow it.
    {/if}
  </p>
</div>

<style>
  .rivers { min-width: 0; }
  .chips { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 6px; }
  .chip { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; padding: 10px 6px; cursor: pointer;
    background: var(--lift); border: 1px solid var(--rule); border-radius: var(--radius-sharp); color: var(--fg-2);
    font-family: var(--er-body); font-size: var(--fs-label); line-height: 1.3; transition: border-color 0.2s, color 0.2s, background 0.2s; }
  .chip:hover, .chip.on { border-color: var(--tone); color: var(--fg); }
  .chip.on { background: color-mix(in srgb, var(--tone) 14%, var(--lift)); }
  .c-dot { width: 10px; height: 10px; border-radius: var(--radius-pill); background: var(--tone); }
  svg { display: block; width: 100%; height: auto; margin-top: -2px; }
  .stream { fill: none; stroke: var(--rule-strong); stroke-width: 3; transition: stroke 0.3s, opacity 0.3s, stroke-width 0.3s; }
  .stream.on { stroke: var(--tone); stroke-width: 5; }
  .focused .stream:not(.on) { opacity: 0.35; }
  .idea { fill: var(--tone); }
  .focused .idea:not(.on) { opacity: 0.25; }
  .funnel { fill: var(--tone); }
  .tkt { fill: var(--fg); }
  .caption { margin: 6px 0 0; text-align: center; font-size: var(--fs-body-sm); color: var(--fg-2); min-height: 1.6em; }
  .caption b { color: var(--tone-text); }
  @media (max-width: 720px) {
    .chips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .chip { flex-direction: row; text-align: left; }
  }
</style>
