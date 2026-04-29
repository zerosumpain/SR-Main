<script lang="ts">
  import { onMount } from 'svelte';
  import {
    EditorView,
    keymap,
    placeholder as cmPlaceholder,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
  } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { markdown } from '@codemirror/lang-markdown';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import {
    syntaxHighlighting,
    defaultHighlightStyle,
    foldGutter,
    indentOnInput,
  } from '@codemirror/language';
  import { renderContent } from '$lib/blog/renderer';
  import { readability, plainTextFromHtml, type ReadabilityScores } from '$lib/blog/readability';

  let {
    content = '',
    onSave,
    onAutoSave,
    uploadImage,
  }: {
    content?: string;
    onSave?: (content: string) => Promise<void>;
    onAutoSave?: (content: string) => Promise<void>;
    uploadImage?: (file: File) => Promise<string>;
  } = $props();

  let editorContainer: HTMLDivElement | undefined = $state();
  let mode: 'edit' | 'preview' = $state('edit');
  let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = $state('idle');
  let scores = $state<ReadabilityScores>({
    words: 0,
    sentences: 0,
    syllables: 0,
    fleschReadingEase: 0,
    fleschKincaidGrade: 0,
    audience: '—',
  });
  let currentContent = $state(content);

  let view: EditorView | null = null;
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  function estimateReadTime(words: number): string {
    const minutes = Math.max(1, Math.ceil(words / 200));
    return `${minutes} min read`;
  }

  function updateWordCount(text: string) {
    // Strip markdown syntax for a fair readability measure: render to HTML
    // then drop tags, the same way the published page sees it.
    const plain = plainTextFromHtml(renderContent(text, 'markdown'));
    scores = readability(plain);
  }

  function getContent(): string {
    return view ? view.state.doc.toString() : currentContent;
  }

  function wrapSelection(before: string, after: string) {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
    });
    view.focus();
  }

  function insertAtCursor(text: string) {
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({
      changes: { from, insert: text },
    });
    view.focus();
  }

  // Toolbar actions
  function bold() {
    wrapSelection('**', '**');
  }

  function italic() {
    wrapSelection('*', '*');
  }

  function heading() {
    if (!view) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const lineText = view.state.sliceDoc(line.from, line.to);
    const match = lineText.match(/^(#{1,6})\s/);
    if (match) {
      const level = match[1].length;
      if (level < 6) {
        view.dispatch({
          changes: {
            from: line.from,
            to: line.from + level + 1,
            insert: '#'.repeat(level + 1) + ' ',
          },
        });
      }
    } else {
      view.dispatch({
        changes: { from: line.from, insert: '## ' },
      });
    }
    view.focus();
  }

  function link() {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    if (selected) {
      view.dispatch({
        changes: { from, to, insert: `[${selected}](url)` },
      });
    } else {
      view.dispatch({
        changes: { from, insert: '[link text](url)' },
      });
    }
    view.focus();
  }

  function codeBlock() {
    wrapSelection('\n```\n', '\n```\n');
  }

  async function image() {
    if (!uploadImage) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !view) return;
      try {
        const url = await uploadImage(file);
        insertAtCursor(`\n![](${url})\n`);
      } catch (e) {
        saveStatus = 'error';
        // eslint-disable-next-line no-console
        console.error('image upload failed:', e);
      }
    };
    input.click();
  }

  function quote() {
    if (!view) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const lineText = view.state.sliceDoc(line.from, line.to);
    if (lineText.startsWith('> ')) {
      view.dispatch({
        changes: { from: line.from, to: line.from + 2, insert: '' },
      });
    } else {
      view.dispatch({
        changes: { from: line.from, insert: '> ' },
      });
    }
    view.focus();
  }

  function bulletList() {
    insertAtCursor('\n- ');
  }

  function orderedList() {
    insertAtCursor('\n1. ');
  }

  // Auto-save
  function triggerAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      if (!onAutoSave) return;
      saveStatus = 'saving';
      try {
        await onAutoSave(getContent());
        saveStatus = 'saved';
        setTimeout(() => {
          if (saveStatus === 'saved') saveStatus = 'idle';
        }, 2000);
      } catch {
        saveStatus = 'error';
      }
    }, 3000);
  }

  // Manual save
  async function manualSave() {
    if (!onSave) return;
    saveStatus = 'saving';
    try {
      await onSave(getContent());
      saveStatus = 'saved';
      setTimeout(() => {
        if (saveStatus === 'saved') saveStatus = 'idle';
      }, 2000);
    } catch {
      saveStatus = 'error';
    }
  }

  // Keyboard shortcuts
  function handleKeydown(e: KeyboardEvent) {
    if (!view) return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key === 'b') {
      e.preventDefault();
      bold();
    } else if (mod && e.key === 'i' && !e.shiftKey) {
      e.preventDefault();
      italic();
    } else if (mod && e.key === 'k') {
      e.preventDefault();
      link();
    } else if (mod && e.key === 's') {
      e.preventDefault();
      manualSave();
    } else if (mod && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      heading();
    } else if (mod && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      codeBlock();
    } else if (mod && e.shiftKey && e.key === 'I') {
      e.preventDefault();
      image();
    } else if (mod && e.shiftKey && e.key === 'Q') {
      e.preventDefault();
      quote();
    }
  }

  // Paste image handler
  function handlePaste(e: ClipboardEvent) {
    if (!uploadImage || !view) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const pos = view.state.selection.main.from;
        view.dispatch({
          changes: { from: pos, insert: '![Uploading...]()' },
        });

        uploadImage(file)
          .then((url) => {
            if (!view) return;
            const newPos = view.state.selection.main.from;
            view.dispatch({
              changes: { from: newPos - '![]()'.length, to: newPos, insert: `![](${url})` },
            });
          })
          .catch(() => {
            if (!view) return;
            // Remove the placeholder
            const newPos = view.state.selection.main.from;
            view.dispatch({
              changes: {
                from: newPos - '![](Uploading...)'.length,
                to: newPos,
                insert: '',
              },
            });
          });
        break;
      }
    }
  }

  let renderedPreview = $derived(renderContent(currentContent, 'markdown'));

  onMount(() => {
    if (!editorContainer) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        currentContent = update.state.doc.toString();
        updateWordCount(currentContent);
        triggerAutoSave();
      }
    });

    const customTheme = EditorView.theme({
      '&': {
        fontSize: '14px',
        height: '100%',
      },
      '.cm-content': {
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
        caretColor: 'var(--accent)',
        lineHeight: '1.7',
        padding: '12px 0',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--accent)',
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'rgba(196, 87, 10, 0.2)',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--text-ghost)',
        border: 'none',
        paddingRight: '8px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--text-secondary)',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'rgba(196, 87, 10, 0.25)',
        outline: 'none',
      },
      '.cm-foldGutter': {
        color: 'var(--text-ghost)',
      },
      '.cm-placeholder': {
        color: 'var(--text-ghost)',
        fontStyle: 'italic',
      },
    });

    view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          foldGutter(),
          indentOnInput(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          updateListener,
          cmPlaceholder('Write your markdown here...'),
          customTheme,
          EditorView.lineWrapping,
        ],
      }),
      parent: editorContainer,
    });

    updateWordCount(content);

    return () => {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      view?.destroy();
      view = null;
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="editor-wrapper">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <button class="tool-btn" onclick={bold} title="Bold (Ctrl+B)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
      </button>
      <button class="tool-btn" onclick={italic} title="Italic (Ctrl+I)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
      </button>
      <button class="tool-btn" onclick={heading} title="Heading (Ctrl+Shift+H)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12l3-2v8"/></svg>
      </button>
      <span class="tool-divider"></span>
      <button class="tool-btn" onclick={link} title="Link (Ctrl+K)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </button>
      <button class="tool-btn" onclick={codeBlock} title="Code (Ctrl+Shift+C)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      </button>
      <button class="tool-btn" onclick={image} title="Image (Ctrl+Shift+I)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>
      <button class="tool-btn" onclick={quote} title="Quote (Ctrl+Shift+Q)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>
      </button>
      <button class="tool-btn" onclick={bulletList} title="Bullet list">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
      </button>
      <button class="tool-btn" onclick={orderedList} title="Ordered list">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" font-size="7" fill="currentColor" stroke="none" font-family="var(--font-mono)">1</text><text x="2" y="14" font-size="7" fill="currentColor" stroke="none" font-family="var(--font-mono)">2</text><text x="2" y="20" font-size="7" fill="currentColor" stroke="none" font-family="var(--font-mono)">3</text></svg>
      </button>
    </div>

    <div class="toolbar-right">
      <button
        class="mode-btn"
        class:active={mode === 'edit'}
        onclick={() => (mode = 'edit')}
      >
        Edit
      </button>
      <button
        class="mode-btn"
        class:active={mode === 'preview'}
        onclick={() => (mode = 'preview')}
      >
        Preview
      </button>
    </div>
  </div>

  <!-- Editor / Preview area -->
  <div class="editor-body" onpaste={handlePaste}>
    <div
      bind:this={editorContainer}
      class="codemirror-host"
      style:display={mode === 'edit' ? '' : 'none'}
    ></div>
    {#if mode === 'preview'}
      <div class="preview-pane">
        {@html renderedPreview}
      </div>
    {/if}
  </div>

  {#if scores.words > 0}
    <div class="readability">
      <span class="r-pill">Reading ease <strong>{scores.fleschReadingEase}</strong></span>
      <span class="r-pill">Grade <strong>{scores.fleschKincaidGrade}</strong></span>
      <span class="r-audience">{scores.audience}</span>
      <span class="r-meta">{scores.sentences} sentences · {(scores.words / Math.max(1, scores.sentences)).toFixed(1)} words/sentence</span>
    </div>
  {/if}

  <!-- Status bar -->
  <div class="status-bar">
    <div class="status-left">
      <span class="status-item">Markdown</span>
      {#if saveStatus !== 'idle'}
        <span class="status-item status-{saveStatus}">
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Error saving'}
        </span>
      {/if}
    </div>
    <div class="status-right">
      <span class="status-item" title="Flesch Reading Ease">FRE {scores.fleschReadingEase}</span>
      <span class="status-item" title="Flesch–Kincaid Grade Level">FKGL {scores.fleschKincaidGrade}</span>
      <span class="status-item">{scores.words} words</span>
      <span class="status-item">{estimateReadTime(scores.words)}</span>
    </div>
  </div>
</div>

<style>
  .editor-wrapper {
    border: 1px solid var(--card-border);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--card-bg);
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid var(--card-border);
    background: var(--card-bg);
    gap: 4px;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    padding: 0;
  }

  .tool-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-primary);
  }

  .tool-btn:active {
    background: rgba(255, 255, 255, 0.1);
  }

  .tool-divider {
    display: inline-block;
    width: 1px;
    height: 16px;
    background: var(--card-border);
    margin: 0 4px;
    vertical-align: middle;
  }

  .mode-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    padding: 3px 8px;
    border: 1px solid var(--card-border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-ghost);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .mode-btn:hover {
    color: var(--text-secondary);
  }

  .mode-btn.active {
    background: rgba(196, 87, 10, 0.12);
    color: var(--accent);
    border-color: var(--accent);
  }

  /* Editor body */
  .editor-body {
    flex: 1;
    min-height: 400px;
    position: relative;
  }

  .codemirror-host {
    height: 100%;
    min-height: 400px;
  }

  .codemirror-host :global(.cm-editor) {
    height: 100%;
    outline: none;
  }

  .codemirror-host :global(.cm-scroller) {
    font-family: var(--font-mono);
    overflow-x: auto;
    padding: 0 12px;
  }

  /* Preview pane */
  .preview-pane {
    padding: 20px 24px;
    min-height: 400px;
    overflow-y: auto;
  }

  .preview-pane :global(h1),
  .preview-pane :global(h2),
  .preview-pane :global(h3) {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }

  .preview-pane :global(h2) {
    font-size: 1.5rem;
  }

  .preview-pane :global(h3) {
    font-size: 1.25rem;
  }

  .preview-pane :global(p) {
    margin-bottom: 1.25em;
    line-height: 1.8;
    font-size: 1rem;
    color: var(--text-secondary);
  }

  .preview-pane :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .preview-pane :global(code) {
    font-family: var(--font-mono);
    font-size: 0.875em;
    padding: 0.2em 0.5em;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
  }

  .preview-pane :global(pre) {
    padding: 1.25em 1.5em;
    overflow-x: auto;
    margin: 1.5em 0;
    font-size: 0.875rem;
    background: var(--card-bg);
    border: 2px solid var(--card-border);
  }

  .preview-pane :global(pre code) {
    padding: 0;
    background: none;
    border: none;
  }

  .preview-pane :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 1.25em;
    margin: 1.5em 0;
    font-style: italic;
    color: var(--text-muted);
  }

  .preview-pane :global(ul),
  .preview-pane :global(ol) {
    padding-left: 1.5em;
    margin-bottom: 1.25em;
  }

  .preview-pane :global(li) {
    margin-bottom: 0.5em;
    line-height: 1.8;
    color: var(--text-secondary);
  }

  .preview-pane :global(img) {
    max-width: 100%;
    margin: 1.5em 0;
  }

  /* Status bar */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    border-top: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    background: var(--card-bg);
  }

  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-item {
    display: inline-flex;
    align-items: center;
  }

  .status-saving {
    color: var(--accent);
  }

  .status-saved {
    color: #4a9;
  }

  .status-error {
    color: #c44;
  }

  .readability {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    padding: 8px 12px; border-top: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    color: var(--text-secondary); background: rgba(255,255,255,0.02);
  }
  .r-pill {
    padding: 2px 8px; border: 1px solid var(--card-border); border-radius: 999px;
    text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px;
  }
  .r-pill strong { color: var(--accent); margin-left: 4px; font-weight: 700; }
  .r-audience { color: var(--text-primary); font-style: italic; }
  .r-meta { color: var(--text-ghost); margin-left: auto; font-size: 10px; }
</style>
