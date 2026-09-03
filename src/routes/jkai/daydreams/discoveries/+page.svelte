<script lang="ts">
  // Discoveries — what the engine wondered about, and what came back.
  //
  // The room opens on a rollup rather than on the board, because the board is
  // 120 cards and the first honest question about it is not "what is the top
  // card" but "how did the questions come out". Every cell that names a
  // natural filter sets it: click "Held up" and section B is the questions
  // that held up, with the chip already on.
  //
  // Then: A yesterday's card · B the board · C the lines of enquiry ·
  // D the sweep · E every digest it has written.
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import { page } from '$app/state';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import DiscoveriesBoard from '$lib/components/jkai/daydream/rooms/DiscoveriesBoard.svelte';
  import DiscoveriesLeads from '$lib/components/jkai/daydream/rooms/DiscoveriesLeads.svelte';
  import type { BoardOrder, BoardRow, LeadRow } from '$lib/components/jkai/daydream/rooms/discoveries';
  import { leadTone, verdictTone } from '$lib/daydream/priority';
  import { ago } from '$lib/daydream/feed-client';
  import { FAMILY_SUBJECTS } from '$lib/daydream/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const discoveries = $derived(data.discoveries);
  const board = $derived<BoardRow[]>(discoveries.board);
  const leads = $derived<LeadRow[]>(discoveries.leads);
  const digests = $derived(discoveries.digests);
  const digest = $derived(data.digest);

  // ── Filters, held here so the rollup can set them ────────────────────────
  //
  // `?who=` is a deep link from the family room ("show me Katie's questions").
  // Read ONCE, at init, rather than in an effect: an effect that follows
  // `page.url` also fires on every in-page navigation and would quietly reset
  // the chip the moment anything else touched the URL. A cross-route arrival
  // mounts this page fresh, which is the only case the link has to serve.
  const HOUSEHOLD = FAMILY_SUBJECTS.map((f) => f.subject);
  const linkedWho = (() => {
    const w = page.url.searchParams.get('who');
    return w && HOUSEHOLD.includes(w) ? w : 'all';
  })();

  let boardWho = $state(linkedWho);
  let boardVerdict = $state('all');
  let boardOrder = $state<BoardOrder>('priority');
  let leadStatus = $state('all');

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** A verdict cell must show what it then filters to, so it clears `who`
   *  as well — otherwise the cell says 12 and the board below shows 3. */
  function pickVerdict(v: string) {
    boardWho = 'all';
    boardVerdict = boardVerdict === v ? 'all' : v;
    jump('board');
  }
  function pickLead(s: string) {
    leadStatus = leadStatus === s ? 'all' : s;
    jump('leads');
  }

  // ── The rollup ───────────────────────────────────────────────────────────
  const verdictCounts = $derived.by(() => {
    const n = (pred: (q: BoardRow) => boolean) => board.filter(pred).length;
    return {
      supported: n((q) => q.verdict === 'supported'),
      refuted: n((q) => q.verdict === 'refuted'),
      wrong_direction: n((q) => q.verdict === 'wrong_direction'),
      underpowered: n((q) => q.verdict === 'underpowered'),
      untested: n((q) => q.verdict == null),
    };
  });

  /**
   * Lead states, in a fixed order, with the zeroes kept.
   *
   * `open`, `parked` and `abandoned` always render even at nought — a state
   * nothing is in is a fact, and hiding it makes the set look like the whole
   * story when it is not. `paid_off` is a fourth status the schema documents
   * and `run.ts` does not yet write, and there may one day be others, so
   * anything actually present is appended rather than silently dropped from
   * both the rollup and the chips below.
   */
  const LEAD_STATE_ORDER = ['open', 'paid_off', 'parked', 'abandoned'];
  const LEAD_STATE_ALWAYS = ['open', 'parked', 'abandoned'];
  const LEAD_STATE_SUB: Record<string, string> = {
    paid_off: 'produced something and closed',
    parked: 'set aside, not written off',
    abandoned: 'closed by arithmetic after barren rounds',
  };

  const leadStates = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const l of leads) counts.set(l.status, (counts.get(l.status) ?? 0) + 1);
    return [...new Set([...LEAD_STATE_ALWAYS, ...counts.keys()])]
      .sort((a, b) => {
        const ia = LEAD_STATE_ORDER.indexOf(a);
        const ib = LEAD_STATE_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
      })
      .map((status) => ({
        status,
        label: (status.charAt(0).toUpperCase() + status.slice(1)).replace(/_/g, ' '),
        n: counts.get(status) ?? 0,
      }));
  });

  /**
   * The sweep's own numbers, from the pulse it writes.
   *
   * `daydream-sweep` records `testsRun` and `findings` at the top level and a
   * per-subject breakdown underneath. Older pulses predate the top-level pair,
   * so they are summed from `perSubject` instead of reported as zero — a
   * missing roll-up is not a night with no tests.
   */
  const sweepStats = $derived.by(() => {
    const details = (discoveries.sweep?.details ?? {}) as {
      testsRun?: number;
      findings?: number;
      perSubject?: Record<
        string,
        { testsRun?: number; naiveHits?: number; findings?: unknown[]; errors?: string[] }
      >;
    };
    const per = Object.values(details.perSubject ?? {});
    const sum = (pick: (s: (typeof per)[number]) => number) => per.reduce((a, s) => a + pick(s), 0);
    return {
      people: per.length,
      testsRun: details.testsRun ?? sum((s) => s.testsRun ?? 0),
      findings: details.findings ?? sum((s) => (s.findings ?? []).length),
      naiveHits: sum((s) => s.naiveHits ?? 0),
    };
  });

  function shareOf(n: number, total: number, noun: string): string {
    if (!total) return `nothing ${noun} yet`;
    return `${Math.round((n / total) * 100)}% of ${total}`;
  }

  const rollup = $derived<RollupCell[]>([
    {
      key: 'v-supported',
      mark: 'QUESTIONS',
      label: 'Held up',
      value: String(verdictCounts.supported),
      tone: verdictTone('supported'),
      sub: shareOf(verdictCounts.supported, board.length, 'asked'),
      onclick: () => pickVerdict('supported'),
      active: boardVerdict === 'supported',
    },
    {
      key: 'v-refuted',
      mark: 'QUESTIONS',
      label: 'Nothing there',
      value: String(verdictCounts.refuted),
      tone: verdictTone('refuted'),
      sub: shareOf(verdictCounts.refuted, board.length, 'asked'),
      onclick: () => pickVerdict('refuted'),
      active: boardVerdict === 'refuted',
    },
    {
      key: 'v-backwards',
      mark: 'QUESTIONS',
      label: 'Backwards',
      value: String(verdictCounts.wrong_direction),
      tone: verdictTone('wrong_direction'),
      sub: 'real, and the opposite of what was expected',
      onclick: () => pickVerdict('wrong_direction'),
      active: boardVerdict === 'wrong_direction',
    },
    {
      key: 'v-underpowered',
      mark: 'QUESTIONS',
      label: 'Thin data',
      value: String(verdictCounts.underpowered),
      tone: verdictTone('underpowered'),
      sub: 'not enough paired days to answer either way',
      onclick: () => pickVerdict('underpowered'),
      active: boardVerdict === 'underpowered',
    },
    {
      key: 'v-untested',
      mark: 'QUESTIONS',
      label: 'Unanswered',
      value: String(verdictCounts.untested),
      tone: verdictTone(null),
      sub: 'asked, waiting on the next test pass',
      onclick: () => pickVerdict('unanswered'),
      active: boardVerdict === 'unanswered',
    },
    ...leadStates.map(
      (s): RollupCell => ({
        key: `l-${s.status}`,
        mark: 'LINES',
        label: s.label,
        value: String(s.n),
        tone: leadTone(s.status),
        sub: LEAD_STATE_SUB[s.status] ?? shareOf(s.n, leads.length, 'opened'),
        onclick: () => pickLead(s.status),
        active: leadStatus === s.status,
      }),
    ),
    {
      key: 'sweep-tests',
      mark: 'SWEEP',
      label: 'Tests run',
      value: discoveries.sweep ? String(sweepStats.testsRun) : '—',
      tone: discoveries.sweep ? 'steady' : 'watch',
      corner: discoveries.sweep ? ago(String(discoveries.sweep.ts)) : null,
      sub: discoveries.sweep
        ? `every eligible pair, across ${sweepStats.people} ${sweepStats.people === 1 ? 'person' : 'people'}`
        : 'the nightly sweep has not reported yet',
      onclick: () => jump('sweep'),
    },
    {
      key: 'sweep-findings',
      mark: 'SWEEP',
      label: 'Survived correction',
      value: discoveries.sweep ? String(sweepStats.findings) : '—',
      tone: discoveries.sweep && sweepStats.findings > 0 ? 'good' : 'steady',
      sub: discoveries.sweep
        ? `${sweepStats.naiveHits} would have counted uncorrected`
        : 'nothing to correct yet',
      onclick: () => jump('sweep'),
    },
    {
      key: 'digest-days',
      mark: 'DIGESTS',
      label: 'Cards written',
      value: String(digests.length),
      tone: digests.length ? 'steady' : 'quiet',
      corner: digest?.day ?? null,
      sub: digests.length ? 'one a morning, plus the Sunday letter' : 'nothing written yet',
      onclick: () => jump('digests'),
    },
  ]);
</script>

{#if data.loadError}
  <section class="band"><div class="inner"><LoadErrorCard kicker="Discoveries did not load" message={data.loadError} /></div></section>
{/if}

<!-- The rollup. Not a table of rows: how the questions came out, how the lines
     are doing, what the sweep found, and how much has been written down. -->
<section class="band">
  <div class="inner">
    <SectionHead
      kicker="At a glance"
      title={['Everything asked,', 'and how it came out']}
      strap="Questions are pre-registered before any result is seen and answered by deterministic statistics. Empty answers are kept as long as the ones that held — a board of only its hits cannot be argued with."
    />
    <RollupGrid cells={rollup} min={196} />
  </div>
</section>

<!-- Yesterday, in one card. Quiet days are reported as clearly as busy ones —
     a digest that only appears when there is news cannot be trusted when it is
     silent. -->
{#if digest}
  <section class="band sunken">
    <div class="inner">
      <SectionHead kicker="A / Yesterday" title={['The morning', 'card']} strap={digest.day} />
      <div class="card t-steady">
        <p class="card-body lead">{digest.summary}</p>
        {#if digest.narrative}
          <blockquote class="quote" class:unchecked={digest.verified === false}>
            {digest.narrative}
            <span class="quote-tag" class:ok={digest.verified === true}>
              {digest.verified === true ? 'model · checked' : 'model · UNCHECKED'}
            </span>
          </blockquote>
        {/if}
      </div>
    </div>
  </section>
{/if}

<!-- What it has been wondering about. The model picks the questions; code
     answers them. Everything asked is shown, however it turned out. -->
<section class="band anchored" id="board">
  <div class="inner">
    <SectionHead
      kicker="B / What it wondered"
      title={['Questions asked', 'before the answers']}
      strap="The assistant chooses what to investigate before it sees any results, then deterministic statistics answer it. A question that came back empty is kept exactly as long as one that held."
    />
    <DiscoveriesBoard
      {board}
      who={boardWho}
      onwho={(id) => (boardWho = id)}
      verdict={boardVerdict}
      onverdict={(id) => (boardVerdict = id)}
      order={boardOrder}
      onorder={(id) => (boardOrder = id)}
    />
  </div>
</section>

<section class="band sunken anchored" id="leads">
  <div class="inner">
    <SectionHead
      kicker="C / Lines of enquiry"
      title={['Arcs it decided', 'to pursue']}
      strap="Each earns its keep from the questions inside its metric set — a line that keeps producing nothing is abandoned by arithmetic, not by mood."
    />
    <DiscoveriesLeads {leads} states={leadStates} status={leadStatus} onstatus={(id) => (leadStatus = id)} />
  </div>
</section>

<section class="band anchored" id="sweep">
  <div class="inner">
    <SectionHead
      kicker="D / The sweep"
      title={['Every pair,', 'every night']}
      strap={discoveries.sweep
        ? `Last reported ${ago(String(discoveries.sweep.ts))}`
        : 'The daily every-pair sweep has not reported yet.'}
    />
    <div class="card t-{discoveries.sweep ? 'steady' : 'watch'}">
      <p class="card-body">
        {discoveries.sweep
          ? discoveries.sweep.summary
          : 'Nothing to report. The sweep tests every pair of series it has enough days for, corrects for how many tests that was, and keeps only what survives.'}
      </p>
    </div>
  </div>
</section>

<section class="band sunken anchored" id="digests">
  <div class="inner">
    <SectionHead
      kicker="E / Digests"
      title={['Every morning', 'card it wrote']}
      strap="{digests.length} entries. The Sunday letter shares a day with that day's daily digest by design."
    />
    {#if digests.length === 0}
      <div class="card t-quiet"><p class="card-body">No digests yet.</p></div>
    {:else}
      <div class="stack tight">
        <!-- Keyed on subject AND day. The Sunday letter shares a day with that
             day's daily digest, and keying on the day alone threw
             `each_key_duplicate` — which does not degrade a row, it kills the
             component, so the whole tab stopped opening. -->
        {#each digests as d (`${d.subject}-${d.day}`)}
          <details class="disclose">
            <summary>
              <span class="disclose-day">{d.day}</span>
              {#if d.subject === 'weekly'}<span class="pill t-action">weekly</span>{/if}
              <span class="disclose-sum">{d.summary}</span>
            </summary>
            {#if d.narrative}
              <blockquote class="quote" class:unchecked={d.verified === false}>
                {d.narrative}
                <span class="quote-tag" class:ok={d.verified === true}>
                  {d.verified === true ? 'model · checked' : 'model · UNCHECKED'}
                </span>
              </blockquote>
            {/if}
          </details>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  /* Room-specific only. The model's phrasing is always shown AS the model's,
     and an unchecked one is drawn differently from a checked one — a composer
     that has quietly started refusing everything looks exactly like a quiet
     week otherwise. */
  .quote {
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-primary);
    background: var(--accent-ink-tint-06);
    border-left: 2px solid var(--accent-ink);
    border-radius: 0;
    padding: 14px 16px;
    margin: 14px 0 0;
    text-wrap: pretty;
  }
  .quote.unchecked {
    background: var(--warn-bg);
    border-left-color: var(--warn);
  }
  .quote-tag {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--warn);
    margin-top: 10px;
  }
  .quote-tag.ok {
    color: var(--good);
  }

  .disclose {
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--accent-ink);
    border-radius: 0;
    background: var(--surface-card);
    padding: 12px 16px;
  }
  .disclose summary {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    cursor: pointer;
    font-size: var(--fs-nav);
    color: var(--text-secondary);
  }
  .disclose summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .disclose-day {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .disclose-sum {
    min-width: 0;
  }
</style>
