<script lang="ts">
  // Detected themes can be grouped or consolidated into a retained epic brief.
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

  // Counts come from the RECORDED split, never from the board's stage. Two
  // reasons, both of which produced a wrong number in review: `stageFor` maps a
  // shipped row to `verifying` whenever its tool has never been called — the
  // normal case here, 32 tools of 79 — so `stage === 'live'` is not "this
  // shipped"; and the board trims its settled rows, so a shipped member can be
  // absent from `items` altogether. Either mistake drops the "already shipped
  // on the same theme" line, which is the half that makes a theme worth ruling
  // on at all.
  function openCount(e: EpicData): number {
    return (e.openSlugs ?? e.memberSlugs).length;
  }
  function shippedCount(e: EpicData): number {
    return (e.shippedSlugs ?? []).length;
  }
  /** Open members a shipped sibling already appears to cover. Live where the
   *  board has the row, and the count recorded at proposal time otherwise. */
  function served(e: EpicData): number {
    const live = e.memberSlugs.filter((s) => bySlug.get(s)?.alreadyServed).length;
    return bySlug.size ? Math.max(live, e.servedCount ?? 0) : (e.servedCount ?? 0);
  }

  /** The score, spelled out. A number nobody can decompose is a number nobody
   *  should act on — the rule the appetite board follows. */
  function why(e: EpicData): string {
    const c = e.components ?? {};
    const bits: string[] = [];
    const open = openCount(e);
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
      value: String(proposed.reduce((n, e) => n + openCount(e), 0)),
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
  <p class="note">Find related ideas, then auto-merge a theme into one queued epic. Every source brief is retained. Only unstarted ideas in the same delivery category are eligible.</p>
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
  {@const open = openCount(e)}
  {@const ship = shippedCount(e)}
  {@const isOpen = expanded.includes(e.slug)}
  <article class="card t-{e.status === 'proposed' ? 'action' : e.status === 'accepted' ? 'good' : 'quiet'}">
    <div class="card-hd">
      <p class="card-title as-text">{e.label}</p>
      <span class="pill t-{e.status === 'proposed' ? 'action' : e.status === 'accepted' ? 'good' : 'quiet'}">
        {e.status === 'proposed' ? 'waiting on you' : e.status}
      </span>
    </div>
    <p class="card-body">
      <strong>{open}</strong> open {open === 1 ? 'idea' : 'ideas'} say this
      {#if ship}· <strong>{ship}</strong> already shipped on the same theme{/if}
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
              <!-- The board trims settled rows, so an absent member usually
                   means "shipped a while ago", not "deleted". Saying `gone`
                   would be a claim the page cannot support. -->
              <span class="m-stage">not shown</span>
              <span class="m-title mono">{slug}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if e.mergedInto}
      <p class="card-body">Merged into <strong>{e.mergedInto}</strong> · original briefs retained</p>
    {:else if actionable || e.status === 'accepted'}
      <div class="card-actions bar">
        <button type="button" class="cta" disabled={busy != null}
          onclick={() => act({ action: 'epic_merge', slug: e.slug }, `epic:${e.slug}`)}>Auto-merge into epic</button>
        <button type="button" class="cta" disabled={busy === `epic:${e.slug}`}
          onclick={() => act({ action: 'epic_decide', slug: e.slug, decision: 'accept' }, `epic:${e.slug}`)}>
          Group these
        </button>
        <button type="button" class="btn danger" disabled={busy === `epic:${e.slug}`}
          onclick={() => act({ action: 'epic_decide', slug: e.slug, decision: 'decline' }, `epic:${e.slug}`)}>
          Not one thing
        </button>
      </div>
    {/if}
    {#if e.status === 'accepted' && !e.mergedInto}
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
