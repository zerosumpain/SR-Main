<script lang="ts">
  // The engine room, as an instrument panel.
  //
  // It used to end on the jobs table: thirteen rows of mono text, last on a
  // page that opened with a provenance essay. That is the wrong way round —
  // "is it running, and what did each pass say" is the question you come here
  // with, and "what actually reaches the reasoning" is the answer you leave
  // with. So the activity board is first and the provenance measurement is
  // last, and the table the board replaces survives underneath it, folded, for
  // the columns a cell has no room for.
  import { postThought } from '$lib/daydream/feed-client';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import Sparkline from '$lib/components/jkai/daydream/Sparkline.svelte';
  import EngineActivityPanel from '$lib/components/jkai/daydream/rooms/EngineActivityPanel.svelte';
  import EngineRules from '$lib/components/jkai/daydream/rooms/EngineRules.svelte';
  import EngineDetectors from '$lib/components/jkai/daydream/rooms/EngineDetectors.svelte';
  import EngineProvenance from '$lib/components/jkai/daydream/rooms/EngineProvenance.svelte';
  import EngineRoutes from '$lib/components/jkai/daydream/rooms/EngineRoutes.svelte';
  import EngineDelivery from '$lib/components/jkai/daydream/rooms/EngineDelivery.svelte';
  import { ago, pct } from '$lib/components/jkai/daydream/rooms/engine-format';

  let { data }: { data: PageData } = $props();

  const engine = $derived(data.engine);
  const detectors = $derived(data.detectors ?? []);
  const counts = $derived(data.counts);
  const budget = $derived(data.budget);
  const rules = $derived(data.rules ?? []);
  const telemetry = $derived(data.telemetry);
  const delivery = $derived(data.delivery);
  const provenance = $derived(data.provenance);
  const routes = $derived(data.routes ?? {});
  const deliveryStats = $derived(data.deliveryStats);
  /** The kinds the routes grid can offer as a new exception. The detectors are
   *  the engine's own list; the mail lanes reach the grid through the defaults. */
  const detectorKinds = $derived(detectors.map((d) => d.kind));

  const readyCount = $derived(detectors.filter((d) => d.readiness?.ready).length);
  const mutedCount = $derived(detectors.filter((d) => d.muted).length);
  /** Has the engine ever actually run? Distinguishes "quiet" from "not wired". */
  const hasRun = $derived(engine.lastDetectAt != null);
  const failedSources = $derived(engine.sources.filter((s) => s.status === 'failed'));

  // ── Actions ───────────────────────────────────────────────────────────────
  // Same endpoint and the same action names as the monolith: the room moved,
  // the contract did not.
  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  async function post(body: Record<string, unknown>, key: string) {
    busy = key;
    actionError = null;
    const r = await postThought(body);
    if (!r.ok) actionError = r.error ?? 'that did not work';
    else await invalidateAll();
    busy = null;
    return r.ok;
  }

  let backfilling = $state(false);
  let backfillNote = $state<string | null>(null);

  async function runBackfill() {
    backfilling = true;
    backfillNote = null;
    try {
      const res = await fetch('/api/daydream/backfill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 30 }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        error?: string;
        backfill?: { fixesKept: number; daysFetched: number; fixesSeen: number; entity: string | null };
        places?: { created: number } | null;
      };
      if (!res.ok || out.error) {
        backfillNote = out.error ?? 'backfill failed';
      } else {
        const b = out.backfill;
        backfillNote =
          `Pulled ${b?.daysFetched ?? 0} days from ${b?.entity ?? 'Home Assistant'}: ` +
          `${b?.fixesSeen ?? 0} fixes seen, ${b?.fixesKept ?? 0} kept` +
          (out.places ? `, ${out.places.created} new places` : '');
        await invalidateAll();
      }
    } catch {
      backfillNote = 'backfill failed';
    } finally {
      backfilling = false;
    }
  }

  // ── Decks ─────────────────────────────────────────────────────────────────

  const engineTiles = $derived<DeckTile[]>([
    {
      key: 'trail',
      label: 'Days of trail',
      value: String(engine.trailSpanDays ?? 0),
      tone: hasRun ? 'steady' : 'urgent',
      sub: `observed ${ago(engine.lastObserveAt)}`,
    },
    {
      key: 'coverage',
      label: 'Covered, 24h',
      value: pct(engine.coverage?.last24h),
      tone: (engine.coverage?.last24h ?? 0) >= 0.5 ? 'good' : 'watch',
      sub: `7d ${pct(engine.coverage?.last7d)}`,
    },
    {
      key: 'detectors',
      label: 'Detectors ready',
      value: String(readyCount),
      suffix: `/${detectors.length}`,
      tone: detectors.length && readyCount === detectors.length ? 'good' : 'watch',
      sub: `${mutedCount} muted by you`,
    },
    {
      key: 'places',
      label: 'Places named',
      value: String(counts.namedPlaces),
      suffix: `/${counts.places}`,
      tone: counts.unnamedPlaces ? 'action' : 'good',
      sub: `${counts.unnamedPlaces} still unnamed`,
    },
  ]);

  const budgetTiles = $derived.by((): DeckTile[] => {
    if (!budget || !budget.applies) return [];
    return [
      {
        key: 'today',
        label: 'Of weekly, today',
        value: String(budget.spentTodayWeeklyPct),
        suffix: `/${budget.dailyCapPct}%`,
        tone: budget.spentTodayWeeklyPct > budget.dailyCapPct ? 'urgent' : 'steady',
        sub: `paced target ${budget.pacedTargetPct}%`,
      },
      {
        key: 'window',
        label: 'Of this 5h window',
        value: String(budget.spentThisWindowPct),
        suffix: `/${budget.fiveHourCapPct}%`,
        tone: budget.spentThisWindowPct > budget.fiveHourCapPct ? 'urgent' : 'steady',
        sub: `${budget.remainingWindowPct}% left`,
      },
      {
        key: 'depth',
        label: 'Working depth',
        value: String(budget.plan.depth),
        tone: budget.blocked ? 'urgent' : budget.reachable ? 'good' : 'watch',
        sub: `${budget.plan.maxCandidates} candidate${budget.plan.maxCandidates === 1 ? '' : 's'}${budget.plan.verify ? ', verified' : ''}`,
      },
    ];
  });
</script>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / The engine at work"
      title={['Every pass,', 'in the order it runs']}
      strap="One cell per scheduled activity, grouped by the stage of the loop it belongs to. A pass that has only ever skipped looks exactly like one that ran and found nothing — the outcome word is the difference, and a failing streak outranks everything else in this room."
    />

    {#if data.loadError}
      <LoadErrorCard kicker="The ledger could not be read" message={data.loadError} />
    {/if}
    {#if actionError}<p class="err">{actionError}</p>{/if}

    <EngineActivityPanel jobs={telemetry?.jobs ?? []} schedules={data.schedules ?? []} />
  </div>
</section>

<section class="band sunken" id="dd-sources">
  <div class="inner">
    <SectionHead
      kicker="B / Engine state"
      title={['Has it actually', 'been running?']}
      strap={hasRun
        ? `Last looked ${ago(engine.lastDetectAt)}.`
        : 'It has never run. Everything below is therefore a zero about the engine, not about your life.'}
    >
      {#snippet aside()}
        <button type="button" class="btn" disabled={backfilling} onclick={runBackfill}>
          {backfilling ? 'Pulling history…' : 'Backfill from Home Assistant'}
        </button>
      {/snippet}
    </SectionHead>

    <StatDeck tiles={engineTiles} min={210} />

    {#if engine.summary}<p class="lede">{engine.summary}</p>{/if}
    {#if backfillNote}<p class="note good">{backfillNote}</p>{/if}

    {#if engine.pausedActions.length}
      <div class="card t-watch">
        <p class="card-kicker">Not running</p>
        <p class="card-body">{engine.pausedActions.join(', ')}</p>
      </div>
    {/if}

    {#if failedSources.length}
      <div class="card t-urgent">
        <p class="card-kicker">Sources that failed last tick</p>
        <p class="card-body">{failedSources.map((s) => `${s.key} (${s.detail})`).join('; ')}</p>
      </div>
    {/if}

    {#if delivery?.hasWhatsApp}
      <div class="card t-good">
        <p class="card-kicker">Delivery</p>
        <p class="card-body">
          Over <strong>WhatsApp</strong> — reply 👍 / 👎 / “never” to any thought within 12 hours and
          it counts as feedback.
        </p>
      </div>
    {:else if delivery && !delivery.hasPushSubscriber}
      <!-- The documented root cause of the empty feedback ledger: with nowhere
           to push, every thought falls back to a chat note whose feedback link
           is rarely followed, so the learning loop never gets an input. -->
      <div class="card t-urgent">
        <p class="card-kicker">Nowhere to deliver</p>
        <p class="card-body">
          No WhatsApp number and no push subscriber, so thoughts fall back to chat notes — and
          without feedback the confidence threshold never relaxes. The sorting deck in the
          <a class="link" href="/jkai/daydreams/feed">feed</a> is the way round it.
        </p>
      </div>
    {/if}
  </div>
</section>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="C / Budget"
      title={['What thinking', 'is allowed to cost']}
      strap={budget ? `Running ${budget.modelId}.` : 'Could not read the model or the usage meter.'}
    />

    {#if !budget}
      <div class="card t-urgent">
        <p class="card-body">Could not read the model or the usage meter.</p>
      </div>
    {:else if !budget.applies}
      <div class="card t-steady">
        <p class="card-body">
          Running on <strong>{budget.provider}</strong>, so the subscription caps do not apply — this
          spend is cash, and nothing here limits it.
        </p>
      </div>
    {:else}
      <StatDeck tiles={budgetTiles} min={230} />
      {#if budget.blocked}
        <div class="card t-urgent">
          <p class="card-kicker">Paused</p>
          <p class="card-body">{budget.blockedReason}</p>
        </div>
      {:else if !budget.reachable}
        <div class="card t-watch">
          <p class="card-kicker">Usage meter unreachable</p>
          <p class="card-body">Working at minimum depth rather than stopping.</p>
        </div>
      {/if}
      <p class="lede">
        Spare budget buys more <strong>thinking</strong>, never more notifications: extra headroom
        adds a verification pass and more candidates considered. What reaches your phone is capped
        separately at {delivery?.maxPerDay ?? 4} a day.
      </p>
    {/if}
  </div>
</section>

<section class="band sunken" id="dd-rules">
  <div class="inner">
    <SectionHead
      kicker="D / Rules jkai wrote"
      title={['Proposed as data,', 'never as code']}
      strap="A condition over a fixed list of facts. Each is validated and replayed against your history before it reaches you, and nothing fires until you approve it."
    />
    <EngineRules {rules} {busy} act={post} />
  </div>
</section>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="E / Detectors"
      title={['What each one', 'is waiting for']}
      strap="Each declares the history it needs before it may speak and returns nothing below that. A weight of ×1.00 means the ledger has no opinion about it yet."
    />
    <EngineDetectors {detectors} {busy} act={post} />
  </div>
</section>

<section class="band sunken">
  <div class="inner">
    <SectionHead
      kicker="F / Coverage"
      title={['How much of', 'each day it saw']}
      strap="Thirty days. A low figure is a phone that stopped reporting, not a day nobody moved — the two are the same shape in the data and only this line separates them. A gap is a day with no row at all."
    />
    {#if (telemetry?.coverage ?? []).length >= 2}
      <div class="chart">
        <Sparkline
          points={(telemetry?.coverage ?? []).map((c) => ({ label: c.day, value: c.coverage }))}
          max={1}
          format={(v) => `${Math.round(v * 100)}%`}
          height={72}
        />
      </div>
    {:else}
      <div class="card t-quiet"><p class="card-body">Not enough day rows yet.</p></div>
    {/if}
  </div>
</section>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="G / Ponder telemetry"
      title={['The fabrication', 'meter']}
      strap="“Audit dropped” counts musings deleted for citing evidence that does not exist. A rising number means the model is reaching; zero means the wide view is holding."
    />
    {#if (telemetry?.ponderRuns ?? []).length === 0}
      <div class="card t-quiet"><p class="card-body">No ponder cycles yet.</p></div>
    {:else}
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th class="right">Cards in</th>
              <th class="right">Musings</th>
              <th class="right">Kept</th>
              <th class="right">Held</th>
              <th class="right">Audit dropped</th>
              <th class="right">Leads</th>
            </tr>
          </thead>
          <tbody>
            {#each telemetry?.ponderRuns ?? [] as r (String(r.ts))}
              <tr>
                <td class="nowrap">{ago(String(r.ts))}</td>
                <td class="right num">{r.cards ?? '—'}</td>
                <td class="right num">{r.proposed ?? '—'}</td>
                <td class="right num">{r.created ?? '—'}</td>
                <td class="right num">{r.suppressed ?? '—'}</td>
                <td class="right num" class:bad={(r.dropped ?? 0) > 0}>{r.dropped ?? '—'}</td>
                <td class="right num">{r.leads ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

<section class="band sunken" id="dd-provenance">
  <div class="inner">
    <SectionHead
      kicker="H / What reaches the reasoning"
      title={['Registered is not', 'the same as used']}
      strap="A series joins the sweep only once it has {provenance.minPairs} observed days, and the proposer may only ask about a fixed vocabulary — so a sensor can be recording, correlating and still never be the subject of a question."
    />
    <p class="lede">
      {provenance.sweepable} of {provenance.registered} registered signals are in the sweep. Each cell
      counts the paths out of a source that are measurably carrying something, and wears the tone of
      its worst one; a path closed on purpose is drawn differently from one that is broken.
    </p>
    <EngineProvenance sources={provenance.sources} />
  </div>
</section>

<section class="band" id="dd-routes">
  <div class="inner">
    <SectionHead
      kicker="I / Where each kind may go"
      title={['A ceiling,', 'never a promise']}
      strap="Set the highest channel a family — or one kind inside it — is allowed to reach. Kind beats family; clearing an override puts the row back on the default, so a later change to the defaults still moves it."
    />
    <EngineRoutes {routes} kinds={detectorKinds} onchanged={invalidateAll} />
  </div>
</section>

<section class="band sunken" id="dd-delivery">
  <div class="inner">
    <SectionHead
      kicker="J / What reached you"
      title={['Sent, held,', 'and the next slot']}
      strap="The interruption budget, and every reason a thought was held today. A hold is the routes and the policy doing their job — it is only a fault when the same reason is the whole column."
    />
    {#if deliveryStats}
      <EngineDelivery stats={deliveryStats} />
    {:else}
      <div class="card t-quiet"><p class="card-body">The delivery ledger could not be read.</p></div>
    {/if}
  </div>
</section>

<style>
  .chart {
    border: 1px solid var(--card-border);
    background: var(--surface-card);
    padding: 16px;
    margin-top: 18px;
  }
</style>
