<script lang="ts">
  // ImpactFunnel — the notes it wrote, poured through the four questions that matter: did I
  // look, did it help, did I act on it, did it come to anything. Each band is as wide as its
  // count and tapers into the next, so the loss between stages is a shape, not arithmetic.
  //
  // Labels and figures are HTML beside the shape, so they stay legible on a phone. With no
  // live figures (a cold database) the shape is drawn as a schematic and every count is a
  // dash, never a zero.
  import { shown } from '../../../lib/motion';
  import Counter from '../../kit/Counter.svelte';

  interface Stage { label: string; sub: string; value: number | null }
  let { stages }: { stages: Stage[] } = $props();

  const known = $derived(stages.every((s) => s.value != null));
  const top = $derived(Math.max(1, ...stages.map((s) => s.value ?? 0)));
  // Width as a share of the column. A schematic steps down evenly; a real one is to scale,
  // with a floor so a tiny count still shows as a sliver rather than vanishing.
  const width = (i: number) => {
    if (!known) return 100 - i * (70 / Math.max(1, stages.length - 1));
    return Math.max(4, ((stages[i].value ?? 0) / top) * 100);
  };
  const shape = (i: number) => {
    const w = width(i), n = i < stages.length - 1 ? width(i + 1) : w * 0.85;
    return `polygon(${50 - w / 2}% 0, ${50 + w / 2}% 0, ${50 + n / 2}% 100%, ${50 - n / 2}% 100%)`;
  };
  const drop = (i: number) => {
    const a = stages[i].value, b = stages[i + 1]?.value;
    return a != null && b != null && a > 0 ? Math.round(((a - b) / a) * 100) : null;
  };
</script>

<div class="fun" class:schematic={!known} {@attach shown({ amount: 0.25 })}
  role="img" aria-label={stages.map((s) => `${s.label}: ${s.value ?? 'not available'}`).join(', ')}>
  {#each stages as s, i (s.label)}
    <div class="row" style="--d:{i * 0.12}s">
      <div class="lab"><b>{s.label}</b><span>{s.sub}</span></div>
      <div class="pipe"><div class="band" style="clip-path:{shape(i)}; --o:{1 - i * 0.13}"></div>
        {#if i === 0}<span class="drip d1"></span><span class="drip d2"></span><span class="drip d3"></span>{/if}
      </div>
      <div class="val"><Counter value={s.value} /></div>
    </div>
    {#if i < stages.length - 1 && drop(i) != null}
      <p class="loss"><span>{drop(i)}% go no further</span></p>
    {/if}
  {/each}
  {#if !known}<p class="note">The live counts aren’t available right now, so this is the shape of the funnel without its figures.</p>{/if}
</div>

<style>
  .fun { display: flex; flex-direction: column; gap: 4px; }
  .row { display: grid; grid-template-columns: minmax(0, 15ch) minmax(0, 1fr) minmax(0, 7ch); gap: 18px; align-items: center; }
  .lab { display: flex; flex-direction: column; gap: 2px; text-align: right; }
  .lab b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(16px, 1.5vw, 20px); color: var(--fg); line-height: 1; }
  .lab span { font-size: var(--fs-label-xs); color: var(--fg-3); line-height: 1.35; }
  .pipe { position: relative; height: clamp(46px, 5vw, 64px); }
  .band { position: absolute; inset: 0; background: var(--tone); opacity: var(--o); }
  .schematic .band { background: repeating-linear-gradient(135deg, var(--tone) 0 6px, transparent 6px 12px); opacity: 0.5; }
  .val { font-family: var(--er-display); font-size: clamp(22px, 2.4vw, 34px); color: var(--tone-text); line-height: 1; }
  .loss { margin: 0; display: grid; grid-template-columns: minmax(0, 15ch) minmax(0, 1fr) minmax(0, 7ch); gap: 18px; }
  .loss span { grid-column: 2; text-align: center; font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); }
  .note { margin: 14px 0 0; font-size: var(--fs-label); color: var(--fg-3); }

  .fun:global([data-armed]) .band { transform: scaleX(0); transition: transform 1s var(--er-ease) var(--d); }
  .fun:global([data-armed][data-shown]) .band { transform: none; }

  .drip { position: absolute; left: 50%; top: 0; width: 8px; height: 8px; margin-left: -4px; border-radius: var(--radius-pill); background: var(--fg); opacity: 0;
    animation: drip 3.2s linear infinite; }
  .d2 { animation-delay: 1.07s; margin-left: -14px; } .d3 { animation-delay: 2.13s; margin-left: 6px; }
  @keyframes drip { 0% { transform: translateY(-20px); opacity: 0; } 15% { opacity: 0.8; } 100% { transform: translateY(420px); opacity: 0; } }

  @media (max-width: 560px) {
    .row, .loss { grid-template-columns: minmax(0, 1fr) minmax(0, 6ch); gap: 6px 12px; }
    .lab { grid-column: 1 / -1; text-align: left; flex-direction: row; gap: 10px; align-items: baseline; }
    .loss span { grid-column: 1; }
  }
</style>
