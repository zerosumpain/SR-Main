<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Image from '@tiptap/extension-image';
  import Link from '@tiptap/extension-link';
  import Placeholder from '@tiptap/extension-placeholder';
  import { readability, type ReadabilityScores } from '$lib/blog/readability';
  import { SuggestionDecorations, suggestionPluginKey } from '$lib/blog/assistant/suggestion-decorations';
  import type { ProseProposal } from '$lib/blog/assistant/proposal';

  interface RichEditorApi {
    getHTML: () => string;
    getText: () => string;
    /** Wrap the first occurrence of `snippet` in an inline link. Returns true if found. */
    linkSnippet: (snippet: string, url: string, title?: string) => boolean;
    /** Append a numbered footnote referencing `snippet`. Returns the footnote number. */
    addFootnote: (snippet: string, url: string, title?: string) => number;
    applyProposal: (p: ProseProposal) => boolean;
    acceptProposal: (id: string, modifiedText?: string) => boolean;
    rejectProposal: (id: string) => boolean;
    /** Strip ALL suggestion marks from the document, treating each one as a
     *  reject (delete insertions, unwrap deletions). Used by the Clear button. */
    clearAllSuggestions: () => void;
    /** Replace the entire document content. Used after rollback. */
    setContent: (html: string) => void;
  }

  let {
    content = '',
    onSave,
    onAutoSave,
    uploadImage,
    api = $bindable<RichEditorApi | undefined>(),
    onProposalAccepted,
    onProposalRejected,
  }: {
    content?: string;
    onSave?: (html: string) => Promise<void>;
    onAutoSave?: (html: string) => Promise<void>;
    uploadImage?: (file: File) => Promise<string>;
    api?: RichEditorApi;
    /** Third arg is the literal pre-mutation HTML — exact bytes the user
     *  saw before the accept. Use as the rollback target. */
    onProposalAccepted?: (id: string, finalText: string, htmlBeforeAccept: string) => void;
    onProposalRejected?: (id: string) => void;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = $state('idle');
  let scores = $state<ReadabilityScores>({
    words: 0,
    sentences: 0,
    syllables: 0,
    fleschReadingEase: 0,
    fleschKincaidGrade: 0,
    audience: '—',
  });
  let editor: Editor | null = null;
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let uploading = $state(0);

  function readTime(words: number): string {
    return `${Math.max(1, Math.ceil(words / 200))} min read`;
  }

  function recomputeScores() {
    const text = editor?.getText() ?? '';
    scores = readability(text);
  }

  function getHTML(): string {
    return editor?.getHTML() ?? content;
  }

  function scheduleAutoSave() {
    if (!onAutoSave) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      saveStatus = 'saving';
      try {
        await onAutoSave(getHTML());
        saveStatus = 'saved';
        setTimeout(() => {
          if (saveStatus === 'saved') saveStatus = 'idle';
        }, 1800);
      } catch {
        saveStatus = 'error';
      }
    }, 2500);
  }

  async function manualSave() {
    if (!onSave) return;
    saveStatus = 'saving';
    try {
      await onSave(getHTML());
      saveStatus = 'saved';
      setTimeout(() => {
        if (saveStatus === 'saved') saveStatus = 'idle';
      }, 1800);
    } catch {
      saveStatus = 'error';
    }
  }

  async function uploadAndInsert(file: File) {
    if (!uploadImage || !editor) return;
    uploading += 1;
    try {
      const url = await uploadImage(file);
      // setImage requires the editor to have focus to find an insertion point.
      editor.chain().focus().setImage({ src: url }).run();
    } catch (e) {
      saveStatus = 'error';
      // eslint-disable-next-line no-console
      console.error('image upload failed:', e);
    } finally {
      uploading -= 1;
    }
  }

  function extractImageFiles(dt: DataTransfer | null | undefined): File[] {
    const out: File[] = [];
    if (!dt) return out;
    if (dt.files && dt.files.length) {
      for (const f of Array.from(dt.files)) {
        if (f.type.startsWith('image/')) out.push(f);
      }
    }
    if (!out.length && dt.items && dt.items.length) {
      for (const item of Array.from(dt.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) out.push(f);
        }
      }
    }
    return out;
  }

  function pickImage() {
    if (!uploadImage) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) await uploadAndInsert(file);
    };
    input.click();
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      manualSave();
    }
  }

  function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Walk text nodes inside the editor to find a span that, when joined, contains `snippet`. */
  function locateSnippet(snippet: string): { from: number; to: number } | null {
    if (!editor || !snippet) return null;
    const needle = snippet.replace(/\s+/g, ' ').trim();
    if (!needle) return null;
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' ');
    const collapsed = text.replace(/\s+/g, ' ');
    const idx = collapsed.toLowerCase().indexOf(needle.toLowerCase());
    if (idx < 0) return null;
    // Map back from collapsed index to doc positions by walking nodes.
    let pos = 0;
    let collapsedPos = 0;
    let from = -1;
    let to = -1;
    let prevWS = false;
    editor.state.doc.descendants((node, nodePos) => {
      if (from >= 0 && to >= 0) return false;
      if (!node.isText) {
        // Block boundaries collapse to a single space in textBetween.
        if (node.isBlock && collapsedPos > 0 && !prevWS) {
          if (collapsedPos === idx && from < 0) from = nodePos;
          if (collapsedPos === idx + needle.length && from >= 0 && to < 0) to = nodePos;
          collapsedPos += 1;
          prevWS = true;
        }
        return true;
      }
      const t = node.text ?? '';
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        const isWS = /\s/.test(ch);
        if (isWS && prevWS) {
          // collapsed run — don't advance collapsedPos
        } else {
          if (collapsedPos === idx && from < 0) from = nodePos + i;
          collapsedPos += 1;
          if (collapsedPos === idx + needle.length && from >= 0 && to < 0) to = nodePos + i + 1;
          prevWS = isWS;
        }
      }
      return true;
    });
    if (from < 0 || to < 0 || to <= from) return null;
    return { from, to };
  }

  let footnoteCount = $state(0);

  function setApi() {
    api = {
      getHTML: () => editor?.getHTML() ?? content,
      getText: () => editor?.getText() ?? '',
      linkSnippet: (snippet, url, title) => {
        if (!editor) return false;
        const range = locateSnippet(snippet);
        if (!range) return false;
        editor
          .chain()
          .focus()
          .setTextSelection(range)
          .setLink({ href: url, ...(title ? { title } : {}) })
          .run();
        return true;
      },
      addFootnote: (snippet, url, title) => {
        if (!editor) return 0;
        footnoteCount += 1;
        const n = footnoteCount;
        const range = locateSnippet(snippet);
        if (range) {
          editor
            .chain()
            .focus()
            .setTextSelection({ from: range.to, to: range.to })
            .insertContent(`<sup class="footnote-ref" id="fnref-${n}"><a href="#fn-${n}">[${n}]</a></sup>`)
            .run();
        }
        // Append (or extend) a footnotes list at the end of the document.
        const doc = editor.getHTML();
        const labelHtml = title ? `${escapeHtml(title)} — ` : '';
        const itemHtml = `<li id="fn-${n}">${labelHtml}<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></li>`;
        const listOpen = '<hr><h3>Sources</h3><ol class="footnotes">';
        if (doc.includes('<ol class="footnotes">')) {
          const updated = doc.replace('</ol>', `${itemHtml}</ol>`);
          editor.commands.setContent(updated, { emitUpdate: true });
        } else {
          editor
            .chain()
            .focus('end')
            .insertContent(`${listOpen}${itemHtml}</ol>`)
            .run();
        }
        return n;
      },
      applyProposal: (p) => {
        if (!editor) return false;
        const found = locateOriginal(editor, p);
        if (!found) {
          // Surface but don't throw — the chat status row can show this gap.
          // The proposal still exists in the store; the user just can't act on
          // it from the body. Likely cause: LLM `find` does not appear in the
          // current document text (post was edited since the proposal was
          // generated, or the `find` includes structural fragments).
          console.warn('[RichEditor] applyProposal: could not anchor proposal', p.id, JSON.stringify(p.original).slice(0, 120));
          return false;
        }
        const tr = editor.state.tr.setMeta(suggestionPluginKey, {
          add: { id: p.id, from: found.from, to: found.to, replace: p.suggested },
        });
        editor.view.dispatch(tr);
        return true;
      },
      acceptProposal: (id, modifiedText) => {
        if (!editor) return false;
        const ps = suggestionPluginKey.getState(editor.state);
        const range = ps?.ranges.get(id);
        if (!range) return false;

        // Snapshot the literal pre-mutation HTML so the user can roll back
        // the exact bytes that were on screen the moment they clicked Accept.
        const htmlBeforeAccept = editor.getHTML();
        const replaceText = modifiedText ?? range.replace;

        const tr = editor.state.tr;
        if (replaceText.length === 0) {
          tr.delete(range.from, range.to);
        } else {
          tr.replaceWith(range.from, range.to, editor.state.schema.text(replaceText));
        }
        tr.setMeta(suggestionPluginKey, { remove: id });
        editor.view.dispatch(tr);

        // Sanity guard — refuse silent >30% deletions.
        const after = editor.getHTML();
        const ratio = after.length / Math.max(1, htmlBeforeAccept.length);
        if (ratio < 0.7 && htmlBeforeAccept.length - after.length > 200) {
          const ok = window.confirm(
            `Heads up — accepting this would remove ~${Math.round((1 - ratio) * 100)}% of the post body. Apply anyway?`,
          );
          if (!ok) {
            editor.commands.setContent(htmlBeforeAccept, { emitUpdate: false });
            return false;
          }
        }

        onProposalAccepted?.(id, replaceText, htmlBeforeAccept);
        if (onAutoSave) void onAutoSave(after).catch(() => {});
        return true;
      },
      rejectProposal: (id) => {
        if (!editor) return false;
        // Decorations are an overlay only; rejecting is purely state — no
        // edits to the document, so nothing for autosave to chase.
        const tr = editor.state.tr.setMeta(suggestionPluginKey, { remove: id });
        editor.view.dispatch(tr);
        onProposalRejected?.(id);
        return true;
      },
      clearAllSuggestions: () => {
        if (!editor) return;
        const tr = editor.state.tr.setMeta(suggestionPluginKey, { clear: true });
        editor.view.dispatch(tr);
      },
      setContent: (html) => {
        if (!editor) return;
        // Replacing the doc invalidates every tracked range — clear before
        // the swap so the plugin doesn't try to map stale positions.
        const tr = editor.state.tr.setMeta(suggestionPluginKey, { clear: true });
        editor.view.dispatch(tr);
        editor.commands.setContent(html, { emitUpdate: true });
      },
    };
  }

  function locateOriginal(ed: Editor, p: ProseProposal): { from: number; to: number } | null {
    if (p.original.length === 0) {
      return { from: p.anchor.from + 1, to: p.anchor.from + 1 };
    }
    const docText = ed.state.doc.textContent;

    // Fast path: literal match.
    let idx = docText.indexOf(p.original);
    let needleLen = p.original.length;

    // Fallback path: collapse whitespace runs on both sides and search again.
    // The proposal's `original` was matched against a tag-stripped, whitespace-
    // collapsed haystack on the server; the editor's textContent collapses
    // block boundaries differently, so a literal compare can still miss.
    if (idx < 0) {
      const collapsedDoc = docText.replace(/\s+/g, ' ');
      const collapsedNeedle = p.original.replace(/\s+/g, ' ').trim();
      const cIdx = collapsedDoc.indexOf(collapsedNeedle);
      if (cIdx < 0) return null;
      // Map collapsed index back to original docText by walking and counting.
      let consumed = 0;
      let prevWs = false;
      for (let i = 0; i < docText.length; i++) {
        const isWs = /\s/.test(docText[i]);
        const collapsedHere = isWs ? (prevWs ? false : true) : true;
        if (collapsedHere) {
          if (consumed === cIdx) { idx = i; break; }
          consumed += 1;
        }
        prevWs = isWs;
      }
      if (idx < 0) return null;
      // Walk forward in docText to cover collapsedNeedle.length characters.
      let needleConsumed = 0;
      let j = idx;
      let prevWs2 = false;
      while (j < docText.length && needleConsumed < collapsedNeedle.length) {
        const isWs = /\s/.test(docText[j]);
        if (!(isWs && prevWs2)) needleConsumed += 1;
        prevWs2 = isWs;
        j += 1;
      }
      needleLen = j - idx;
    }

    return { from: idx + 1, to: idx + 1 + needleLen };
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  onMount(() => {
    if (!host) return;
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({
          codeBlock: { HTMLAttributes: { class: 'hljs' } },
          // StarterKit v3 ships Link; disable so our explicit Link config wins.
          link: false,
        }),
        Image.configure({ inline: false, allowBase64: false }),
        Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
        Placeholder.configure({ placeholder: 'Write your post… paste images directly into the body.' }),
        SuggestionDecorations,
      ],
      content: content || '',
      onUpdate: () => {
        recomputeScores();
        scheduleAutoSave();
      },
      editorProps: {
        attributes: { class: 'rich-content' },
        handlePaste: (_view, event) => {
          const items = event.clipboardData?.items;
          if (!items) return false;
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
              const file = item.getAsFile();
              if (file) {
                event.preventDefault();
                uploadAndInsert(file);
                return true;
              }
            }
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const files = (event as DragEvent).dataTransfer?.files;
          if (!files || !files.length) return false;
          for (const file of Array.from(files)) {
            if (file.type.startsWith('image/')) {
              event.preventDefault();
              uploadAndInsert(file);
              return true;
            }
          }
          return false;
        },
      },
    });

    // Native, capture-phase paste/drop listeners. ProseMirror's `handlePaste`
    // sometimes never fires for image-only clipboards (e.g. screenshot paste
    // with no text/html alternative); attaching here means we catch the event
    // before ProseMirror gets a chance to ignore it.
    const onPasteNative = (e: Event) => {
      if (!uploadImage) return;
      const ev = e as ClipboardEvent;
      const files = extractImageFiles(ev.clipboardData);
      if (!files.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      for (const f of files) uploadAndInsert(f);
    };
    const onDropNative = (e: Event) => {
      if (!uploadImage) return;
      const ev = e as DragEvent;
      const files = extractImageFiles(ev.dataTransfer);
      if (!files.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      for (const f of files) uploadAndInsert(f);
    };
    host.addEventListener('paste', onPasteNative, { capture: true });
    host.addEventListener('drop', onDropNative, { capture: true });
    // Click on a suggestion mark → broadcast so the margin callout layer
    // can scroll to and highlight its own card. Bubbles up from the inner
    // <ins>/<del data-suggestion-id> element.
    const onSuggestionClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      const el = target?.closest('[data-suggestion-id]') as HTMLElement | null;
      if (!el) return;
      const id = el.getAttribute('data-suggestion-id');
      if (!id) return;
      window.dispatchEvent(new CustomEvent('jkai:suggestion-click', { detail: { id, source: 'body' } }));
    };
    host.addEventListener('click', onSuggestionClick);
    // Stash for cleanup.
    (host as any).__pasteCleanup = () => {
      host?.removeEventListener('paste', onPasteNative, { capture: true } as any);
      host?.removeEventListener('drop', onDropNative, { capture: true } as any);
      host?.removeEventListener('click', onSuggestionClick);
    };

    recomputeScores();
    // Initialise footnote counter from any pre-existing footnotes.
    const existing = editor?.getHTML() ?? '';
    const matches = existing.match(/id="fn-(\d+)"/g);
    if (matches) {
      footnoteCount = matches
        .map((m) => parseInt(m.replace(/\D/g, ''), 10))
        .reduce((max, n) => (n > max ? n : max), 0);
    }
    setApi();
  });

  onDestroy(() => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (host && (host as any).__pasteCleanup) (host as any).__pasteCleanup();
    editor?.destroy();
    editor = null;
  });

  function btn(action: () => void, isActive: () => boolean = () => false) {
    return { onclick: action, active: isActive() };
  }
  const noop = () => {};
  // Reactive derivations referencing editor must read state through getters.
  let activeMap = $state({ bold: false, italic: false, strike: false, h2: false, h3: false, ul: false, ol: false, quote: false, code: false, link: false });
  function refreshActive() {
    if (!editor) return;
    activeMap = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      ul: editor.isActive('bulletList'),
      ol: editor.isActive('orderedList'),
      quote: editor.isActive('blockquote'),
      code: editor.isActive('codeBlock'),
      link: editor.isActive('link'),
    };
  }
  $effect(() => {
    if (!editor) return;
    const handler = () => refreshActive();
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor?.off('selectionUpdate', handler);
      editor?.off('transaction', handler);
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="editor-wrapper">
  <div class="toolbar">
    <div class="toolbar-left">
      <button class="tool-btn" class:active={activeMap.bold} onclick={() => editor?.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)"><b>B</b></button>
      <button class="tool-btn" class:active={activeMap.italic} onclick={() => editor?.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)"><i>I</i></button>
      <button class="tool-btn" class:active={activeMap.strike} onclick={() => editor?.chain().focus().toggleStrike().run()} title="Strikethrough (Ctrl+Shift+X)"><s>S</s></button>
      <span class="tool-divider"></span>
      <button class="tool-btn" class:active={activeMap.h2} onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">H2</button>
      <button class="tool-btn" class:active={activeMap.h3} onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">H3</button>
      <span class="tool-divider"></span>
      <button class="tool-btn" class:active={activeMap.ul} onclick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet list">• List</button>
      <button class="tool-btn" class:active={activeMap.ol} onclick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list">1. List</button>
      <button class="tool-btn" class:active={activeMap.quote} onclick={() => editor?.chain().focus().toggleBlockquote().run()} title="Quote">&ldquo;</button>
      <button class="tool-btn" class:active={activeMap.code} onclick={() => editor?.chain().focus().toggleCodeBlock().run()} title="Code block">&lt;/&gt;</button>
      <span class="tool-divider"></span>
      <button class="tool-btn" class:active={activeMap.link} onclick={setLink} title="Link (Ctrl+K)">Link</button>
      <button class="tool-btn" onclick={pickImage} disabled={!uploadImage} title="Upload image">Image</button>
    </div>
  </div>

  <div bind:this={host} class="rich-host"></div>

  {#if scores.words > 0}
    <div class="readability">
      <span class="r-pill">Reading ease <strong>{scores.fleschReadingEase}</strong></span>
      <span class="r-pill">Grade <strong>{scores.fleschKincaidGrade}</strong></span>
      <span class="r-audience">{scores.audience}</span>
      <span class="r-meta">{scores.sentences} sentences · {(scores.words / Math.max(1, scores.sentences)).toFixed(1)} words/sentence</span>
    </div>
  {/if}

  <div class="status-bar">
    <div class="status-left">
      <span class="status-item">Rich Text</span>
      {#if uploading > 0}
        <span class="status-item status-saving">Uploading {uploading} image{uploading > 1 ? 's' : ''}…</span>
      {:else if saveStatus !== 'idle'}
        <span class="status-item status-{saveStatus}">
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Error'}
        </span>
      {/if}
    </div>
    <div class="status-right">
      <span class="status-item" title="Flesch Reading Ease (higher = easier; ~60 plain English)">FRE {scores.fleschReadingEase}</span>
      <span class="status-item" title="Flesch–Kincaid grade level (US school grade)">FKGL {scores.fleschKincaidGrade}</span>
      <span class="status-item">{scores.words} words</span>
      <span class="status-item">{readTime(scores.words)}</span>
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
  .toolbar {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid var(--card-border);
    background: var(--card-bg);
    gap: 4px;
  }
  .toolbar-left { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
  .tool-btn {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 28px; height: 28px; padding: 0 6px;
    border: none; border-radius: 4px;
    background: transparent; color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font-mono); font-size: 11px;
    transition: background 0.15s, color 0.15s;
  }
  .tool-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: var(--text-primary); }
  .tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .tool-btn.active { background: rgba(196, 87, 10, 0.12); color: var(--accent); }
  .tool-divider { width: 1px; height: 16px; background: var(--card-border); margin: 0 4px; }
  .rich-host { min-height: 480px; padding: 16px 22px; overflow-y: auto; }

  .rich-host :global(.ProseMirror) { outline: none; min-height: 460px; line-height: 1.7; color: var(--text-secondary); font-size: 1rem; }
  .rich-host :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: var(--text-ghost); float: left; height: 0; font-style: italic; pointer-events: none;
  }
  .rich-host :global(h1), .rich-host :global(h2), .rich-host :global(h3) {
    font-family: var(--font-display); font-weight: 900; text-transform: uppercase;
    letter-spacing: -0.01em; color: var(--text-primary); margin-top: 1.4em; margin-bottom: 0.4em;
  }
  .rich-host :global(h2) { font-size: 1.5rem; }
  .rich-host :global(h3) { font-size: 1.2rem; }
  .rich-host :global(p) { margin: 0 0 1.1em; }
  .rich-host :global(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
  .rich-host :global(code) {
    font-family: var(--font-mono); font-size: 0.875em;
    padding: 0.15em 0.45em; background: var(--card-bg); border: 1px solid var(--card-border);
  }
  .rich-host :global(pre) {
    padding: 1.1em 1.4em; margin: 1.4em 0; overflow-x: auto;
    background: var(--card-bg); border: 2px solid var(--card-border); font-size: 0.875rem;
  }
  .rich-host :global(pre code) { padding: 0; background: none; border: none; }
  .rich-host :global(blockquote) {
    border-left: 3px solid var(--accent); padding-left: 1.1em; margin: 1.3em 0;
    font-style: italic; color: var(--text-muted);
  }
  .rich-host :global(ul), .rich-host :global(ol) { padding-left: 1.4em; margin-bottom: 1.1em; }
  .rich-host :global(li) { margin-bottom: 0.4em; }
  .rich-host :global(img) { max-width: 100%; margin: 1.2em 0; }

  .status-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 12px; border-top: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--text-ghost); background: var(--card-bg);
  }
  .status-left, .status-right { display: flex; align-items: center; gap: 12px; }
  .status-saving { color: var(--accent); }
  .status-saved { color: #4a9; }
  .status-error { color: #c44; }

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

  /* Margin-only display: highlight the original (will be replaced) in the
     body, hide the proposed insertion entirely (it lives in the callout). */
  :global(.sg-remove) {
    background: rgba(255, 217, 64, 0.45); /* warm marker-pen yellow */
    text-decoration: none;
    border-radius: 2px;
    padding: 0 1px;
    cursor: pointer;
    transition: background 120ms ease;
  }
  :global(.sg-add) {
    display: none;
  }
  /* Active state — bumped highlight when the user clicks a callout. */
  :global(.sg-remove.sg-active) {
    background: rgba(255, 184, 0, 0.85);
    outline: 2px solid rgba(255, 184, 0, 1);
    outline-offset: 1px;
  }
</style>
