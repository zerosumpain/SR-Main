<script lang="ts">
  // ConfidenceBadge — a small, consistent chip for "how settled is this?". Extends the
  // engine's existing per-lever taxonomy (high/medium/low/assumption) with a 'contested'
  // state for live disagreements. Used on levers, analyses and contradictions so the whole
  // interactive speaks one confidence language. Self-contained.
  import type { ConfidenceLevel } from '../lib/types';

  interface Props {
    level: ConfidenceLevel;
    /** Optional override label. */
    label?: string;
    /** Optional hover note (e.g. "what would move this"). */
    note?: string;
    small?: boolean;
  }
  let { level, label, note, small = false }: Props = $props();

  const META: Record<ConfidenceLevel, { label: string; color: string; bg: string }> = {
    high:       { label: 'Well-evidenced', color: '#2f7d4f', bg: 'rgba(47,125,79,0.12)' },
    medium:     { label: 'Moderate',       color: '#9a7b1f', bg: 'rgba(154,123,31,0.12)' },
    low:        { label: 'Weak evidence',  color: '#b4632e', bg: 'rgba(180,99,46,0.12)' },
    assumption: { label: 'Assumption',     color: '#7a5aa6', bg: 'rgba(122,90,166,0.12)' },
    contested:  { label: 'Contested',      color: '#b4455e', bg: 'rgba(180,69,94,0.12)' },
  };
  const m = $derived(META[level] ?? META.assumption);
</script>

<span class="cb" class:small style="color:{m.color}; background:{m.bg}" title={note ?? ''}>
  <span class="dot" style="background:{m.color}"></span>{label ?? m.label}
</span>

<style>
  .cb {
    display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
    font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 6px; border-radius: 4px;
  }
  .cb.small { font-size: 8px; padding: 1px 4px; }
  .dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
</style>
