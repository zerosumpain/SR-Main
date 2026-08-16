<script lang="ts">
  // The shipped three-level scale. Do not add levels.
  import { CONFIDENCE_LABEL, type Confidence } from './types';
  let { level, label }: { level: Confidence; label?: string } = $props();
</script>

<span class="fs-chip fs-chip--{level}">{label ?? CONFIDENCE_LABEL[level]}</span>
