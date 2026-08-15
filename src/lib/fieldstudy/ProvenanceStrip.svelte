<script lang="ts">
  // Mandatory on T2. Provenance is on the page, never only in the footer.
  let { asOf, children }: { asOf: string; children: any } = $props();
</script>

<div class="fs-provenance">
  <span class="label">Provenance</span>
  <p>{@render children()} <span style="color:var(--text-ghost)">As of {asOf}.</span></p>
</div>
