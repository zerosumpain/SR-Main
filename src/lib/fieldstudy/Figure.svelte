<script lang="ts">
  // Numbered exhibit. The caption is where the author admits what it leaves out.
  let { no, caption, children }: { no: string; caption: string; children: any } = $props();
</script>

<figure class="fs-figure" style="margin-left:0;margin-right:0">
  {@render children()}
  <figcaption class="fs-figcaption">
    <span class="fs-figno">Fig. {no} —</span>
    <p>{caption}</p>
  </figcaption>
</figure>
