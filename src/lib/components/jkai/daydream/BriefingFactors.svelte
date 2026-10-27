<script lang="ts">
  // The briefing's 19 factors and the connections drawn between them, as the
  // SR-Workflows composer wrote them into the day's record (from 2026-10-27).
  // Connections first — they are the reading across cards — then one card per
  // factor, grouped Place → Systems. Each card's facts sit in a `<details>`
  // that opens for print, so a printed day carries its evidence.
  //
  // Renders nothing for a record that predates factors: the caller hides its
  // band with `hasFactors`.
  import { onMount } from 'svelte';
  import {
    FACTOR_GROUPS,
    type BriefingConnection,
    type FactorCard,
    type FactorStatus,
  } from '$lib/briefing/types';

  interface Props {
    factors?: FactorCard[] | null;
    connections?: BriefingConnection[] | null;
  }

  let { factors = [], connections = [] }: Props = $props();

  const cards = $derived([...(factors ?? [])].sort((a, b) => a.n - b.n));
  const groups = $derived(
    [...FACTOR_GROUPS, ...new Set(cards.map((c) => c.group).filter((g) => !(FACTOR_GROUPS as readonly string[]).includes(g)))]
      .map((group) => ({ group, cards: cards.filter((c) => c.group === group) }))
      .filter((g) => g.cards.length),
  );
  const links = $derived(connections ?? []);
  const labelOf = $derived(new Map(cards.map((c) => [c.key as string, c.label])));

  const STATUS: Record<FactorStatus, { label: string; tone: string }> = {
    ok: { label: 'reported', tone: 't-good' },
    stale: { label: 'stale', tone: 't-watch' },
    empty: { label: 'nothing new', tone: 't-quiet' },
    failed: { label: 'failed', tone: 't-urgent' },
    off: { label: 'off', tone: 't-quiet' },
  };
  const statusOf = (s: string) => STATUS[s as FactorStatus] ?? { label: s, tone: 't-quiet' };
  const CARD_TONE: Record<string, string> = { ok: 't-steady', stale: 't-watch', failed: 't-urgent', empty: 't-quiet', off: 't-quiet' };

  const external = (href: string) => /^https?:\/\//i.test(href);
  const pad = (n: number) => String(n).padStart(2, '0');

  let root: HTMLElement | undefined = $state();

  // A closed `<details>` prints closed. Open them all for the printout and
  // put back the ones that were shut afterwards.
  onMount(() => {
    let reopened: HTMLDetailsElement[] = [];
    const before = () => {
      reopened = [...(root?.querySelectorAll('details:not([open])') ?? [])] as HTMLDetailsElement[];
      for (const d of reopened) d.open = true;
    };
    const after = () => {
      for (const d of reopened) d.open = false;
      reopened = [];
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  });
</script>

<div class="factors" bind:this={root}>
  {#if links.length}
    <div class="connections">
      <p class="field-label">Connections</p>
      <ol class="stack tight conn-list">
        {#each links as link, i (i)}
          <li class="card" class:t-action={link.action} class:t-steady={!link.action}>
            <p class="card-body lead">{link.text}</p>
            {#if link.factors?.length || link.action}
              <p class="card-meta conn-tags">
                {#if link.action}<span class="tag t-action">act today</span>{/if}
                {#each link.factors ?? [] as key (key)}
                  <span class="tag">{labelOf.get(key) ?? key}</span>
                {/each}
              </p>
            {/if}
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  {#each groups as { group, cards: groupCards } (group)}
    <section class="group" aria-label={group}>
      <h3 class="group-head field-label">{group}</h3>
      <div class="factor-grid">
        {#each groupCards as card (card.key)}
          {@const status = statusOf(card.status)}
          {@const line = card.headline || card.detail}
          <article class="card factor {CARD_TONE[card.status] ?? 't-quiet'}" id="factor-{card.key}">
            <div class="factor-top">
              <p class="card-kicker">{pad(card.n)}</p>
              <span class="pill {status.tone}">{status.label}</span>
            </div>
            <h4 class="card-title as-text factor-label">{card.label}</h4>
            {#if line}
              <p class="card-body" class:lead={!!card.headline}>{line}</p>
            {/if}
            {#if card.facts?.length}
              <details class="facts">
                <summary>{card.facts.length} fact{card.facts.length === 1 ? '' : 's'}</summary>
                <dl>
                  {#each card.facts as fact, j (j)}
                    <div class="fact" class:act={fact.action}>
                      <dt>{fact.label}</dt>
                      <dd>
                        {#if fact.href}
                          <a
                            class="link"
                            href={fact.href}
                            target={external(fact.href) ? '_blank' : undefined}
                            rel={external(fact.href) ? 'noopener noreferrer' : undefined}>{fact.value}</a
                          >
                        {:else}
                          {fact.value}
                        {/if}
                        {#if fact.assessment}<span class="assess">{fact.assessment}</span>{/if}
                      </dd>
                    </div>
                  {/each}
                </dl>
              </details>
            {/if}
          </article>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .factors {
    display: flex;
    flex-direction: column;
    gap: clamp(20px, 3vw, 32px);
    min-width: 0;
  }
  .conn-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-width: 78ch;
  }
  .conn-tags {
    margin-top: 10px;
  }
  .group-head {
    margin: 0 0 10px;
  }
  .factor-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
    gap: 10px;
  }
  .factor {
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
  }
  .factor-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .factor-top .card-kicker {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .factor-label {
    margin-bottom: 8px;
    overflow-wrap: anywhere;
  }
  .facts {
    margin-top: auto;
    padding-top: 12px;
  }
  .facts summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .facts summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .facts dl {
    margin: 10px 0 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fact {
    border-top: 1px solid var(--card-border);
    padding-top: 8px;
  }
  .fact.act {
    border-top-color: var(--accent);
  }
  .fact dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .fact dd {
    margin: 2px 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .assess {
    display: block;
    color: var(--text-secondary);
    font-size: var(--fs-label);
  }
  @media print {
    .factor-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .factor {
      break-inside: avoid;
    }
  }
</style>
