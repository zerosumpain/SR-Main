<script lang="ts">
  // A place's photo, taped onto the card, with its Commons credit under it
  // (author, licence, a link to the file's page). A picture that fails to
  // load folds away rather than leaving a broken box.
  import type { PlaceImage } from '$lib/trips/model';
  import { creditLine } from '$lib/trips/decisions-view';

  let { image, alt, compact = false }: { image: PlaceImage; alt: string; compact?: boolean } = $props();
  let failed = $state(false);
</script>

{#if !failed}
  <figure class="photo np-taped" class:compact>
    <img
      src={image.url}
      {alt}
      loading="lazy"
      decoding="async"
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      onerror={() => (failed = true)}
    />
    <figcaption><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">{creditLine(image)}</a></figcaption>
  </figure>
{/if}

<style>
  .photo {
    --np-tape-tilt: 2deg;
    margin: 4px 0 8px;
  }
  img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 180px;
    object-fit: cover;
    border: 1px solid var(--line-strong);
    background: var(--bg-section);
  }
  .compact img {
    max-height: 120px;
  }
  figcaption {
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
  }
  figcaption a {
    color: var(--np-ink-soft, var(--text-secondary));
    text-decoration: underline dotted;
    text-underline-offset: 2px;
  }
</style>
