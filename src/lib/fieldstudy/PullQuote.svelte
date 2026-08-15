<script lang="ts">
  // One per page. 44ch measure, on 2px rules. The line you want quoted back.
  let { children }: { children: any } = $props();
</script>

<blockquote class="fs-pull"><p>{@render children()}</p></blockquote>
