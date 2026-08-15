<script lang="ts">
  // Motion figure — a site-hosted file plays in a native <video>; YouTube and
  // Vimeo render as privacy-enhanced embeds (nocookie / dnt). Anything else
  // was already rejected by the registry; the fallback chip is for stale data.
  import { parseVideoSrc } from '$lib/presentation/video';
  import type { VideoBlock } from '$lib/presentation/types';

  let { block }: { block: VideoBlock } = $props();

  const source = $derived(parseVideoSrc(block.src));
  const auto = $derived(block.autoplay ?? false);
</script>

<figure class="vid">
  {#if source?.kind === 'file'}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      src={source.src}
      poster={block.poster}
      controls
      autoplay={auto}
      muted={auto}
      loop={block.loop ?? false}
      playsinline
      preload="metadata"
    ></video>
  {:else if source?.kind === 'youtube'}
    <div class="vid-frame">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${source.id}?rel=0${auto ? '&autoplay=1&mute=1' : ''}${block.loop ? `&loop=1&playlist=${source.id}` : ''}`}
        title={block.caption ?? 'Video'}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowfullscreen
        loading="lazy"
      ></iframe>
    </div>
  {:else if source?.kind === 'vimeo'}
    <div class="vid-frame">
      <iframe
        src={`https://player.vimeo.com/video/${source.id}?dnt=1${auto ? '&autoplay=1&muted=1' : ''}${block.loop ? '&loop=1' : ''}`}
        title={block.caption ?? 'Video'}
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>
    </div>
  {:else}
    <div class="vid-bad">unplayable video source</div>
  {/if}
  {#if block.caption}<figcaption>{block.caption}</figcaption>{/if}
</figure>

<style>
  .vid {
    margin: 0;
    width: 100%;
    max-width: 880px;
  }
  .vid video {
    display: block;
    width: 100%;
    max-height: 460px;
    background: #000;
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-radius: var(--radius-round);
  }
  .vid-frame {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-radius: var(--radius-round);
    overflow: hidden;
    background: #000;
  }
  .vid-frame iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .vid figcaption,
  .vid-bad {
    margin-top: 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
</style>
