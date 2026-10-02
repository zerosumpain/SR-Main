<script lang="ts">
  // Questions — the channel × outcome schedule the think loop rotates through. The grid,
  // the skip reasons and the upcoming slots are all read from the feature's own module
  // (daydream/think/questions.ts) by the layout load; nothing here is a copy.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import { DAYDREAM_COPY as C } from '../../lib/daydream';
  import { app } from '../../lib/appState.svelte';

  let { data } = $props();
  const f = $derived(data.facts.daydream);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  const skipWhy = $derived(new Map(f.skipped.map((s) => [`${s.channel}|${s.outcome}`, s.why])));
  const scheduled = (c: string, o: string) => f.schedule[c]?.includes(o) ?? false;
  const channelLabel = $derived(new Map<string, string>(f.channels.map((c) => [c.id, c.label])));
  const outcomeLabel = $derived(new Map<string, string>(f.outcomes.map((o) => [o.id, o.label])));

  let cell = $state<{ c: string; o: string } | null>(null);
  const cellText = $derived.by(() => {
    if (!cell) return null;
    const pair = `${channelLabel.get(cell.c)} × ${outcomeLabel.get(cell.o)}`;
    if (scheduled(cell.c, cell.o)) return `${pair} is on the schedule.`;
    const why = skipWhy.get(`${cell.c}|${cell.o}`);
    return why ? `${pair} is never asked, because ${why}.` : `${pair} isn’t on the schedule this period.`;
  });

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
</script>

<svelte:head><title>Questions — Daydream — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="daydream" title="Questions" line={C.questions.line.eng} lineEli5={C.questions.line.plain} />

  <div class="stats">
    <Stat value={f.cadenceMinutes} unit=" min" label="between thoughts" />
    <Stat value={`${f.activeHours.start}–${f.activeHours.end}`} label="waking hours only" />
    <Stat value={f.maxToolCalls} label="tool calls per thought, at most" />
    <Stat value={f.maxNotesPerCycle} label="notes per thought, at most" />
  </div>

  <Instrument
    kicker="The schedule"
    title="Where it starts, and what it’s after"
    reading="Rows are the parts of my life a cycle can start from. Columns are what it’s trying to produce. Select a cell."
    readingEli5="Rows are where it starts looking. Columns are what it’s hoping to find. Tap a square."
    takeaway={t(C.questions.why)}
  >
    <div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr><th></th>{#each f.outcomes as o (o.id)}<th scope="col"><span>{o.label}</span></th>{/each}</tr>
        </thead>
        <tbody>
          {#each f.channels as c (c.id)}
            <tr>
              <th scope="row">{c.label}</th>
              {#each f.outcomes as o (o.id)}
                {@const on = scheduled(c.id, o.id)}
                <td>
                  <button class="cell" class:on class:sel={cell?.c === c.id && cell?.o === o.id}
                    aria-label="{c.label} × {o.label}: {on ? 'asked' : 'never asked'}"
                    onclick={() => (cell = { c: c.id, o: o.id })}>{on ? '●' : '·'}</button>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="why" aria-live="polite">{cellText ?? `${f.skipped.length} of the ${f.pairCount} pairings are ruled out, each with a reason.`}</p>
  </Instrument>

  <Instrument
    kicker="Next up"
    title="What it will ask next"
    reading="The clock decides, so this is the real schedule for the next few slots (UK time). Outside waking hours the slot passes unasked."
  >
    <ol class="next">
      {#each f.upcoming as q (q.at)}
        <li><time>{time(q.at)}</time><b>{channelLabel.get(q.channel)}</b><span>→ {outcomeLabel.get(q.outcome)}</span></li>
      {/each}
    </ol>
  </Instrument>

  <Instrument kicker="Two kinds of cycle" title="Private or the web, never both" takeaway={t(C.questions.privacy)}>
    <div class="stats">
      <Stat value={f.tools.private} label="read-only tools over my own data" />
      <Stat value={f.tools.web} label="tools for the open web" />
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin: 0 0 18px; }
  .grid-wrap { overflow-x: auto; }
  .grid { border-collapse: collapse; font-size: var(--fs-label); }
  .grid th { font-weight: 500; text-align: left; padding: 4px 8px; color: rgba(28,22,17,0.7); white-space: nowrap; }
  .grid thead th { vertical-align: bottom; font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .grid thead th span { display: inline-block; max-width: 9ch; white-space: normal; }
  .grid td { padding: 2px; text-align: center; }
  .cell { width: 34px; height: 30px; border: 1px solid rgba(28,22,17,0.14); background: rgba(255,255,255,0.4); border-radius: var(--radius-sharp);
    color: rgba(28,22,17,0.35); cursor: pointer; font-size: var(--fs-label); }
  .cell.on { background: color-mix(in srgb, var(--accent) 22%, white); color: var(--text-primary); border-color: var(--accent); }
  .cell.sel { outline: 2px solid var(--accent-ink); outline-offset: 1px; }
  .why { margin: 12px 0 0; font-size: var(--fs-label); color: rgba(28,22,17,0.78); min-height: 1.5em; }
  .next { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .next li { display: grid; grid-template-columns: 6ch 1fr 2fr; gap: 10px; font-size: var(--fs-label); padding: 4px 0; border-bottom: 1px dashed rgba(28,22,17,0.12); }
  .next time { font-family: var(--font-mono); color: rgba(28,22,17,0.6); }
</style>
