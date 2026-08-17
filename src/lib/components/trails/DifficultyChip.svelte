<script lang="ts">
  import { DIFFICULTY_LABELS, type DifficultyBand } from '$lib/trails/difficulty';

  let { band, title }: { band: DifficultyBand; title?: string } = $props();
</script>

<!-- Same hue logic as the site's confidence chips: petrol for benign, orange
     for warm, claret for the one that should give pause. -->
<span class="diff {band}" {title}>{DIFFICULTY_LABELS[band]}</span>

<style>
  .diff {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.15rem 0.45rem;
    border: 1px solid currentColor;
    line-height: 1.3;
  }
  .easy {
    color: var(--accent-ink);
  }
  .moderate {
    color: var(--text-secondary);
  }
  .hard {
    color: var(--accent);
  }
  .severe {
    color: #8a2d3a;
  }
</style>
