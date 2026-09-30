<script lang="ts">
  // Impact (spec 2026-09-28): is daydream worth having, and is it getting
  // better? Five figures, then the twelve-week picture, where it earns its
  // keep (by area and by kind), the journey from spotted to result, what is
  // happening right now, and — in plain words — how every figure is counted.
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import AreaGlyph from '$lib/components/jkai/daydream/flow/AreaGlyph.svelte';
  import WeeklyVerdicts from '$lib/components/jkai/daydream/flow/WeeklyVerdicts.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import type { Breakdown } from '$lib/daydream/impact';
  import { ago, pct, stamp } from '$lib/daydream/format';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const i = $derived(data.impact);

  function hours(h: number | null): string {
    if (h == null) return '—';
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) return `${Math.round(h)} h`;
    return `${Math.round(h / 24)} days`;
  }
  function delta(now: number | null, before: number | null): string {
    if (now == null) return 'answer a few notes to see this';
    if (before == null) return 'nothing to compare with yet';
    const d = Math.round((now - before) * 100);
    return d === 0 ? 'level with the 28 days before' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} points on the 28 days before`;
  }

  const tiles = $derived<DeckTile[]>(
    i
      ? [
          {
            key: 'hit',
            label: 'Worth knowing',
            value: i.current.hitRate == null ? '—' : String(Math.round(i.current.hitRate * 100)),
            suffix: i.current.hitRate == null ? null : '%',
            sub: delta(i.current.hitRate, i.previous.hitRate),
            tone: i.current.hitRate != null && i.previous.hitRate != null && i.current.hitRate < i.previous.hitRate ? 'watch' : 'good',
            lit: true,
          },
          { key: 'spotted', label: 'Spotted', value: String(i.current.noticed), sub: `${i.previous.noticed} in the 28 days before`, tone: 'steady' },
          {
            key: 'answered',
            label: 'Answered',
            value: pct(i.current.decidedShare),
            sub: `${i.current.rated} of ${i.current.noticed} notes`,
            tone: i.current.decidedShare != null && i.current.decidedShare < 0.5 ? 'watch' : 'steady',
          },
          { key: 'wait', label: 'Time to answer', value: hours(i.current.medianHoursToDecide), sub: 'typical, from note to your answer', tone: 'quiet' },
          { key: 'acted', label: 'Acted on', value: String(i.funnel.actedOn), sub: `${i.funnel.result} came back with a result`, tone: i.funnel.actedOn ? 'steady' : 'quiet' },
        ]
      : [],
  );

  const funnel = $derived(
    i
      ? [
          { k: 'Spotted', v: i.funnel.spotted, s: 'notes that reached you' },
          { k: 'Answered', v: i.funnel.decided, s: 'you gave a verdict' },
          { k: 'Worth knowing', v: i.funnel.useful, s: 'you kept it' },
          { k: 'Acted on', v: i.funnel.actedOn, s: 'a check approved or a build accepted' },
          { k: 'Result', v: i.funnel.result, s: 'a report back, or a build shipped' },
        ]
      : [],
  );
  const funnelMax = $derived(Math.max(1, ...funnel.map((f) => f.v)));

  function rowRate(b: Breakdown): number | null {
    return b.rated ? b.useful / b.rated : null;
  }
</script>

<svelte:head><title>Impact — Daydream</title></svelte:head>

{#if data.loadError || !i}
  <section class="band"><div class="inner"><LoadErrorCard kicker="Impact did not load" message={data.loadError ?? 'No figures.'} /></div></section>
{:else}
  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="A / Is it worth having?"
        title={['The last', `${i.windowDays} days`]}
        strap="Every figure here comes from your own answers. A note you have not answered is not counted as a miss — it is shown as not answered, so the score cannot flatter itself."
      />
      <StatDeck {tiles} min={180} />
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="B / Over time"
        title={['Twelve weeks,', 'old engine and new']}
        strap="Each bar is a week of notes, split by what you said about them. The dashed line is 25 September, when the old pattern engine was replaced by the question-led loop — the weeks before it are the baseline."
      />
      <WeeklyVerdicts weeks={i.weeks} loopStart={i.loopStart} />
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="C / Where it earns its keep"
        title={['By area', 'and by kind']}
        strap="The share of answered notes you kept, for each part of your life and each kind of note — last 28 days, new loop only. The count is beside every bar, so one lucky note is read as one note."
      />
      <div class="split">
        {#each [{ title: 'By area', rows: i.byArea, glyph: true }, { title: 'By kind', rows: i.byKind, glyph: false }] as col (col.title)}
          <div class="col">
            <h3 class="col-h">{col.title}</h3>
            {#if col.rows.length === 0}
              <p class="none">No notes from the new loop in this window.</p>
            {:else}
              <ul class="rows">
                {#each col.rows as b (b.key)}
                  {@const r = rowRate(b)}
                  <li>
                    <span class="r-label">{#if col.glyph}<AreaGlyph area={b.key} size={15} />{/if}{b.label}</span>
                    <span class="r-bar" aria-hidden="true">
                      {#if r != null}<span class="r-fill" style="width: {Math.max(2, r * 100)}%"></span>{/if}
                    </span>
                    <span class="r-v">{r == null ? 'not answered' : pct(r)}</span>
                    <span class="r-n">{b.useful} kept of {b.rated} answered · {b.noticed} spotted</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="D / From idea to result"
        title={['The journey', 'of a note']}
        strap="How far ideas got in this window. The first three steps follow the same notes, so the drop between them is where ideas stall; acted on and result count by the day the check was approved or the build shipped."
      />
      <ol class="funnel">
        {#each funnel as f, idx (f.k)}
          <li>
            <span class="f-k"><span class="f-num">{String(idx + 1).padStart(2, '0')}</span>{f.k}</span>
            <span class="f-bar"><span class="f-fill" style="width: {Math.max(f.v ? 2 : 0, (f.v / funnelMax) * 100)}%"></span></span>
            <span class="f-v">{f.v}</span>
            <span class="f-s">{f.s}{#if idx > 0 && funnel[idx - 1].v}<span class="f-conv"> · {pct(f.v / funnel[idx - 1].v)} of the step before</span>{/if}</span>
          </li>
        {/each}
      </ol>

      <div class="now">
        <div class="now-col">
          <h3 class="col-h">Double-checks</h3>
          <p><strong>{i.checks.awaiting}</strong> waiting for your OK · <strong>{i.checks.running}</strong> running · <strong>{i.checks.completed}</strong> reported back</p>
          {#if !data.member}<a href="/jkai/daydreams">Open the Inbox</a>{/if}
        </div>
        <div class="now-col">
          <h3 class="col-h">Build ideas it proposed</h3>
          <p><strong>{i.builds.proposed}</strong> waiting to be accepted · <strong>{i.builds.accepted}</strong> accepted · <strong>{i.builds.shipped}</strong> shipped</p>
          <a href="/jkai/develop/backlog">Open the build backlog</a>
        </div>
      </div>

      {#if data.results.length}
        <h3 class="col-h results-h">Latest results</h3>
        <ul class="results">
          {#each data.results as r (r.href)}
            <li>
              <span class="res-kind">{r.kind === 'check' ? 'Report back' : 'Shipped'}</span>
              <a href={r.href}>{r.title}</a>
              <span class="res-at" title={stamp(r.at)}>{ago(r.at)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  <section class="band sunken">
    <div class="inner">
      <SectionHead kicker="E / How this is measured" title={['What each', 'figure means']} />
      <dl class="defs">
        <dt>Spotted</dt>
        <dd>A note that reached you — on this page or as a message. Notes jkai wrote and then threw away (because it could not back them up, or had said it before) are not counted.</dd>
        <dt>Worth knowing</dt>
        <dd>Of the notes you answered, the share you marked “worth knowing”. Unanswered notes are left out rather than counted as misses; “Answered” tells you how much of the picture that is.</dd>
        <dt>Time to answer</dt>
        <dd>The middle value of how long a note waited for your answer. Half were quicker, half slower.</dd>
        <dt>Acted on</dt>
        <dd>A double-check you approved, or a build idea you accepted into the build backlog, in this window.</dd>
        <dt>Result</dt>
        <dd>A double-check that came back with its report, or a build idea that shipped.</dd>
        <dt>Old engine vs new loop</dt>
        <dd>Until 25 September 2026 notes came from a pattern engine; since then from one question at a time. The twelve-week chart includes both so the change can be judged. Area and kind use the new loop only.</dd>
      </dl>
    </div>
  </section>
{/if}

<style>
  .split {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px 40px;
  }
  .col-h {
    margin: 0 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .none {
    color: var(--text-muted);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rows li {
    display: grid;
    grid-template-columns: minmax(110px, 0.9fr) minmax(80px, 1.4fr) 56px;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 12px;
  }
  .r-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: var(--fs-body-sm);
  }
  .r-bar {
    height: 12px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-hair);
  }
  .r-fill {
    display: block;
    height: 100%;
    background: var(--accent-ink);
  }
  .r-v {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .r-n {
    grid-column: 2 / span 2;
    font-size: var(--fs-label-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .funnel {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .funnel li {
    display: grid;
    grid-template-columns: 200px 1fr 48px;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 14px;
  }
  .f-k {
    display: inline-flex;
    gap: 8px;
    align-items: baseline;
    font-family: var(--font-display);
    text-transform: uppercase;
    font-size: var(--fs-body);
  }
  .f-num {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .f-bar {
    height: 18px;
    background: var(--surface-sunken);
  }
  .f-fill {
    display: block;
    height: 100%;
    background: var(--text-primary);
  }
  .funnel li:last-child .f-fill {
    background: var(--success);
  }
  .f-v {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .f-s {
    grid-column: 2 / span 2;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .f-conv {
    color: var(--text-secondary);
  }
  .now {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 40px;
    margin-top: 28px;
    padding-top: 18px;
    border-top: 1px solid var(--line-hair);
  }
  .now p {
    margin: 0 0 6px;
    line-height: 1.6;
  }
  .now a,
  .results a {
    color: var(--accent-ink);
  }
  .results-h {
    margin-top: 26px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .results li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    padding: 8px 0;
    border-top: 1px solid var(--line-hair);
  }
  .res-kind,
  .res-at {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .res-at {
    margin-left: auto;
  }
  .defs {
    display: grid;
    grid-template-columns: minmax(150px, 220px) 1fr;
    gap: 12px 28px;
    margin: 0;
  }
  .defs dt {
    font-weight: 700;
  }
  .defs dd {
    margin: 0;
    line-height: 1.55;
    max-width: 72ch;
    color: var(--text-secondary);
  }
  @media (max-width: 720px) {
    .split,
    .now {
      grid-template-columns: 1fr;
    }
    .funnel li {
      grid-template-columns: 1fr 44px;
    }
    .f-k {
      grid-column: 1 / span 2;
    }
    .f-bar {
      grid-column: 1;
    }
    .f-s {
      grid-column: 1 / span 2;
    }
    .defs {
      grid-template-columns: 1fr;
      gap: 4px;
    }
    .defs dd {
      margin-bottom: 10px;
    }
  }
</style>
