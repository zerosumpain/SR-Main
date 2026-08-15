<script lang="ts">
  // The evidence behind a claim, quoted.
  //
  // This is the component that makes an assertion falsifiable: for every source
  // note it shows the sentence the claim was actually extracted from, so you
  // can disagree with the graph without leaving the card. Without it a card is
  // just the extractor's word for it.

  import { splitOnTerm } from '$lib/jkai/intel/trust';

  let {
    evidence,
    term = '',
    limit = 6,
    heading = 'Evidence',
    total,
  }: {
    evidence: Array<{
      title: string;
      source: string;
      createdAt: string | Date;
      /**
       * When the thing described was actually observed. Preferred over
       * `createdAt`, which is the ingest clock — every email note carries the
       * night its sweep ran, so dating this list by it showed a dozen threads
       * spanning three months as all having happened on the same Tuesday.
       */
      observedAt?: string | Date | null;
      excerpt: string | null;
      href: string;
      relevance?: string | null;
    }>;
    /** Entity name, highlighted inside each excerpt. */
    term?: string;
    limit?: number;
    heading?: string;
    /** Distinct source notes, when more exist than were fetched. */
    total?: number;
  } = $props();

  let expanded = $state(false);

  const shown = $derived(expanded ? evidence : evidence.slice(0, limit));
  const collapsed = $derived(Math.max(0, evidence.length - shown.length));
  /** Sources the caller counted but did not fetch — the list is capped upstream. */
  const beyond = $derived(Math.max(0, (total ?? 0) - evidence.length));
  const quoted = $derived(evidence.filter((e) => e.excerpt).length);

  function when(value: string | Date): string {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
</script>

<section class="evidence">
  <header>
    <h4>{heading}</h4>
    <span class="count" title="{quoted} of {evidence.length} shown sources quote their sentence">
      {quoted}/{evidence.length} quoted
    </span>
  </header>

  <ul>
    {#each shown as item}
      <li>
        <a class="head" href={item.href}>
          <span class="title">{item.title}</span>
          <span class="src" title="Source: {item.source}">{item.source}</span>
          <time
            title={item.observedAt
              ? 'When this was observed'
              : 'When this was ingested — no observation date recorded'}
            class:ingested={!item.observedAt}>{when(item.observedAt ?? item.createdAt)}</time
          >
        </a>
        {#if item.excerpt}
          <blockquote>
            {#each splitOnTerm(item.excerpt, term) as seg}{#if seg.hit}<mark>{seg.text}</mark
                >{:else}{seg.text}{/if}{/each}
          </blockquote>
        {:else}
          <!-- Excerpts only started being captured recently; older links have
               none. Saying so is honest — an empty quote would not be. -->
          <span class="no-quote">no excerpt captured</span>
        {/if}
      </li>
    {/each}
  </ul>

  <footer>
    {#if collapsed > 0}
      <button type="button" onclick={() => (expanded = true)}>Show {collapsed} more</button>
    {:else if expanded && evidence.length > limit}
      <button type="button" onclick={() => (expanded = false)}>Show fewer</button>
    {/if}
    {#if beyond > 0}
      <span class="beyond">+{beyond} older source{beyond === 1 ? '' : 's'} not loaded</span>
    {/if}
  </footer>
</section>

<style>
  .evidence {
    margin-bottom: 10px;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  h4 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    font-weight: 500;
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
  }

  li {
    border-left: 2px solid var(--divider);
    padding-left: 8px;
  }
  li:hover {
    border-left-color: var(--accent-tint-35);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    text-decoration: none;
    color: var(--accent-ink);
    font-size: var(--fs-label);
  }
  .head:hover .title {
    text-decoration: underline;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .src,
  time {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
    flex-shrink: 0;
  }
  /* An ingest date is a weaker claim than an observation date, and the list is
     sorted on the stronger one — so the rows that could not supply it say so
     rather than looking like they were dated the same way. */
  time.ingested {
    font-style: italic;
    opacity: 0.75;
  }
  .src {
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  blockquote {
    margin: 3px 0 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-secondary);
  }
  blockquote::before {
    content: '“';
    color: var(--text-ghost);
  }
  blockquote::after {
    content: '”';
    color: var(--text-ghost);
  }

  mark {
    background: var(--accent-tint-14);
    color: var(--accent);
    padding: 0 1px;
    border-radius: var(--radius-sharp);
  }

  .no-quote {
    display: block;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    font-style: normal;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .beyond {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  button {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 3px 8px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--t-fast) var(--ease-out);
  }
  button:hover {
    background: var(--accent-tint-08);
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
</style>
