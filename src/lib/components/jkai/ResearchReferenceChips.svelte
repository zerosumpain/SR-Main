<script lang="ts">
  // A row of clickable source chips for @research (research_search) references.
  // Mirrors FileReferenceChips: the data comes from the research_search tool
  // result promoted onto the assistant turn (see ChatArea). Each chip cites a
  // fact/passage drawn from a deep-dive research session — clicking opens the
  // source's page material in an in-app rich reader modal (ResearchSourceModal),
  // which itself offers "open original ↗".
  export type ResearchRef = {
    factId: string;
    sourceId: string | null;
    sessionId: string;
    sessionTopic: string;
    sourceTitle: string | null;
    sourceUrl: string | null;
    domain: string | null;
    score: number;
    passage: string;
  };

  let { refs = [], onOpen }: { refs: ResearchRef[]; onOpen: (ref: ResearchRef) => void } = $props();

  // Label preference: source title → domain → session topic. Keeps chips
  // legible when a fact's source lacks a title.
  function label(ref: ResearchRef): string {
    return ref.sourceTitle?.trim() || ref.domain?.trim() || ref.sessionTopic?.trim() || 'source';
  }
</script>

{#if refs.length > 0}
  <details class="refs">
    <summary class="refs-sum">
      <span class="refs-chev" aria-hidden="true">▸</span>
      <span>research</span>
      <span class="refs-count">{refs.length}</span>
    </summary>
    <div class="refs-row">
      {#each refs as ref, i (ref.factId + ':' + i)}
        <button
          type="button"
          class="ref-chip"
          onclick={() => onOpen(ref)}
          title={`${ref.sessionTopic ? ref.sessionTopic + ' — ' : ''}${ref.passage}`}
        >
          <span class="ref-icon" aria-hidden="true">🔎</span>
          <span class="ref-name">{label(ref)}</span>
          <span class="ref-score">{Math.round(ref.score * 100)}%</span>
        </button>
      {/each}
    </div>
  </details>
{/if}

<style>

  /* Collapsed by default — see FileReferenceChips for the reasoning; the two
     footers must behave identically or the reply grows a second grammar. */
  .refs {
    margin: 6px 0 2px;
  }
  .refs-sum {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    transition: color 0.2s ease-out;
  }
  .refs-sum::-webkit-details-marker {
    display: none;
  }
  .refs-sum:hover {
    color: var(--accent);
  }
  .refs-count {
    color: var(--text-ghost);
  }
  .refs-chev {
    transition: transform 0.15s ease-out;
  }
  .refs[open] .refs-chev {
    transform: rotate(90deg);
  }
  .refs-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
    margin-top: 6px;
  }
  .ref-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    padding: 4px 9px;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.4;
    text-decoration: none;
  }
  .ref-chip:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, var(--bg));
  }
  .ref-icon {
    flex-shrink: 0;
    font-size: var(--fs-label);
  }
  .ref-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ref-score {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
</style>
