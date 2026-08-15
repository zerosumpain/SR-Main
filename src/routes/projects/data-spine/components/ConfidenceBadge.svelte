<script lang="ts">
  // The study's confidence chip, now rendered by the Field Study System's
  // primitive so every study on the site says "fact" in the same colour.
  //
  // What changed: this used to colour fact green (#2f7d4f), hypothesis purple
  // (#7a5aa6) and contested pink — three of the system's CATEGORICAL hues,
  // which are licensed only inside a legend and the marks that legend labels,
  // never on a claim. The shipped palette is petrol / orange / claret. The
  // radius was 4px, which is not one of the three allowed radii either.
  import ConfidenceChip from '$lib/fieldstudy/ConfidenceChip.svelte';
  import type { Confidence } from '$lib/fieldstudy/types';

  interface Props {
    level: Confidence;
    label?: string;
    /** Hover detail — what would move this. */
    note?: string;
    small?: boolean;
  }
  let { level, label, note, small = false }: Props = $props();
</script>

<span class="cb-wrap" class:small title={note ?? ''}>
  <ConfidenceChip {level} {label} />
</span>

<style>
  /* The chip itself is the system's; this only carries the hover affordance and
     the study's compact variant. */
  .cb-wrap {
    display: inline-flex;
    vertical-align: middle;
  }
  .cb-wrap.small :global(.fs-chip) {
    padding: 1px 5px;
    letter-spacing: 0.08em;
  }
</style>
