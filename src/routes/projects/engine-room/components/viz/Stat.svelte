<script lang="ts">
  // Stat — one figure, big, with what it counts underneath.
  //
  // A number counts up the first time it is seen (kit/Counter). A string is printed as it
  // comes: a time window or a range. Every figure on this study is read from code or the
  // database, never typed, so `how` is there for the rare tile that needs its source spelled out.
  import Counter from '../kit/Counter.svelte';

  interface Props {
    value: string | number | null | undefined;
    unit?: string;
    prefix?: string;
    places?: number;
    label: string;
    /** How it was measured. Shown on hover/focus and to screen readers. */
    how?: string;
    /** A colour override. Normally the page's part colour is right. */
    tone?: string;
    /** Bigger treatment for the one number that matters most on a page. */
    lead?: boolean;
  }
  let { value, unit, prefix, places = 0, label, how, tone, lead = false }: Props = $props();
</script>

<div class="stat" class:lead style={tone ? `--tone:${tone};--tone-text:${tone}` : ''} title={how}>
  <b class="s-val">{#if typeof value === 'number' || value == null}<Counter {value} {places} prefix={prefix ?? ''} />{:else}{value}{/if}{#if unit}<span class="s-unit">{unit}</span>{/if}</b>
  <span class="s-lab">{label}</span>
  {#if how}<span class="s-how">{how}</span>{/if}
</div>

<style>
  .stat { border-top: 2px solid var(--tone); padding: 12px 2px 4px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .s-val { font-family: var(--er-display); font-weight: 400; font-size: clamp(30px, 3vw, 42px); line-height: 0.95;
    color: var(--fg); letter-spacing: -0.01em; }
  .lead .s-val { font-size: clamp(44px, 5vw, 72px); color: var(--tone-text); }
  .s-unit { font-family: var(--er-mono); font-size: max(0.36em, var(--fs-label-xs)); font-weight: 500; color: var(--fg-3); margin-left: 4px; letter-spacing: 0; }
  .s-lab { font-size: var(--fs-label); line-height: 1.45; color: var(--fg-2); max-width: 30ch; }
  .s-how { font-family: var(--er-mono); font-size: var(--fs-label-xs); line-height: 1.4; color: var(--fg-3); overflow-wrap: anywhere; }
</style>
