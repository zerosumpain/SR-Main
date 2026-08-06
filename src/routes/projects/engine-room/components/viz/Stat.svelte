<script lang="ts">
  // Stat — one measured number, with the command that produced it kept on the tile.
  // Every figure in this study was counted rather than estimated; the provenance is not
  // decoration, it is the thing that makes the number worth printing.
  interface Props {
    value: string | number;
    unit?: string;
    label: string;
    /** How it was measured. Shown on hover/focus and to screen readers. */
    how?: string;
    tone?: string;
    /** Bigger treatment for the one number that matters most on a page. */
    lead?: boolean;
  }
  let { value, unit, label, how, tone = 'var(--accent-ink)', lead = false }: Props = $props();
  const shown = $derived(typeof value === 'number' ? value.toLocaleString('en-GB') : value);
</script>

<div class="stat" class:lead style="--tone:{tone}" title={how}>
  <b class="s-val">{shown}{#if unit}<span class="s-unit">{unit}</span>{/if}</b>
  <span class="s-lab">{label}</span>
  {#if how}<span class="s-how">{how}</span>{/if}
</div>

<style>
  .stat { --tone: var(--accent-ink); border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid var(--tone);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(255,255,255,0.55);
    padding: 10px 13px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .s-val { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 21px; line-height: 1.05;
    color: var(--text-primary); letter-spacing: -0.02em; }
  .lead .s-val { font-size: 30px; }
  .s-unit { font-size: 0.55em; font-weight: 500; color: rgba(28,22,17,0.55); margin-left: 2px; }
  .s-lab { font-size: 12px; line-height: 1.4; color: rgba(28,22,17,0.74); }
  .s-how { font-family: 'JetBrains Mono', monospace; font-size: 9px; line-height: 1.4;
    color: rgba(28,22,17,0.42); overflow-wrap: anywhere; margin-top: 2px; }
</style>
