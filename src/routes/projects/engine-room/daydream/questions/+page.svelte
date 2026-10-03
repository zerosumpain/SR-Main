<script lang="ts">
  // Questions — the channel × outcome schedule the think loop rotates through. The clock, the
  // grid, the skip reasons and the upcoming slots are all read from the feature's own module
  // (daydream/think/questions.ts) by the layout load; nothing here is a copy.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import ThoughtClock from '../../components/art/daydream/ThoughtClock.svelte';
  import TwoRooms from '../../components/art/daydream/TwoRooms.svelte';
  import { DAYDREAM_COPY as C } from '../../lib/daydream';
  import { app } from '../../lib/appState.svelte';
  import { cascade, reveal } from '../../lib/motion';

  let { data } = $props();
  const f = $derived(data.facts.daydream);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  const skipWhy = $derived(new Map(f.skipped.map((s) => [`${s.channel}|${s.outcome}`, s.why])));
  const scheduled = (c: string, o: string) => f.schedule[c]?.includes(o) ?? false;
  const channelLabel = $derived(new Map<string, string>(f.channels.map((c) => [c.id, c.label])));
  const outcomeLabel = $derived(new Map<string, string>(f.outcomes.map((o) => [o.id, o.label])));
  const asked = $derived(f.channels.reduce((n, c) => n + f.outcomes.filter((o) => scheduled(c.id, o.id)).length, 0));

  let cell = $state<{ c: string; o: string } | null>(null);
  const cellInfo = $derived.by(() => {
    if (!cell) return null;
    const on = scheduled(cell.c, cell.o);
    const why = skipWhy.get(`${cell.c}|${cell.o}`);
    return {
      c: channelLabel.get(cell.c) ?? cell.c, o: outcomeLabel.get(cell.o) ?? cell.o, on,
      text: on ? 'On the schedule. When the clock lands here, a cycle starts from this part of my life looking for this kind of thing.'
        : why ? `Never asked, because ${why}.` : 'Not on the schedule this period.',
    };
  });

  const privateChannels = $derived(f.channels.filter((c) => c.id !== 'research').map((c) => c.label));
</script>

<svelte:head><title>Questions — Daydream — The Engine Room</title></svelte:head>

<LeafHead part="daydream" title="Questions" line={C.questions.line.eng} lineEli5={C.questions.line.plain}>
  {#snippet art()}
    <ThoughtClock upcoming={f.upcoming} {channelLabel} {outcomeLabel} cadence={f.cadenceMinutes} activeHours={f.activeHours} />
  {/snippet}
</LeafHead>

<Band surface="ink" part="daydream" pad="normal" label="The rhythm">
  <div class="rhythm">
    <div class="r-words">
      <span class="er-kicker">The rhythm</span>
      <h2 class="er-display r-title">Small, often,<br />and only when<br />I’m awake</h2>
      <p class="er-lede">{t(C.questions.why)}</p>
    </div>
    <div class="stats" {@attach cascade()}>
      <Stat value={f.cadenceMinutes} unit="min" label="between one thought and the next" lead />
      <Stat value={`${f.activeHours.start}–${f.activeHours.end}`} label="the waking hours it thinks in, UK time" />
      <Stat value={f.maxToolCalls} label="tool calls a single thought may make, at most" />
      <Stat value={f.maxNotesPerCycle} label="notes a single thought may write, at most" />
    </div>
  </div>
</Band>

<Band surface="paper" part="daydream" label="The schedule">
  <header class="g-head">
    <span class="er-kicker">The schedule</span>
    <h2 class="er-display g-title" {@attach reveal({ y: 30 })}>Where it starts,<br />and what it’s after</h2>
    <p class="er-lede">{eli
      ? 'Down the side, the parts of my life a thought can start from. Along the top, what it hopes to find. A filled square is a question it asks. Tap any square to see why.'
      : 'Rows are channels, columns outcomes. Filled cells are on the clock-keyed schedule; struck cells are excluded by the skip table, each with its reason. Select a cell.'}</p>
  </header>

  <div class="grid-wrap">
    <div class="grid" style="--n:{f.outcomes.length}" role="grid" aria-label="Channels against outcomes">
      <span class="corner" aria-hidden="true"><span>starts from ↓</span><span>looking for →</span></span>
      {#each f.outcomes as o (o.id)}<span class="col" class:hot={cell?.o === o.id}>{o.label}</span>{/each}
      {#each f.channels as c (c.id)}
        <span class="row" class:hot={cell?.c === c.id}>{c.label}</span>
        {#each f.outcomes as o, j (o.id)}
          {@const on = scheduled(c.id, o.id)}
          <button class="cell" class:on class:sel={cell?.c === c.id && cell?.o === o.id} style="--d:{j * 0.03}s"
            aria-label="{c.label} towards {o.label}: {on ? 'asked' : 'never asked'}"
            onclick={() => (cell = cell?.c === c.id && cell?.o === o.id ? null : { c: c.id, o: o.id })}>
          </button>
        {/each}
      {/each}
    </div>
  </div>

  <div class="why" aria-live="polite">
    {#if cellInfo}
      <b class="w-pair">{cellInfo.c} <span>→</span> {cellInfo.o}</b>
      <span class="w-tag" class:on={cellInfo.on}>{cellInfo.on ? 'asked' : 'never asked'}</span>
      <p>{cellInfo.text}</p>
    {:else}
      <p><b>{asked}</b> of the <b>{f.pairCount}</b> pairings are asked. <b>{f.skipped.length}</b> are ruled out on purpose, each with a reason. Pick a square.</p>
    {/if}
  </div>
</Band>

<Band surface="ink" part="daydream" label="Private or the web">
  <div class="rooms-head">
    <span class="er-kicker">Two kinds of thought</span>
    <h2 class="er-display g-title" {@attach reveal({ y: 30 })}>Private or the web,<br />never both</h2>
    <p class="er-lede">{t(C.questions.privacy)}</p>
  </div>
  <TwoRooms {privateChannels} privateTools={f.tools.private} webTools={f.tools.web} />
</Band>

<PageFoot />

<style>
  .rhythm { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(28px, 5vw, 80px); align-items: center; }
  .rhythm .r-title, .g-head .g-title, .rooms-head .g-title { font-size: clamp(32px, 4.2vw, 62px); margin-bottom: 20px; }
  .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px 24px; }
  @media (max-width: 860px) { .rhythm { grid-template-columns: minmax(0, 1fr); } }

  .g-head, .rooms-head { max-width: 860px; margin-bottom: clamp(24px, 3vw, 40px); }

  .grid-wrap { overflow-x: auto; padding-bottom: 6px; }
  .grid { display: grid; grid-template-columns: max-content repeat(var(--n), minmax(58px, 1fr)); gap: 4px; align-items: end; min-width: max-content; }
  .corner { display: flex; flex-direction: column; gap: 2px; font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); padding: 0 14px 8px 0; align-self: end; }
  .col { font-family: var(--er-mono); font-size: var(--fs-label-xs); line-height: 1.25; color: var(--fg-2); text-align: center; padding-bottom: 8px; max-width: 12ch; justify-self: center; transition: color 0.2s; }
  .row { font-family: var(--er-display); text-transform: uppercase; font-size: 18px; color: var(--fg); padding-right: 16px; align-self: center; transition: color 0.2s; }
  .col.hot, .row.hot { color: var(--tone-text); }
  .cell { position: relative; width: 100%; height: 52px; border: 2px solid var(--rule-strong); background: transparent; border-radius: 0; cursor: pointer; padding: 0;
    transition: transform 0.25s var(--er-ease), background 0.2s; }
  .cell:not(.on) { background: linear-gradient(to top right, transparent calc(50% - 1px), var(--rule-strong) calc(50% - 1px), var(--rule-strong) calc(50% + 1px), transparent calc(50% + 1px)); }
  .cell.on { background: var(--tone); border-color: var(--tone); }
  .cell:hover { transform: scale(1.08); z-index: 1; }
  .cell.sel { outline: 3px solid var(--fg); outline-offset: 2px; z-index: 2; }

  .why { margin-top: 22px; min-height: 92px; padding: 18px 22px; border-left: 4px solid var(--tone); background: var(--wash); display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
  .why p { flex-basis: 100%; margin: 0; font-size: var(--fs-body); line-height: 1.55; color: var(--fg-2); }
  .why p b { color: var(--tone-text); font-family: var(--er-display); font-weight: 400; font-size: 1.25em; }
  .w-pair { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(20px, 2vw, 28px); color: var(--fg); }
  .w-pair span { color: var(--tone-text); }
  .w-tag { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; padding: 3px 10px; border-radius: var(--radius-pill); border: 1px solid var(--fg-3); color: var(--fg-3); }
  .w-tag.on { background: var(--tone); border-color: var(--tone); color: var(--er-ink); }
</style>
