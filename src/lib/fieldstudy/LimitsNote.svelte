<script lang="ts">
  // Mandatory on every instrument. An instrument that cannot state its own
  // limits does not ship.
  let { children }: { children: any } = $props();
</script>

<p style="font-size:var(--fs-label);line-height:1.55;color:var(--text-muted);margin:0;border-left:3px solid var(--accent-ink);padding-left:12px;font-family:var(--font-body)">
  {@render children()}
</p>
