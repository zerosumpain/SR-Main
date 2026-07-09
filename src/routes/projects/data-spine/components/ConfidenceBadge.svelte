<script lang="ts">
  // ConfidenceBadge — FACT / HYPOTHESIS / CONTESTED chip (adapted from dfe-data-strategy;
  // this project uses a three-way honesty scale since the spine has no published design).
  import type { Confidence } from '../lib/types';

  interface Props {
    level: Confidence;
    label?: string;
    note?: string;
    small?: boolean;
  }
  let { level, label, note, small = false }: Props = $props();

  const META: Record<Confidence, { label: string; color: string; bg: string }> = {
    fact: { label: 'Fact', color: '#2f7d4f', bg: 'rgba(47,125,79,0.12)' },
    hypothesis: { label: 'Hypothesis', color: '#7a5aa6', bg: 'rgba(122,90,166,0.12)' },
    contested: { label: 'Contested', color: '#b4455e', bg: 'rgba(180,69,94,0.12)' },
  };
  const m = $derived(META[level] ?? META.hypothesis);
</script>

<span class="cb" class:small style="color:{m.color}; background:{m.bg}" title={note ?? ''}>
  <span class="dot" style="background:{m.color}"></span>{label ?? m.label}
</span>

<style>
  .cb {
    display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
    font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 6px; border-radius: var(--radius-round);
  }
  .cb.small { font-size: 8px; padding: 1px 4px; }
  .dot { width: 5px; height: 5px; border-radius: var(--radius-pill); display: inline-block; }
</style>
