<script lang="ts">
  // A row of clickable source chips for @files (file_search) references. Clicking a
  // chip opens the file in the viewer, jumped to the cited passage. Data comes from
  // the file_search tool result on the assistant's tool steps (see ChatArea).
  export type FileRef = {
    fileId: string;
    source: string;
    modality: string;
    score: number;
    chunkOrd?: number;
    charStart?: number;
    charEnd?: number;
    passage: string;
  };

  let { refs, onOpen }: { refs: FileRef[]; onOpen: (ref: FileRef) => void } = $props();

  // Show just the file's basename on the chip; the folder path is noise here.
  function basename(name: string): string {
    const parts = name.split('/').filter(Boolean);
    return parts[parts.length - 1] || name;
  }
  function modalityIcon(m: string): string {
    if (m === 'image') return '🖼';
    if (m === 'audio') return '🔊';
    return '📄';
  }
</script>

{#if refs.length > 0}
  <div class="refs">
    <span class="refs-label">sources</span>
    <div class="refs-row">
      {#each refs as ref, i (ref.fileId + ':' + (ref.chunkOrd ?? i))}
        <button
          type="button"
          class="ref-chip"
          onclick={() => onOpen(ref)}
          title={`${ref.source} — open at the cited passage`}
        >
          <span class="ref-icon" aria-hidden="true">{modalityIcon(ref.modality)}</span>
          <span class="ref-name">{basename(ref.source)}</span>
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
