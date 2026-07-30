<script lang="ts">
  import { onMount } from 'svelte';
  import { listDrafts, saveDraft, deleteDraft, type DraftInput } from '$lib/jkai/pwa/drafts';
  import { enqueueMessage } from '$lib/jkai/pwa/outbox';
  import type { DraftRecord } from '$lib/jkai/pwa/db';

  let drafts = $state<DraftRecord[]>([]);
  let expanded = $state(false);
  let composer = $state('');
  let editingId = $state<string | null>(null);

  async function refresh() {
    drafts = await listDrafts();
  }

  onMount(() => {
    void refresh();
  });

  async function save() {
    if (!composer.trim()) return;
    const input: DraftInput = { id: editingId ?? undefined, body: composer.trim() };
    await saveDraft(input);
    composer = '';
    editingId = null;
    await refresh();
  }

  function resume(d: DraftRecord) {
    composer = d.body;
    editingId = d.id;
  }

  async function send(d: DraftRecord) {
    if (!d.sourceConversationId) {
      alert('Open this draft in a conversation to send.');
      return;
    }
    await enqueueMessage(d.sourceConversationId, d.body);
    await deleteDraft(d.id);
    await refresh();
  }

  async function discard(id: string) {
    await deleteDraft(id);
    if (editingId === id) {
      editingId = null;
      composer = '';
    }
    await refresh();
  }
</script>

<section class="drafts-panel">
  <header>
    <button class="title" type="button" onclick={() => (expanded = !expanded)}>
      Drafts ({drafts.length}) {expanded ? '▾' : '▸'}
    </button>
  </header>

  {#if expanded}
    <textarea
      class="nm-text-input"
      bind:value={composer}
      placeholder="Quick note or draft prompt…"
      rows="3"
    ></textarea>
    <div class="row">
      <button class="nm-save-btn" type="button" onclick={save} disabled={!composer.trim()}>
        {editingId ? 'Update' : 'Save'}
      </button>
      {#if editingId}
        <button
          type="button"
          onclick={() => {
            editingId = null;
            composer = '';
          }}
        >
          Cancel
        </button>
      {/if}
    </div>
    <ul>
      {#each drafts as d (d.id)}
        <li class="row-link">
          <button class="resume" type="button" onclick={() => resume(d)}>
            {d.body.split('\n')[0].slice(0, 80) || '(empty)'}
          </button>
          <div class="actions">
            <button type="button" onclick={() => send(d)}>Send</button>
            <button type="button" onclick={() => discard(d.id)}>Discard</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .drafts-panel {
    padding: 8px 12px;
    border-top: 1px solid var(--divider);
  }
  /* Wears the thread rail's mono label uniform — it sits directly above the
     Channels block and the two must read as one footer, not two widgets. */
  .title {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
    transition: color 0.2s ease-out;
  }
  .title:hover {
    color: var(--accent);
  }
  .row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: center;
    padding: 0.25rem 0;
  }
  .resume {
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    flex: 1;
    font: inherit;
  }
  .actions button {
    font: 0.75rem 'JetBrains Mono', monospace;
  }
</style>
