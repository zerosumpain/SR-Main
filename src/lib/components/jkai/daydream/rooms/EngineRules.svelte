<script lang="ts">
  // The mesh: the model writes a rule, deterministic code evaluates it, and
  // nothing fires until it is approved here.
  //
  // The monolith hid this whole section when there were no rules, which meant
  // the one honest answer — "it has never proposed anything" — was
  // indistinguishable from a section that had failed to render, and the
  // lettering of every section below it moved. It now always draws, opening on
  // the count in each state.
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';

  interface Rule {
    id: string;
    kind: string;
    spec: { description?: string } | null;
    status: string;
    rationale: string;
    proposalKind: string;
    backtestNote: string | null;
    backtestLowerBound: boolean;
    firedCount: number;
    usefulCount: number;
    notUsefulCount: number;
  }

  interface Props {
    rules: Rule[];
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
  }

  let { rules, busy, act }: Props = $props();

  const proposed = $derived(rules.filter((r) => r.status === 'proposed'));
  const active = $derived(rules.filter((r) => r.status === 'active'));
  const closed = $derived(rules.filter((r) => r.status === 'rejected' || r.status === 'deprecated'));
  const fired = $derived(rules.reduce((n, r) => n + r.firedCount, 0));
  const useful = $derived(rules.reduce((n, r) => n + r.usefulCount, 0));
  const notUseful = $derived(rules.reduce((n, r) => n + r.notUsefulCount, 0));

  const tiles = $derived<DeckTile[]>([
    {
      key: 'proposed',
      label: 'Waiting on you',
      value: String(proposed.length),
      tone: proposed.length ? 'action' : 'good',
      lit: proposed.length > 0,
      sub: proposed.length ? 'validated and backtested already' : 'nothing to approve',
    },
    {
      key: 'active',
      label: 'Live',
      value: String(active.length),
      tone: active.length ? 'good' : 'quiet',
      sub: active.length ? 'evaluated on every detect tick' : 'no rule can fire',
    },
    {
      key: 'fired',
      label: 'Times fired',
      value: String(fired),
      tone: 'steady',
      sub: `${useful}↑ ${notUseful}↓ from you`,
    },
    {
      key: 'closed',
      label: 'Rejected or retired',
      value: String(closed.length),
      tone: 'quiet',
      sub: 'kept as a record, never evaluated',
    },
  ]);
</script>

<StatDeck tiles={tiles} min={210} />

{#if rules.length === 0}
  <div class="card t-quiet">
    <p class="card-body">
      Nothing proposed yet. The rulesmith writes these; until it does, every thought comes from a
      hand-written detector.
    </p>
  </div>
{/if}

{#if proposed.length}
  <div class="stack">
    {#each proposed as r (r.id)}
      <article class="card t-action">
        <div class="card-hd">
          <p class="card-title as-text">{r.spec?.description ?? r.kind}</p>
          <span class="pill t-action">{r.proposalKind}</span>
        </div>
        <p class="card-body">{r.rationale}</p>
        <div class="card-meta">
          <span class="tag">{r.kind}</span>
          <span class="meta-item">{r.backtestNote ? r.backtestNote : 'not backtested'}</span>
        </div>
        {#if r.backtestLowerBound}
          <p class="note warn">
            Estimate is a floor, not a count — the replay could not rebuild every fact this rule
            uses, so it will fire more often than shown.
          </p>
        {/if}
        <div class="card-actions bar">
          <button
            type="button"
            class="cta"
            disabled={busy === `rule:${r.id}`}
            onclick={() => act({ action: 'decide_rule', ruleId: r.id, decision: 'approve' }, `rule:${r.id}`)}
          >
            Approve
          </button>
          <button
            type="button"
            class="btn danger"
            disabled={busy === `rule:${r.id}`}
            onclick={() => act({ action: 'decide_rule', ruleId: r.id, decision: 'reject' }, `rule:${r.id}`)}
          >
            Reject
          </button>
        </div>
      </article>
    {/each}
  </div>
{/if}

{#if active.length}
  <div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr>
          <th>Rule</th>
          <th>What it says</th>
          <th class="right">Fired</th>
          <th class="right">Votes</th>
          <th class="right">Do</th>
        </tr>
      </thead>
      <tbody>
        {#each active as r (r.id)}
          <tr>
            <td class="nowrap">{r.kind}</td>
            <td class="cell-lead cell-wrap">{r.spec?.description ?? ''}</td>
            <td class="right num">{r.firedCount}</td>
            <td class="right nowrap">{r.usefulCount}↑ {r.notUsefulCount}↓</td>
            <td class="right">
              <button
                type="button"
                class="btn danger"
                disabled={busy === `rule:${r.id}`}
                onclick={() => act({ action: 'decide_rule', ruleId: r.id, decision: 'deprecate' }, `rule:${r.id}`)}
              >
                Retire
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  /* Not in the shared vocabulary: a card head that sets a title against a
     status pill, and the rule above an action bar that separates reading the
     proposal from deciding on it. */
  .card-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .card-actions.bar {
    padding-top: 14px;
    border-top: 1px solid var(--line-hair);
  }
</style>
