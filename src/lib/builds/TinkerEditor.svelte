<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
  } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import {
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
    foldGutter,
    indentOnInput,
  } from '@codemirror/language';

  let {
    buildId,
    path,
    status,
    content,
    onSaved,
  }: {
    buildId: string;
    path: string;
    status: string;
    content: string;
    onSaved: () => void | Promise<void>;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;
  let saving = $state(false);
  let dirty = $state(false);
  let lastError = $state<string | null>(null);

  const editable = $derived(status !== 'running');

  function init(initialDoc: string, canEdit: boolean) {
    if (!host) return;
    view?.destroy();
    view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          bracketMatching(),
          foldGutter(),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) dirty = true;
          }),
          EditorView.editable.of(canEdit),
          EditorState.readOnly.of(!canEdit),
        ],
      }),
      parent: host,
    });
    dirty = false;
  }

  $effect(() => {
    init(content, editable);
    return () => {
      view?.destroy();
      view = null;
    };
  });

  onDestroy(() => view?.destroy());

  async function save() {
    if (!view) return;
    saving = true;
    lastError = null;
    try {
      const body = view.state.doc.toString();
      const r = await fetch(`/api/jkai/builds/${buildId}/files/${encodeURI(path)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: body }),
      });
      if (!r.ok) {
        lastError = `${r.status}: ${(await r.text()).slice(0, 200) || r.statusText}`;
        return;
      }
      dirty = false;
      await onSaved();
    } finally {
      saving = false;
    }
  }
</script>

<div class="editor">
  <header>
    <span class="path">{path}</span>
    {#if !editable}
      <span class="dim">Build running — pause to edit</span>
    {:else if dirty}
      <button class="nm-save-btn" disabled={saving} onclick={save} type="button">
        {saving ? 'Saving…' : 'Save'}
      </button>
    {:else}
      <span class="dim">Saved</span>
    {/if}
  </header>
  <div bind:this={host} class="cm-host"></div>
  {#if lastError}<p class="err">{lastError}</p>{/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 320px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
  }
  .path {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    flex: 1;
    word-break: break-all;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .cm-host {
    border: 1px solid var(--card-border);
    background: var(--bg);
    min-height: 320px;
    max-height: 60vh;
    overflow: auto;
  }
  .cm-host :global(.cm-editor) {
    font-family: var(--font-mono);
    font-size: 12px;
    height: 100%;
  }
  .cm-host :global(.cm-scroller) {
    font-family: var(--font-mono);
  }
  .err {
    color: var(--status-error);
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 4px 0 0;
  }
</style>
