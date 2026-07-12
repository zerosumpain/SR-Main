<script lang="ts">
  // Background effect layer — Three.js particle simulations (drift/starfield)
  // or the site's live ECG heartbeat, rendered behind the slide's content.
  // Three loads dynamically (same pattern as the federation embed) so decks
  // without effects never pay for it. Transition-role blocks render nothing
  // here — the player plays those. Honors prefers-reduced-motion (static).
  import { onMount } from 'svelte';
  import Ecg from '$lib/components/shared/Ecg.svelte';
  import { TINT_COLORS, type EffectTint } from '$lib/presentation/effects';
  import type { EffectBlock } from '$lib/presentation/types';

  let { block }: { block: EffectBlock } = $props();

  const intensity = $derived(Math.min(1, Math.max(0.1, block.intensity ?? 0.5)));
  const tint = $derived(TINT_COLORS[(block.tint ?? 'ink') as EffectTint]);

  let host: HTMLDivElement | undefined; // plain let — render target handle

  onMount(() => {
    if (block.role !== 'background' || block.effect === 'heartbeat' || !host) return;
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

      const starfield = block.effect === 'starfield';
      const count = starfield ? 700 : 260;
      const positions = new Float32Array(count * 3);
      const speeds = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 26;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
        positions[i * 3 + 2] = starfield ? Math.random() * -40 : (Math.random() - 0.5) * 6;
        speeds[i] = 0.2 + Math.random() * 0.8;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color: new THREE.Color(tint),
        size: starfield ? 0.075 : 0.11,
        transparent: true,
        opacity: 0.35 + intensity * 0.4,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geo, mat);
      scene.add(points);

      const pos = geo.getAttribute('position') as InstanceType<typeof THREE.BufferAttribute>;
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        for (let i = 0; i < count; i++) {
          if (starfield) {
            // slow push forward; recycle behind the camera
            let z = pos.getZ(i) + dt * speeds[i] * 2.2 * intensity;
            if (z > 8) z = -40;
            pos.setZ(i, z);
          } else {
            // paper dust: drift up-right with a lazy sine sway
            let x = pos.getX(i) + dt * speeds[i] * 0.5 * intensity;
            let y = pos.getY(i) + dt * speeds[i] * 0.22 * intensity + Math.sin(now / 2400 + i) * 0.0016;
            if (x > 13) x = -13;
            if (y > 8) y = -8;
            pos.setX(i, x);
            pos.setY(i, y);
          }
        }
        pos.needsUpdate = true;
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
        geo.dispose();
        mat.dispose();
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
