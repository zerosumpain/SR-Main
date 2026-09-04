<script lang="ts">
  // What the site should be able to do and cannot.
  //
  // Every other panel in this room reports on the machine that exists. This one
  // is the only place the engine gets to want something — and the design job it
  // has is to make the INFLUENCE legible: what evidence produced each lead, how
  // its score was arrived at, and what became of it. No sentence here is
  // written by a model. The need and the value are the proposer's own words,
  // already through the citation audit; everything around them is assembled
  // from recorded columns, the rule `narrative.ts` set.
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import type { AppetiteView, AppetiteLead } from '$lib/daydream/appetite/view';
  import { KIND_LABEL, LANE_LABEL, STATUS_LABEL, statusTone } from '$lib/daydream/appetite/view';
  import { ago } from '$lib/daydream/format';

  interface Props {
    view: AppetiteView;
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
  }

  let { view, busy, act }: Props = $props();

  const waiting = $derived(view.leads.filter((l) => l.status === 'proposed'));
  const inFlight = $derived(view.leads.filter((l) => l.status === 'queued' || l.status === 'building'));
  const settled = $derived(view.leads.filter((l) => l.status === 'shipped' || l.status === 'declined'));

  const tiles = $derived<DeckTile[]>([
    {
      key: 'waiting',
      label: 'Ideas waiting on you',
      value: String(view.counts.byStatus.proposed ?? 0),
      tone: waiting.length ? 'action' : 'good',
      lit: waiting.length > 0,
      sub: waiting.length ? 'accepted ones go to the next build slot' : 'nothing to rule on',
    },
    {
      key: 'newdata',
      label: 'Bringing new data in',
      value: String(view.newDataOpen),
      tone: view.newDataOpen ? 'good' : 'quiet',
      sub: 'sources, feeds and watches — these take the reserved slots',
    },
    {
      key: 'flight',
      label: 'Being built',
      value: String(inFlight.length),
      tone: inFlight.length ? 'steady' : 'quiet',
      sub: inFlight.length ? 'queued or in a lane' : 'no lane is working',
    },
    {
      key: 'shipped',
      label: 'Shipped all time',
      value: String(view.counts.byStatus.shipped ?? 0),
      tone: (view.counts.byStatus.shipped ?? 0) ? 'good' : 'quiet',
      sub: `${view.counts.byStatus.declined ?? 0} declined and kept as a no`,
    },
  ]);

  /** The score, spelled out. A number nobody can decompose is a number nobody
   *  should act on — the same rule the thought cards follow. */
  function why(lead: AppetiteLead): string {
    const c = lead.components ?? {};
    const bits: string[] = [];
    if (c.evidence) bits.push(`${lead.cites.length} citation${lead.cites.length === 1 ? '' : 's'}`);
    if (c.dataGain) bits.push(`${KIND_LABEL[lead.kind] ?? lead.kind} lane`);
    if (c.persistence) bits.push(`${lead.recurrence} nights running`);
    return bits.length ? bits.join(' + ') : 'base score only';
  }
</script>

<StatDeck tiles={tiles} min={210} />

{#if view.error}
  <div class="card t-urgent"><p class="card-body">The appetite ledger could not be read: {view.error}</p></div>
{:else if view.leads.length === 0}
  <div class="card t-quiet">
    <p class="card-body">
      Nothing proposed yet. The appetite scan runs each evening against an inventory of every source,
      API, toolset, watch, feed and schedule the site can already reach — until it has run, every
      capability here came from a fault, which is a repair rather than an idea.
    </p>
  </div>
{/if}

{#snippet leadCard(l: AppetiteLead, actionable: boolean)}
  <article class="card t-{statusTone(l.status)}">
    <div class="card-hd">
      <p class="card-title as-text">{l.title}</p>
      <span class="pill t-{statusTone(l.status)}">{STATUS_LABEL[l.status] ?? l.status}</span>
    </div>
    <p class="card-body">{l.need}</p>
    <p class="card-body value">{l.value}</p>
    <div class="card-meta">
      <span class="tag">{KIND_LABEL[l.kind] ?? l.kind}</span>
      <span class="meta-item">for {l.consumer}</span>
      {#if l.lane}<span class="meta-item">{LANE_LABEL[l.lane] ?? l.lane} lane</span>{/if}
      <span class="meta-item">scored {l.score.toFixed(2)} — {why(l)}</span>
      <span class="meta-item">{ago(l.lastSeenAt)}</span>
    </div>
    {#if l.evidence.length}
      <p class="note">Because: {l.evidence.join(' · ')}</p>
    {/if}
    {#if l.integrationHint}
      <p class="note">How it would arrive: {l.integrationHint}</p>
    {/if}
    {#if l.outcome}
      <p class="note done">
        {l.outcome}
        {#if l.outcomeRef}<a href={l.outcomeHref ?? l.outcomeRef}>{l.outcomeRef}</a>{/if}
      </p>
    {/if}
    {#if actionable}
      <div class="card-actions bar">
        <button
          type="button"
          class="cta"
          disabled={busy === `cap:${l.slug}`}
          onclick={() => act({ action: 'capability_decide', slug: l.slug, decision: 'accept' }, `cap:${l.slug}`)}
        >
          Build this
        </button>
        <button
          type="button"
          class="btn danger"
          disabled={busy === `cap:${l.slug}`}
          onclick={() => act({ action: 'capability_decide', slug: l.slug, decision: 'decline' }, `cap:${l.slug}`)}
        >
          Not wanted
        </button>
      </div>
    {/if}
  </article>
{/snippet}

{#if waiting.length}
  <h3 class="sub">Waiting on you</h3>
  <div class="stack">
    {#each waiting as l (l.slug)}{@render leadCard(l, true)}{/each}
  </div>
{/if}

{#if inFlight.length}
  <h3 class="sub">In a lane</h3>
  <div class="stack">
    {#each inFlight as l (l.slug)}{@render leadCard(l, false)}{/each}
  </div>
{/if}

{#if settled.length}
  <h3 class="sub">Settled</h3>
  <div class="stack">
    {#each settled as l (l.slug)}{@render leadCard(l, false)}{/each}
  </div>
{/if}

<style>
  .sub {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: clamp(20px, 3vw, 32px) 0 10px;
  }
  .value {
    color: var(--text-secondary);
  }
  .note.done {
    color: var(--text-secondary);
  }
  .note.done a {
    margin-left: 6px;
  }
</style>
