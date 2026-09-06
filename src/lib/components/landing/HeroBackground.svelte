<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { HeroBackgroundAsset, HeroBackgroundSettings } from '$lib/constants/hero-background';

  let { settings, asset }: { settings: HeroBackgroundSettings; asset: HeroBackgroundAsset } = $props();
  let video = $state<HTMLVideoElement>();
  let layer: HTMLDivElement;
  let source = $state('');
  let phase = $state<'waiting' | 'playing' | 'holding' | 'fading' | 'settled' | 'poster' | 'failed'>('waiting');
  let userPaused = $state(false);
  let inView = true;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  let watchdog: ReturnType<typeof setTimeout>;
  let opacity = $derived(
    phase === 'waiting' || phase === 'failed' ? 0 :
    ['fading', 'settled', 'poster'].includes(phase) ? 1 - settings.finalTransparency / 100 : settings.playingOpacity / 100,
  );
  let overTitle = $derived(settings.overlayTitle && (phase === 'settled' || phase === 'poster'));

  function usePoster() {
    clearTimeout(timer);
    clearTimeout(watchdog);
    video?.pause();
    phase = 'poster';
    source = '';
  }

  function finish() {
    if (phase !== 'playing') return;
    clearTimeout(watchdog);
    video?.pause();
    phase = 'holding';
    timer = setTimeout(() => {
      phase = 'fading';
      timer = setTimeout(() => { phase = 'settled'; }, settings.fadeMs);
    }, settings.holdMs);
  }

  async function resume() {
    if (disposed || userPaused || !inView || document.hidden || !source || !video) return;
    try {
      await video.play();
      if (disposed || userPaused || !inView || document.hidden) video?.pause();
    } catch (error) {
      // Scrolling away or pressing Pause can interrupt an outstanding play().
      // That is normal suspension; it must remain resumable when visible again.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!disposed && phase !== 'poster') usePoster();
    }
  }

  function togglePause() {
    userPaused = !userPaused;
    if (userPaused) video?.pause();
    else void resume();
  }

  onMount(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    function visibility() {
      if (document.hidden) video?.pause();
      else if (phase === 'playing' || phase === 'waiting') void resume();
    }
    function preference() { if (motion.matches) usePoster(); }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (!inView) video?.pause();
      else if (phase === 'playing' || phase === 'waiting') void resume();
    });
    observer.observe(layer);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', preference);
    if (motion.matches || saveData) usePoster();
    else {
      // Start after the first painted hero, without preloading a video into the critical path.
      timer = setTimeout(async () => {
        source = matchMedia('(max-width: 640px)').matches ? asset.mobile : asset.desktop;
        await tick();
        if (disposed || !video) return;
        video.muted = true;
        video.playbackRate = settings.playbackRate;
        watchdog = setTimeout(usePoster, 15000);
        void resume();
      }, settings.delayMs);
    }
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      video?.pause();
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', preference);
    };
  });
</script>

<div bind:this={layer} class="hero-animation" class:over-title={overTitle} data-phase={phase}
  style:opacity style:--fade="{settings.fadeMs}ms" style:--fit={settings.fit}
  style:--position="{settings.positionX}% {settings.positionY}%" aria-hidden="true">
  {#if source}
    <video bind:this={video} src={source} muted playsinline preload="none" tabindex="-1"
      onplaying={() => { if (phase === 'waiting') phase = 'playing'; clearTimeout(watchdog); }}
      onended={finish} onerror={usePoster}></video>
  {:else if phase === 'poster'}
    <img src={asset.poster} alt="" onerror={() => { phase = 'failed'; }} />
  {/if}
</div>
{#if phase === 'playing'}
  <button type="button" class="animation-pause" onclick={togglePause} aria-pressed={userPaused}
    aria-label={userPaused ? 'Resume hero animation' : 'Pause hero animation'}>
    {userPaused ? 'Resume animation' : 'Pause animation'}
  </button>
{/if}

<style>
  .hero-animation { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .hero-animation[data-phase='fading'] { transition: opacity var(--fade) linear; }
  .hero-animation.over-title { z-index: 2; }
  video, img { width: 100%; height: 100%; object-fit: var(--fit); object-position: var(--position); }
  .animation-pause { position: absolute; z-index: 3; bottom: 12px; right: 16px; padding: 6px 10px;
    font-family: var(--font-body); font-size: var(--fs-label-xs); background: var(--bg);
    color: var(--text-primary); border: 1px solid var(--line-strong); cursor: pointer; }
  .animation-pause:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) { .hero-animation { transition: none !important; } }
</style>
