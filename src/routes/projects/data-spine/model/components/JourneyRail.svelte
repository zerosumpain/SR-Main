<script lang="ts">
  // JourneyRail — a sticky 7-beat spine under the section nav. Lights the beat the
  // reader is currently in (IntersectionObserver over [data-beat] sections) and
  // carries the pinned worked question. Click a beat to jump. Observer handle is a
  // plain `let` (never $state — see svelte5-pitfalls).
  import { onMount } from 'svelte';
  import { BEATS, WORKED_QUESTION_SHORT } from '../lib/model';

  let active = $state<string>('ask');
  let observer: IntersectionObserver | undefined; // plain let, never $state

  onMount(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-beat]'));
    // track the most-visible beat section
    const ratios = new Map<string, number>();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.beat;
        if (id) ratios.set(id, e.isIntersecting ? e.intersectionRatio : 0);
      }
      let best = active, bestR = -1;
      for (const [id, r] of ratios) if (r > bestR) { bestR = r; best = id; }
      if (bestR > 0) active = best;
    }, { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 1] });
    for (const s of sections) observer.observe(s);
    return () => observer?.disconnect();
  });

  function jump(id: string) {
    const el = document.querySelector<HTMLElement>(`[data-beat="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<nav class="rail" aria-label="The question's journey">
  <span class="q-chip" title="The question threaded through every beat">✦ {WORKED_QUESTION_SHORT}</span>
  <ol class="beats">
    {#each BEATS as b (b.id)}
      <li>
        <button class="beat" class:on={active === b.id} onclick={() => jump(b.id)} title={b.label}>
          <span class="b-n">{b.n}</span>
          <span class="b-lab">{b.label}</span>
        </button>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .rail { position: sticky; top: calc(var(--topH, 56px) + 45px); z-index: 11; display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap;
    padding: 8px clamp(16px, 3vw, 40px); background: rgba(237,228,212,0.97); backdrop-filter: blur(6px); border-bottom: 1px solid rgba(26,16,8,0.14); }
  .q-chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; color: var(--accent-ink, #0e5b66); background: #fff; border: 1px solid rgba(14,91,102,0.4); border-radius: var(--radius-pill); padding: 4px 11px; white-space: nowrap; }
  .beats { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; list-style: none; margin: 0; padding: 0; }
  .beat { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 1px solid transparent; border-radius: var(--radius-sharp); padding: 4px 9px; cursor: pointer; color: rgba(26,16,8,0.66); font-family: var(--font-body); font-size: var(--fs-label-xs); font-weight: 500; }
  .beat:hover { background: rgba(26,16,8,0.06); color: var(--ink); }
  .b-n { display: grid; place-content: center; width: 17px; height: 17px; border-radius: var(--radius-pill); background: rgba(26,16,8,0.14); color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; }
  .beat.on { background: var(--ink); color: var(--paper, #f1ead6); }
  .beat.on .b-n { background: var(--accent-ink, #0e5b66); color: #fff; }
  .b-lab { white-space: nowrap; }

  @media (max-width: 900px) {
    .rail { top: calc(var(--topH, 56px) + 42px); gap: 8px 10px; }
    .b-lab { display: none; }
    .beat.on .b-lab { display: inline; }
  }
</style>
