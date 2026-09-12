<script lang="ts">
  import ConfidenceChip from './ConfidenceChip.svelte';
  import type { Confidence } from './types';
  import { say, type Depth, type Dual } from './study';
  let { question, claim, confidence, depth = 'research' }:
    { question: string; claim: Dual; confidence: Confidence; depth?: Depth } = $props();
</script>

<dl class="fs-qc">
  <dt>Question</dt>
  <dd><p class="fs-question">{question}</p></dd>
  <dt class="claim">Claim</dt>
  <dd style="display:flex;align-items:flex-start;gap:14px">
    <p class="fs-claim" style="flex:1">{@html say(claim, depth)}</p>
    <ConfidenceChip level={confidence} />
  </dd>
</dl>
