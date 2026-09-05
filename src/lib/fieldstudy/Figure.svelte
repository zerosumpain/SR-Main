<script lang="ts">
  // Numbered exhibit. The caption is where the author admits what it leaves out.
  import { say, type Depth, type Dual } from './study';
  let { no, caption, children, depth = 'research' }:
    { no: string; caption: Dual; children: any; depth?: Depth } = $props();
</script>

<figure class="fs-figure" style="margin-left:0;margin-right:0">
  {@render children()}
  <figcaption class="fs-figcaption">
    <span class="fs-figno">Fig. {no} —</span>
    <p>{say(caption, depth)}</p>
  </figcaption>
</figure>
