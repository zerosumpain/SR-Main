<script lang="ts">
  import ConfidenceChip from './ConfidenceChip.svelte';
  import type { Confidence } from './types';
  let { question, claim, confidence }:
    { question: string; claim: string; confidence: Confidence } = $props();
</script>

<dl class="fs-qc">
  <dt>Question</dt>
  <dd><p class="fs-question">{question}</p></dd>
  <dt class="claim">Claim</dt>
  <dd style="display:flex;align-items:flex-start;gap:14px">
    <p class="fs-claim" style="flex:1">{@html claim}</p>
    <ConfidenceChip level={confidence} />
  </dd>
</dl>
