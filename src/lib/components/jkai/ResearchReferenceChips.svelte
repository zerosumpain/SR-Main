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
  <div class="refs">
    <span class="refs-label">research</span>
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
  </div>
{/if}

<style>
  .refs {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 6px 0 2px;
    flex-wrap: wrap;
  }
  .refs-label {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    padding-top: 6px;
  }
  .refs-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }
  .ref-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    padding: 4px 9px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font-body);
    font-size: 12px;
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
    font-size: 11px;
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
    font-size: 9px;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
</style>
