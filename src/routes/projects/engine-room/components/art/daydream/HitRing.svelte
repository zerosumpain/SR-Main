<script lang="ts">
  // HitRing — the one score that counts, as a dial: of the notes I rated, the share I called
  // useful. The arc winds up to the live figure the first time it is seen. With no live
  // figure the ring stays empty and the centre says so; a dash is honest, a zero would lie.
  import { shown } from '../../../lib/motion';
  import Counter from '../../kit/Counter.svelte';

  interface Props { rate: number | null; rated: number | null; windowDays: number }
  let { rate, rated, windowDays }: Props = $props();
  const pct = $derived(rate == null ? null : Math.round(rate * 100));
</script>

<div class="hr" {@attach shown({ amount: 0.4 })} role="img"
  aria-label={pct == null ? 'The live score is not available right now.' : `${pct} percent of the ${rated} notes I rated in the last ${windowDays} days were useful.`}>
  <svg viewBox="0 0 240 240" aria-hidden="true">
    {#each Array(40) as _, i}
      <line class="tick" class:on={pct != null && i < Math.round((pct / 100) * 40)} x1="120" y1="8" x2="120" y2="22" transform="rotate({i * 9} 120 120)" style="--d:{0.3 + i * 0.02}s" />
    {/each}
    <circle class="track" cx="120" cy="120" r="86" />
    <circle class="arc" cx="120" cy="120" r="86" pathLength="100" style="--v:{pct ?? 0}" />
  </svg>
  <div class="mid">
    <b><Counter value={pct} />{#if pct != null}<span>%</span>{/if}</b>
    <span>{pct == null ? 'not available right now' : 'were useful'}</span>
  </div>
</div>

<style>
  .hr { position: relative; width: 100%; max-width: 420px; aspect-ratio: 1; margin: 0 auto; }
  svg { width: 100%; height: 100%; display: block; transform: rotate(-90deg); }
  .tick { stroke: var(--rule-strong); stroke-width: 3; }
  .tick.on { stroke: var(--tone-text); }
  .track { fill: none; stroke: var(--rule); stroke-width: 22; }
  .arc { fill: none; stroke: var(--tone); stroke-width: 22; stroke-dasharray: var(--v) 100; transition: stroke-dasharray 1.8s var(--er-ease) 0.2s; }
  .hr:global([data-armed]:not([data-shown])) .arc { stroke-dasharray: 0 100; }
  .hr:global([data-armed]:not([data-shown])) .tick.on { stroke: var(--rule-strong); }
  .tick { transition: stroke 0.3s var(--d); }
  .mid { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; }
  .mid b { font-family: var(--er-display); font-weight: 400; font-size: clamp(54px, 8vw, 104px); line-height: 0.9; color: var(--fg); }
  .mid b span { font-size: max(0.45em, var(--fs-label-xs)); color: var(--tone-text); }
  .mid > span { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-3); max-width: 16ch; }
</style>
