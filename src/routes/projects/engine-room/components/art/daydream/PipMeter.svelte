<script lang="ts">
  // PipMeter — a small cap drawn as the pips it allows, so "at most six" is six things you
  // can count rather than a numeral to take on trust. They light one by one when seen.
  import { shown } from '../../../lib/motion';
  let { value, label, sub }: { value: number; label: string; sub?: string } = $props();
</script>

<div class="pm" {@attach shown({ amount: 0.5 })}>
  <b class="n">{value}</b>
  <div class="pips" aria-hidden="true">
    {#each Array(Math.min(value, 40)) as _, i}<span style="--d:{i * 0.06}s"></span>{/each}
  </div>
  <span class="l">{label}</span>
  {#if sub}<span class="s">{sub}</span>{/if}
</div>

<style>
  .pm { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 18px; align-items: center; padding: 18px 0; border-top: 1px solid var(--rule); }
  .n { grid-row: span 3; font-family: var(--er-display); font-weight: 400; font-size: clamp(44px, 5vw, 72px); line-height: 0.9; color: var(--tone-text); min-width: 2ch; text-align: right; }
  .pips { display: flex; flex-wrap: wrap; gap: 6px; }
  .pips span { width: 18px; height: 18px; border-radius: var(--radius-pill); background: var(--tone); transition: transform 0.4s var(--er-ease) var(--d), opacity 0.4s var(--d); }
  .pm:global([data-armed]:not([data-shown])) .pips span { transform: scale(0); opacity: 0; }
  .l { font-size: var(--fs-body-sm); color: var(--fg); }
  .s { font-size: var(--fs-label); color: var(--fg-3); }
</style>
