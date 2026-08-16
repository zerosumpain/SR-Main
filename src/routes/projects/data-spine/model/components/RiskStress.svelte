<script lang="ts">
  // RiskStress — "stress-test: the risks, designed for". RISKS and TENSIONS are
  // merged into one grid of solid tiles. A tile applies pressure when clicked:
  // it expands to reveal the design's mitigation (RISK_LINK[title].mitigation)
  // and names the beat that absorbs it. Same Svelte-5 grammar as FlowsDiagram.
  import { RISKS, TENSIONS, RISK_LINK, BEAT_LABEL, type Tension } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  type Kind = 'risk' | 'tension';
  interface Card extends Tension {
    kind: Kind;
    beat: string;
    mitigation: string;
  }

  // merge the two arrays, hydrating each with its RISK_LINK entry
  const CARDS: Card[] = [...RISKS, ...TENSIONS].map((t) => {
    const link = RISK_LINK[t.title];
    return { ...t, kind: link.kind, beat: link.beat, mitigation: link.mitigation };
  });

  const KIND_META: Record<Kind, { label: string; color: string }> = {
    risk: { label: 'risk', color: '#8a2d3a' },
    tension: { label: 'tension', color: '#7a5aa6' },
  };

  type Filter = 'all' | Kind;
  let filter = $state<Filter>('all');
  let openTitle = $state<string | null>(null);

  let shown = $derived(filter === 'all' ? CARDS : CARDS.filter((c) => c.kind === filter));
  let counts = $derived({
    all: CARDS.length,
    risk: CARDS.filter((c) => c.kind === 'risk').length,
    tension: CARDS.filter((c) => c.kind === 'tension').length,
  });

  function toggle(title: string) {
    openTitle = openTitle === title ? null : title;
  }
  function onKey(e: KeyboardEvent, title: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(title);
    }
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'risk', label: 'Risks' },
    { key: 'tension', label: 'Tensions' },
  ];
</script>

<section class="rs">
  <header class="rs-head">
    <div class="rs-titles">
      <span class="rs-kick">STRESS-TEST · APPLY PRESSURE</span>
      <h3>The risks, designed for</h3>
    </div>
    <span class="rs-badge" title="Every failure mode below was anticipated at design time">
      designed for, <em>not discovered later</em>
    </span>
  </header>

  <div class="rs-chips" role="group" aria-label="Filter by kind">
    {#each FILTERS as f (f.key)}
      <button
        class="chip"
        class:on={filter === f.key}
        style="--ck:{f.key === 'all' ? 'var(--accent-ink)' : KIND_META[f.key].color}"
        aria-pressed={filter === f.key}
        title="Show {f.label.toLowerCase()}"
        onclick={() => (filter = f.key)}
      >
        {f.label}<span class="chip-n">{counts[f.key]}</span>
      </button>
    {/each}
    <span class="rs-hint">click a tile to apply pressure →</span>
  </div>

  <div class="grid">
    {#each shown as c (c.title)}
      {@const open = openTitle === c.title}
      {@const k = KIND_META[c.kind]}
      <div
        class="tile"
        class:open
        style="--kc:{k.color}"
        role="button"
        tabindex="0"
        aria-expanded={open}
        aria-label="{c.title} — {k.label}. Press to reveal the mitigation."
        onclick={() => toggle(c.title)}
        onkeydown={(e) => onKey(e, c.title)}
      >
        <div class="t-top">
          <span class="t-kind">{k.label}</span>
          <span class="t-plus" aria-hidden="true">{open ? '–' : '+'}</span>
        </div>
        <b class="t-title">{c.title}</b>
        <p class="t-body">{c.body}</p>

        {#if open}
          <div class="t-mit">
            <span class="mit-lab">The design absorbs it</span>
            <p class="mit-text">{c.mitigation}</p>
            <div class="absorbed">
              <span class="ab-lab">absorbed at</span>
              <span class="ab-arrow" aria-hidden="true">→</span>
              <span class="ab-beat">{BEAT_LABEL[c.beat]}</span>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <footer class="rs-foot">
    Every known failure mode has a named place in the design that absorbs it.
  </footer>

  {#if eli}
    <p class="eli-note">Each card is something that could go wrong. Press one and it shows you the part of
      the plan built to catch it — nothing here is a surprise the design forgot about.</p>
  {/if}
</section>

<style>
  .rs { display: flex; flex-direction: column; }

  .rs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
  .rs-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.2em; color: var(--accent, #c4570a); }
  .rs-titles h3 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(19px, 2.1vw, 26px); margin: 3px 0 0; color: var(--ink, #1a1008); }
  .rs-badge { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink, #1a1008); background: #faf6ec; border: 1.5px solid rgba(26,16,8,0.45); border-left: 4px solid var(--accent-ink, #0e5b66); border-radius: var(--radius-sharp, 2px); padding: 7px 12px; line-height: 1.5; }
  .rs-badge em { font-style: normal; color: var(--accent-ink, #0e5b66); font-weight: 600; }

  .rs-chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.05em; text-transform: uppercase; color: rgba(26,16,8,0.72); background: #faf6ec; border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-pill, 100px); padding: 6px 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
  .chip:hover { border-color: rgba(26,16,8,0.6); color: var(--ink, #1a1008); }
  .chip.on { background: var(--ck); border-color: var(--ck); color: #fff; }
  .chip-n { font-size: var(--fs-label-xs); background: rgba(26,16,8,0.12); color: inherit; border-radius: var(--radius-pill, 100px); padding: 1px 6px; }
  .chip.on .chip-n { background: rgba(255,255,255,0.28); }
  .rs-hint { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,16,8,0.6); margin-left: auto; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; align-items: start; }

  .tile { background: #ffffff; border: 1.5px solid rgba(26,16,8,0.4); border-top: 4px solid var(--kc); border-radius: var(--radius-sharp); padding: 14px 16px 15px; cursor: pointer; display: flex; flex-direction: column; transition: border-color 0.15s ease; }
  .tile:hover { border-color: rgba(26,16,8,0.6); border-top-color: var(--kc); }
  .tile:focus-visible { outline: 2px solid var(--kc); outline-offset: 2px; }
  .tile.open { border-color: var(--kc); background: #faf6ec; }

  .t-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
  .t-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase; color: var(--kc); font-weight: 600; }
  .t-plus { font-family: var(--font-mono); font-size: 17px; line-height: 1; color: var(--kc); width: 20px; height: 20px; display: grid; place-content: center; border: 1.5px solid var(--kc); border-radius: var(--radius-pill, 100px); }
  .t-title { font-family: var(--fs-serif); font-weight: 600; font-size: 16.5px; color: var(--ink, #1a1008); line-height: 1.25; }
  .t-body { font-family: var(--font-body); font-size: var(--fs-label); line-height: 1.55; color: rgba(26,16,8,0.82); margin: 7px 0 0; }

  .t-mit { margin-top: 13px; border-top: 1px dashed rgba(26,16,8,0.35); padding-top: 12px; animation: mit-in 0.32s ease-out; }
  @keyframes mit-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  .mit-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase; color: #2f7d4f; font-weight: 600; }
  .mit-text { font-family: var(--font-body); font-size: var(--fs-label); line-height: 1.58; color: rgba(26,16,8,0.82); margin: 6px 0 0; }

  .absorbed { display: inline-flex; align-items: center; gap: 9px; margin-top: 11px; background: #ffffff; border: 1.5px solid rgba(26,16,8,0.4); border-left: 4px solid #2f7d4f; border-radius: var(--radius-sharp, 2px); padding: 7px 11px; flex-wrap: wrap; }
  .ab-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: rgba(26,16,8,0.6); }
  .ab-arrow { color: #2f7d4f; font-weight: 700; font-size: var(--fs-body-sm); line-height: 1; }
  .ab-beat { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.04em; color: var(--ink, #1a1008); font-weight: 600; }

  .rs-foot { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: rgba(26,16,8,0.62); text-align: center; margin-top: 18px; border-top: 1px dashed rgba(26,16,8,0.3); padding-top: 12px; }

  .eli-note { font-family: var(--font-body); font-size: var(--fs-label); font-style: italic; color: rgba(26,16,8,0.72); margin: 12px 2px 0; }

  @media (max-width: 560px) {
    .grid { grid-template-columns: 1fr; }
    .rs-hint { margin-left: 0; }
  }
</style>
