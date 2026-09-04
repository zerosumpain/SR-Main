<script lang="ts">
  // The themes hiding in the queue.
  //
  // Measured on production: 455 backlog rows collapse to about **113 themes**,
  // 380 of the rows falling into one. The biggest are ten ways of asking for
  // the same tool — "Live OpenRouter balance", "Live OpenRouter balance query",
  // "Live OpenRouter account balance API" — each one a slot the engine would
  // spend rebuilding something it has already been asked for.
  //
  // Accepting a theme GROUPS its members, so the board below shows them in one
  // swimlane. It does not fold them: "about the same subject" is a judgement a
  // matcher may make, "says the same thing" abandons rows and stays the
  // owner's, one item at a time, inside the lane.
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import type { EpicData } from '$lib/selfimprove/types';
  import type { WorkItem } from '$lib/selfimprove/board';
  import { ago } from '$lib/daydream/format';

  interface Props {
    epics: EpicData[];
    error: string | null;
    /** The board's items, so a theme can show what its members actually say. */
    items: WorkItem[];
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
  }

  let { epics, error, items, busy, act }: Props = $props();

  let expanded = $state<string[]>([]);
  let showSettled = $state(false);

  const bySlug = $derived(new Map(items.filter((i) => i.source === 'backlog').map((i) => [i.slug, i])));
  const proposed = $derived(
    [...epics.filter((e) => e.status === 'proposed')].sort((a, b) => b.score - a.score || b.memberSlugs.length - a.memberSlugs.length),
  );
  const accepted = $derived(epics.filter((e) => e.status === 'accepted'));
  const declined = $derived(epics.filter((e) => e.status === 'declined'));

  /** Open members that a shipped sibling already appears to cover — the reason
   *  a theme is worth ruling on rather than merely tidy. */
  function served(e: EpicData): number {
    return e.memberSlugs.filter((s) => bySlug.get(s)?.alreadyServed).length;
  }
  function openMembers(e: EpicData): WorkItem[] {
    return e.memberSlugs
      .map((s) => bySlug.get(s))
      .filter((i): i is WorkItem => !!i && i.stage !== 'live' && i.stage !== 'parked');
  }
  function shippedMembers(e: EpicData): WorkItem[] {
    return e.memberSlugs.map((s) => bySlug.get(s)).filter((i): i is WorkItem => !!i && i.stage === 'live');
  }

  /** The score, spelled out. A number nobody can decompose is a number nobody
   *  should act on — the rule the appetite board follows. */
  function why(e: EpicData): string {
    const c = e.components ?? {};
    const bits: string[] = [];
    const open = openMembers(e).length;
    if (c.size) bits.push(`${open} open restatement${open === 1 ? '' : 's'}`);
    if (c.served) bits.push(`${served(e)} already served`);
    if (c.shipped) bits.push('something on this theme has shipped');
    return bits.length ? bits.join(' + ') : 'grouped, nothing pressing';
  }

  const tiles = $derived<DeckTile[]>([
    {
      key: 'proposed',
      label: 'Themes waiting on you',
      value: String(proposed.length),
      tone: proposed.length ? 'action' : 'good',
      lit: proposed.length > 0,
      sub: proposed.length ? 'accepting one groups its members on the board' : 'nothing to rule on',
    },
    {
      key: 'covered',
      label: 'Queued ideas in a theme',
      value: String(proposed.reduce((n, e) => n + openMembers(e).length, 0)),
      tone: 'steady',
      sub: 'open items these proposals would group',
    },
    {
      key: 'served',
      label: 'Of those, already served',
      value: String(proposed.reduce((n, e) => n + served(e), 0)),
      tone: proposed.some((e) => served(e)) ? 'urgent' : 'quiet',
      sub: 'a shipped sibling appears to cover them',
    },
    {
      key: 'accepted',
      label: 'Grouped',
      value: String(accepted.length),
      tone: accepted.length ? 'good' : 'quiet',
      sub: `${declined.length} declined and kept as a no`,
    },
  ]);
</script>

<StatDeck {tiles} min={210} />

<div class="controls tp-controls">
  <div class="actions">
    <button type="button" class="cta" disabled={busy === 'cluster'} onclick={() => act({ action: 'backlog_cluster' }, 'cluster')}>
      {busy === 'cluster' ? 'Reading the queue…' : 'Find themes now'}
    </button>
    {#if accepted.length || declined.length}
      <button type="button" class="btn" aria-pressed={showSettled} onclick={() => (showSettled = !showSettled)}>
        {showSettled ? 'Hide' : 'Show'} settled ({accepted.length + declined.length})
      </button>
    {/if}
  </div>
  <p class="note">
    No model is asked anything here. Two titles are the same subject when they share three
    content words — the one definition of “related” in this engine, the same one the ledger
    uses to say an idea already shipped. Each item is joined only to its single strongest
    match, so a generic title cannot weld two themes together.
  </p>
</div>

{#if error}
  <div class="card t-urgent"><p class="card-body">The themes could not be read: {error}</p></div>
{:else if epics.length === 0}
  <div class="card t-quiet">
    <p class="card-body">
      Nothing grouped yet. <strong>Find themes now</strong> reads the queue and proposes the
      groupings it finds; it costs nothing and writes only proposals.
    </p>
  </div>
{/if}

{#snippet themeCard(e: EpicData, actionable: boolean)}
  {@const open = openMembers(e)}
  {@const ship = shippedMembers(e)}
  {@const isOpen = expanded.includes(e.slug)}
  <article class="card t-{e.status === 'proposed' ? 'action' : e.status === 'accepted' ? 'good' : 'quiet'}">
    <div class="card-hd">
      <p class="card-title as-text">{e.label}</p>
      <span class="pill t-{e.status === 'proposed' ? 'action' : e.status === 'accepted' ? 'good' : 'quiet'}">
        {e.status === 'proposed' ? 'waiting on you' : e.status}
      </span>
    </div>
    <p class="card-body">
      <strong>{open.length}</strong> open {open.length === 1 ? 'idea' : 'ideas'} say this
      {#if ship.length}· <strong>{ship.length}</strong> already shipped on the same theme{/if}
    </p>
    <div class="card-meta">
      {#each e.keywords as k (k)}<span class="tag">{k}</span>{/each}
      <span class="meta-item">scored {e.score.toFixed(2)} — {why(e)}</span>
      <span class="meta-item">{ago(e.createdAt)}</span>
    </div>

    <button type="button" class="btn sm reveal" aria-expanded={isOpen}
      onclick={() => (expanded = isOpen ? expanded.filter((s) => s !== e.slug) : [...expanded, e.slug])}>
      {isOpen ? 'Hide' : 'Show'} the {e.memberSlugs.length} ideas
    </button>

    {#if isOpen}
      <ul class="members">
        {#each e.memberSlugs as slug (slug)}
          {@const m = bySlug.get(slug)}
          <li class:gone={!m}>
            {#if m}
              <span class="m-stage">{m.stage}</span>
              <span class="m-title">{m.title}</span>
              {#if m.alreadyServed}<span class="m-flag">already served</span>{/if}
            {:else}
              <span class="m-stage">gone</span>
              <span class="m-title mono">{slug}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if actionable}
      <div class="card-actions bar">
        <button type="button" class="cta" disabled={busy === `epic:${e.slug}`}
          onclick={() => act({ action: 'epic_decide', slug: e.slug, decision: 'accept' }, `epic:${e.slug}`)}>
          Group these
        </button>
        <button type="button" class="btn danger" disabled={busy === `epic:${e.slug}`}
          onclick={() => act({ action: 'epic_decide', slug: e.slug, decision: 'decline' }, `epic:${e.slug}`)}>
          Not one thing
        </button>
      </div>
    {:else if e.status === 'accepted'}
      <div class="card-actions bar">
        <button type="button" class="btn" disabled={busy === `epic:${e.slug}`}
          onclick={() => act({ action: 'epic_decide', slug: e.slug, decision: 'ungroup' }, `epic:${e.slug}`)}>
          Ungroup
        </button>
      </div>
    {/if}
  </article>
{/snippet}

{#if proposed.length}
  <h3 class="sub">Waiting on you</h3>
  <div class="stack">
    {#each proposed as e (e.slug)}{@render themeCard(e, true)}{/each}
  </div>
{/if}

{#if showSettled && (accepted.length || declined.length)}
  <h3 class="sub">Settled</h3>
  <div class="stack">
    {#each [...accepted, ...declined] as e (e.slug)}{@render themeCard(e, false)}{/each}
  </div>
{/if}

<style>
  .tp-controls {
    margin-top: clamp(16px, 2vw, 24px);
  }
  .sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: clamp(20px, 3vw, 32px) 0 10px;
  }
  .reveal {
    margin-top: 14px;
  }
  .members {
    list-style: none;
    margin: 12px 0 0;
    padding: 12px 0 0;
    border-top: 1px solid var(--line-hair);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .members li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    font-size: var(--fs-nav);
    line-height: 1.4;
    color: var(--text-secondary);
  }
  .members li.gone {
    opacity: 0.6;
  }
  .m-stage {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    flex: 0 0 74px;
  }
  .m-title {
    flex: 1 1 240px;
    min-width: 0;
  }
  .m-flag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--error);
    background: var(--error-bg);
    padding: 1px 6px;
    white-space: nowrap;
  }
</style>
