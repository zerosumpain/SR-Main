<script lang="ts">
  // Background effect layer — hosts one Three.js simulation from
  // $lib/presentation/effect-sims.ts (or the site's live ECG heartbeat)
  // behind the slide's content. Three loads dynamically (same pattern as the
  // federation embed) so decks without effects never pay for it. Transition-
  // role blocks render nothing here — the player plays those via
  // TransitionFx. Honors prefers-reduced-motion (static).
  import { onMount } from 'svelte';
  import Ecg from '$lib/components/shared/Ecg.svelte';
  import { TINT_COLORS, type EffectTint } from '$lib/presentation/effects';
  import { SIM_BUILDERS } from '$lib/presentation/effect-sims';
  import type { EffectBlock } from '$lib/presentation/types';

  let { block }: { block: EffectBlock } = $props();

  const intensity = $derived(Math.min(1, Math.max(0.1, block.intensity ?? 0.5)));
  const tint = $derived(TINT_COLORS[(block.tint ?? 'ink') as EffectTint]);

  let host: HTMLDivElement | undefined; // plain let — render target handle

  onMount(() => {
    if (block.role !== 'background' || block.effect === 'heartbeat' || !host) return;
    const builder = SIM_BUILDERS[block.effect];
    if (!builder) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let disposed = false;
    let raf = 0;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const THREE = await import('three');
      if (disposed || !host) return;

      const w = host.clientWidth || 800;
      const h = host.clientHeight || 500;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
      camera.position.z = 10;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      host.appendChild(renderer.domElement);

      const sim = builder({ THREE, scene, camera, w, h, tint, intensity });

      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        sim.tick(now, dt);
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const onResize = () => {
        if (!host) return;
        const nw = host.clientWidth || w;
        const nh = host.clientHeight || h;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener('resize', onResize);

      cleanup = () => {
        window.removeEventListener('resize', onResize);
        cancelAnimationFrame(raf);
        sim.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  });
</script>

{#if block.role === 'background'}
  <div class="fx" bind:this={host} style:opacity={block.effect === 'heartbeat' ? 0.16 + intensity * 0.3 : 1} aria-hidden="true">
    {#if block.effect === 'heartbeat'}
      <Ecg fullbleed showGrid={false} />
    {/if}
  </div>
{/if}

<style>
  .fx {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .fx :global(canvas),
  .fx :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
