<script lang="ts">
  // The study's evidence chip, now rendered by the Field Study System's
  // primitive so every study on the site says "well-evidenced" in the same
  // colour.
  //
  // Two scales meet here and both are kept. This study grades EVIDENCE on a
  // five-point scale (high / medium / low / assumption / contested), which is a
  // real distinction on a lever and is not thrown away — it still supplies the
  // words. The system grades the KIND OF STATEMENT on three levels, and that is
  // what supplies the colour, via toConfidence's deliberately conservative
  // mapping: anything short of well-evidenced reads as a hypothesis.
  //
  // What changed: the old palette coloured these with categorical hues
  // (#7a5aa6 assumption, #9a7b1f moderate, #2f7d4f high) which the system
  // licenses only inside a legend, never on a claim; and the radius was 4px,
  // which is not one of the three allowed radii.
  import ConfidenceChip from '$lib/fieldstudy/ConfidenceChip.svelte';
  import { toConfidence } from '$lib/fieldstudy/types';
  import type { ConfidenceLevel } from '$lib/dfe-data-strategy/types';

  interface Props {
    level: ConfidenceLevel;
    /** Optional override label. */
    label?: string;
    /** Optional hover note (e.g. "what would move this"). */
    note?: string;
    small?: boolean;
  }
  let { level, label, note, small = false }: Props = $props();

  const WORDS: Record<string, string> = {
    high: 'Well-evidenced',
    medium: 'Moderate',
    low: 'Weak evidence',
    assumption: 'Assumption',
    contested: 'Contested',
  };
  const text = $derived(label ?? WORDS[level] ?? 'Assumption');
  const tone = $derived(toConfidence(level));
</script>

<span class="cb-wrap" class:small title={note ?? ''}>
  <ConfidenceChip level={tone} label={text} />
</span>

<style>
  .cb-wrap {
    display: inline-flex;
    vertical-align: middle;
  }
  .cb-wrap.small :global(.fs-chip) {
    padding: 1px 5px;
    letter-spacing: 0.08em;
  }
</style>
