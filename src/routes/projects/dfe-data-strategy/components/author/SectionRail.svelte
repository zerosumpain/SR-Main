<script lang="ts">
  import { author } from '../../lib/author/authorState.svelte';
  import { SECTION_TEMPLATES } from '../../lib/author/templates';

  let adding = $state(false);
  let newTitle = $state('');

  const dot = (id: string): 'empty' | 'thin' | 'ok' => {
    const w = author.wordCounts[id] ?? 0;
    if (w === 0) return 'empty';
    if (w < 80) return 'thin';
    return 'ok';
  };

  function add() {
    if (!newTitle.trim()) return;
    author.addSection(newTitle);
    newTitle = '';
    adding = false;
  }
</script>

<nav class="rail" aria-label="Strategy sections">
  <span class="rail-lab">Sections · {author.totalWords.toLocaleString('en-GB')} words</span>
  {#each author.doc.sections as s, i (s.id)}
    <div class="row" class:on={author.activeId === s.id}>
      <button class="sec" onclick={() => (author.activeId = s.id)} title={s.title}>
        <i class="d {dot(s.id)}"></i>
        <span class="t">{s.title}</span>
        <span class="w">{author.wordCounts[s.id] || ''}</span>
      </button>
      {#if author.activeId === s.id}
        <span class="ops">
          <button class="op" onclick={() => author.moveSection(s.id, -1)} disabled={i === 0} title="Move up">↑</button>
          <button class="op" onclick={() => author.moveSection(s.id, 1)} disabled={i === author.doc.sections.length - 1} title="Move down">↓</button>
          <button
            class="op danger"
            onclick={() => {
              if (confirm(`Remove "${s.title}"${author.wordCounts[s.id] ? ' and its text' : ''}?`)) author.removeSection(s.id);
            }}
            disabled={author.doc.sections.length <= 1}
            title="Remove section">✕</button>
        </span>
      {/if}
    </div>
  {/each}

  {#if adding}
    <div class="addrow">
      <input
        class="addin"
        bind:value={newTitle}
        placeholder="Section title…"
        onkeydown={(e) => {
          if (e.key === 'Enter') add();
          if (e.key === 'Escape') (adding = false), (newTitle = '');
        }}
      />
      <button class="op" onclick={add}>✓</button>
    </div>
  {:else}
    <button class="add" onclick={() => (adding = true)}>+ Add section</button>
  {/if}

  {#if author.doc.sections.length < SECTION_TEMPLATES.length}
    <details class="restore">
      <summary>Restore a template section</summary>
      {#each SECTION_TEMPLATES.filter((t) => !author.doc.sections.some((s) => s.templateId === t.id)) as t}
        <button class="rst" onclick={() => author.addSection(t.title, t.id)}>{t.title}</button>
      {/each}
    </details>
  {/if}
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rail-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.45);
    margin: 0 0 6px 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sec {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 7px;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    padding: 6px 9px;
    cursor: pointer;
    min-width: 0;
  }
  .sec:hover {
    background: rgba(28, 22, 17, 0.05);
  }
  .row.on .sec {
    background: var(--ink);
  }
  .row.on .sec .t {
    color: var(--paper, #f1ead6);
  }
  .row.on .sec .w {
    color: rgba(241, 234, 214, 0.6);
  }
  .d {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(28, 22, 17, 0.35);
  }
  .d.empty {
    background: transparent;
  }
  .d.thin {
    background: #b07d2b;
    border-color: #b07d2b;
  }
  .d.ok {
    background: #2f6155;
    border-color: #2f6155;
  }
  .t {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 500;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .w {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.45);
  }
  .ops {
    display: inline-flex;
    gap: 2px;
  }
  .op {
    font-size: var(--fs-label-xs);
    padding: 3px 6px;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-sharp);
    cursor: pointer;
    color: var(--ink);
  }
  .op:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .op.danger {
    color: var(--error, #a33);
  }
  .add {
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 6px 9px;
    background: transparent;
    border: 1px dashed rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-sharp);
    color: rgba(28, 22, 17, 0.6);
    cursor: pointer;
    text-align: left;
  }
  .add:hover {
    color: var(--ink);
    border-color: rgba(28, 22, 17, 0.5);
  }
  .addrow {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }
  .addin {
    flex: 1;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    padding: 5px 8px;
    border: 1px solid rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.7);
    color: var(--ink);
    min-width: 0;
  }
  .restore {
    margin-top: 10px;
  }
  .restore summary {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.45);
    cursor: pointer;
  }
  .rst {
    display: block;
    width: 100%;
    text-align: left;
    font-size: var(--fs-label-xs);
    padding: 4px 8px;
    margin-top: 3px;
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid rgba(28, 22, 17, 0.15);
    border-radius: var(--radius-sharp);
    color: var(--ink);
    cursor: pointer;
  }
  .rst:hover {
    background: rgba(28, 22, 17, 0.05);
  }
</style>
