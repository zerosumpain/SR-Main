<script lang="ts">
  // Asides live in italic serif in the margin column — not grey sans in the body.
  let { label, children }: { label?: string; children: any } = $props();
</script>

<div>
  {#if label}<span class="fs-margin-label">{label}</span>{/if}
  <p class="fs-aside" style="margin-top:{label ? '5px' : '0'}">{@render children()}</p>
</div>
