<script lang="ts">
  // C — KNOWLEDGE. The RAG collections built out of files on the shelf.
  //
  // Health's ranked-moves row shape: a numeral, a column saying what the thing
  // IS, then the columns that decide. The hairline between rows is the
  // container's own ground showing through a 1px gap — safe here because this
  // is a fixed single column, not an `auto-fit` grid whose unfilled tracks
  // would paint as blocks.
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import type { RagCollection } from '$lib/db/schema';

  interface Props {
    collections: RagCollection[];
    loaded: boolean;
    selectedCount: number;
    onOpenChat: (c: RagCollection) => void;
    onReindex: (c: RagCollection) => void;
    onDelete: (c: RagCollection) => void;
    onInteract: () => void;
  }

  let { collections, loaded, selectedCount, onOpenChat, onReindex, onDelete, onInteract }: Props =
    $props();

  function statusLabel(c: RagCollection): string {
    if (c.status === 'ready') return `${c.chunkCount} chunks`;
    if (c.status === 'indexing' || c.status === 'pending') return 'indexing';
    if (c.status === 'error') return 'failed';
    return c.status;
  }

  const strap = $derived(
    collections.length === 0
      ? 'Pick documents on the shelf above, then build a base from them. Answers come back cited to the file and the passage they came from.'
      : 'Each base is an index over a fixed set of files. Answers cite the passage they came from, so a claim can be checked against the source rather than taken on trust.',
  );
</script>

<section class="c">
  <div class="c-inner">
    <SectionHead
      kicker="C / Knowledge · {collections.length} base{collections.length === 1 ? '' : 's'}"
      title={['Ask the files,', 'not the folder']}
      {strap}
    >
      {#snippet aside()}
        <button type="button" class="nm-btn-ghost" disabled={selectedCount === 0} onclick={onInteract}>
          {selectedCount === 0 ? 'Select files to build one' : `Build from ${selectedCount} selected`}
        </button>
      {/snippet}
    </SectionHead>

    {#if collections.length > 0}
      <div class="c-rows">
        {#each collections as c, i (c.id)}
          <div class="c-row">
            <p class="c-rank">{String(i + 1).padStart(2, '0')}</p>

            <div class="c-cell">
              <h3 class="c-title">{c.name}</h3>
              <p class="c-files">
                {(c.fileNames ?? []).length} file{(c.fileNames ?? []).length === 1 ? '' : 's'}{(c.fileNames ?? []).length
                  ? ` · ${(c.fileNames ?? []).slice(0, 3).join(', ')}${(c.fileNames ?? []).length > 3 ? '…' : ''}`
                  : ''}
              </p>
            </div>

            <div class="c-cell">
              <p class="sr-label-tight">Index</p>
              <p class="c-value c-{c.status}">{statusLabel(c)}</p>
            </div>

            <div class="c-cell">
              <p class="sr-label-tight">Embeddings</p>
              <p class="c-value muted">{c.embeddingModel ? c.embeddingModel.replace('openai/', '') : '—'}</p>
            </div>

            <div class="c-acts">
              <button type="button" class="nm-save-btn" onclick={() => onOpenChat(c)}>Open chat</button>
              <button
                type="button"
                class="nm-act c-muted"
                disabled={c.status === 'indexing' || c.status === 'pending'}
                onclick={() => onReindex(c)}
              >Reindex</button>
              <button type="button" class="nm-act danger" onclick={() => onDelete(c)}>Delete</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="c-empty">
        {loaded
          ? 'No knowledge bases yet. Select one or more documents on the shelf and build your first.'
          : 'Loading…'}
      </p>
    {/if}
  </div>
</section>

<style>
  .c {
    padding: clamp(38px, 4.4vw, 66px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-top: 2px solid rgba(26, 16, 8, 0.12);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  .c-inner { max-width: 1400px; margin: 0 auto; }

  /* One hairline between rows, drawn as the container's own ground through a
     1px gap. Safe here — a fixed single column, not an `auto-fit` grid whose
     unfilled tracks would paint as blocks. */
  .c-rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
  }
  .c-row {
    background: var(--bg);
    display: grid;
    grid-template-columns: 52px minmax(0, 1.6fr) minmax(0, 0.8fr) minmax(0, 0.8fr) auto;
    gap: clamp(12px, 1.6vw, 26px);
    padding: 20px 22px;
    align-items: start;
  }
  .c-rank {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 0.8;
    letter-spacing: -0.03em;
    color: var(--accent);
    margin: 0;
  }
  .c-cell { min-width: 0; }
  .c-title {
    font-family: var(--font-display);
    font-size: 19px;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 0 0 8px;
    overflow-wrap: anywhere;
  }
  .c-files, .c-value {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .c-files { color: var(--text-ghost); }
  .c-value { font-size: var(--fs-label); color: var(--text-primary); margin-top: 7px; }
  .c-value.muted { color: var(--text-muted); }
  .c-ready { color: var(--success); }
  .c-indexing,
  .c-pending { color: var(--warn); }
  .c-error { color: var(--error); }
  .c-acts {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 9px;
  }
  .c-muted { color: var(--text-muted); }
  .c-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    border: 1px dashed var(--line-strong);
    padding: 34px 20px;
    text-align: center;
    margin: 0;
  }

  @media (max-width: 1000px) {
    .c-row { grid-template-columns: 52px minmax(0, 1fr); row-gap: 16px; }
    .c-rank { grid-row: span 4; }
    .c-acts { flex-direction: row; align-items: center; flex-wrap: wrap; }
  }
  @media (max-width: 560px) {
    .c-row { grid-template-columns: minmax(0, 1fr); }
    .c-rank { grid-row: auto; }
  }
</style>
