<script lang="ts">
  import VoicePanel from './VoicePanel.svelte';
  import type { VoiceCard } from '$lib/voice/types';
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Image from '@tiptap/extension-image';
  import Link from '@tiptap/extension-link';
  import Placeholder from '@tiptap/extension-placeholder';
  import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
  // The picker's options and the sanitiser's font-family allow-list are built
  // from the SAME list. They used to be two hand-written copies, so a face
  // added here looked perfect in /admin and was silently stripped on /blog.
  import { FONT_OPTIONS } from '$lib/blog/fonts';
  import { Figure, ProjectEmbed, PullQuote, Callout, Disclosure, Sidenote } from '$lib/blog/tiptap-extras';
  import { readability, type ReadabilityScores } from '$lib/blog/readability';
  import { SuggestionDecorations, suggestionPluginKey } from '$lib/blog/assistant/suggestion-decorations';
  import type { ProseProposal } from '$lib/blog/assistant/proposal';
  import type { RichEditorApi } from './rich-editor-api';


  let {
    content = '',
    onSave,
    onAutoSave,
    uploadImage,
    api = $bindable<RichEditorApi | undefined>(),
    onProposalAccepted,
    onProposalRejected,
    voiceCard = null,
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
    /** Passed through from the page loader. Null simply hides the Voice panel. */
    voiceCard?: VoiceCard | null;
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

  // Recomputed alongside the readability scores, from the same plain text, so
  // the Voice panel never disagrees with the strip above it about the document.
  let plainForVoice = $state('');

  function recomputeScores() {
    const text = editor?.getText() ?? '';
    scores = readability(text);
    plainForVoice = text;
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

  /**
   * Insert an uploaded file.
   *
   * `at` is a ProseMirror document position resolved from the DROP COORDINATES
   * before the upload starts. Without it every dropped image landed wherever
   * the caret happened to be — which for a drag from the desktop is usually
   * the last place the author clicked, often several paragraphs away. The
   * position is resolved up front because by the time the upload resolves the
   * pointer is long gone.
   *
   * Each insert advances `at`, so dropping three files at once lays them out
   * in the order they were dropped rather than the order the uploads happen to
   * finish in.
   */
  async function uploadAndInsert(file: File, at?: number) {
    if (!uploadImage || !editor) return;
    uploading += 1;
    try {
      const url = await uploadImage(file);
      if (!editor) return;
      const isVideo = file.type.startsWith('video/');
      const chain = editor.chain().focus();
      if (typeof at === 'number') chain.setTextSelection(Math.min(at, editor.state.doc.content.size));
      if (isVideo) {
        // No Video node exists yet, so a video is inserted as raw HTML the
        // sanitiser now admits (src/lib/blog/renderer.ts allows video/source
        // attributes). It round-trips as an unknown block rather than a
        // first-class node — good enough to publish, and honest about it.
        chain.insertContent(`<video src="${url}" controls playsinline></video>`).run();
      } else {
        // setImage requires the editor to have focus to find an insertion point.
        chain.setImage({ src: url }).run();
      }
    } catch (e) {
      saveStatus = 'error';
      // eslint-disable-next-line no-console
      console.error('media upload failed:', e);
    } finally {
      uploading -= 1;
    }
  }

  /** Media files from a clipboard or a drag. Video rides the same lane as
   *  images now that the upload endpoint accepts mp4/webm. */
  function isUploadableMedia(type: string): boolean {
    return type.startsWith('image/') || type === 'video/mp4' || type === 'video/webm';
  }

  function extractImageFiles(dt: DataTransfer | null | undefined): File[] {
    const out: File[] = [];
    if (!dt) return out;
    if (dt.files && dt.files.length) {
      for (const f of Array.from(dt.files)) {
        if (isUploadableMedia(f.type)) out.push(f);
      }
    }
    if (!out.length && dt.items && dt.items.length) {
      for (const item of Array.from(dt.items)) {
        if (item.kind === 'file' && isUploadableMedia(item.type)) {
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
      // stopPropagation is not enough — this is a window listener and so is the
      // page's. Both fired for a Ctrl+S anywhere on the page, sending two PUTs
      // for one keystroke.
      //
      // The boundary must be EXACTLY the page's: it skips when the target is
      // inside `.editor-wrapper`, so this handler must own precisely that
      // region. Guarding on `.rich-host` instead would leave a gap — the
      // toolbar and the font selects are inside the wrapper but outside the
      // host, and a Ctrl+S with one of those focused would then fire neither
      // handler and silently save nothing.
      const target = e.target;
      if (target instanceof HTMLElement && !target.closest('.editor-wrapper')) return;
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
        const { schema } = editor.state;
        const strikeMark = schema.marks.strike;

        // Resolve the containing block so we can scrub stale Strike marks
        // from it. Legacy <s> tags often span multiple sentences; replacing
        // just our sentence leaves the neighbours visually struck. The user
        // has the toolbar Strike button if they want it back deliberately.
        const resolvedFrom = editor.state.doc.resolve(range.from);
        const blockDepth = Math.max(1, resolvedFrom.depth);
        const blockStart = resolvedFrom.start(blockDepth);
        const blockEnd = resolvedFrom.end(blockDepth);

        const tr = editor.state.tr;
        if (strikeMark) {
          tr.removeMark(blockStart, blockEnd, strikeMark);
        }
        if (replaceText.length === 0) {
          tr.delete(range.from, range.to);
        } else {
          // Pass an explicit empty marks array so the inserted text never
          // inherits storedMarks (Strike included) from the boundary.
          tr.replaceWith(range.from, range.to, schema.text(replaceText, []));
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
      insertMedia: (item) => {
        if (!editor) return;
        const chain = editor.chain().focus();
        if (item.mimeType.startsWith('video/')) {
          // No Video node exists, so this rides the raw-HTML path the
          // sanitiser now admits (video/source attributes were allowed as tags
          // but stripped of every attribute until 2026-08-30).
          chain.insertContent(`<video src="${item.url}" controls playsinline></video>`).run();
        } else {
          chain.setImage({ src: item.url, alt: item.altText ?? undefined }).run();
        }
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
    const cleanedOriginal = p.original.replace(/<\/?[^>]+>/g, '');
    if (cleanedOriginal.length === 0) {
      // Empty range — return a zero-width position at doc start.
      return { from: 1, to: 1 };
    }

    // Walk every text node, recording each one's text-content slice and the
    // ProseMirror position it occupies. Concatenating `text` across spans
    // gives the same string as `doc.textContent`. Mapping a textContent
    // index back to a PM position is then exact — including the +2 cost of
    // every block-node boundary the cursor crosses, which the previous
    // `+1` shortcut got wrong (the cause of "accept deletes a whole section").
    type Span = { pmStart: number; tcStart: number; len: number };
    const spans: Span[] = [];
    let tcCursor = 0;
    ed.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const len = (node.text ?? '').length;
      spans.push({ pmStart: pos, tcStart: tcCursor, len });
      tcCursor += len;
    });
    const fullText = ed.state.doc.textContent;

    // Locate the needle, with a whitespace-collapsed fallback if the literal
    // compare misses (block boundaries can disagree with what the segmenter
    // produced).
    let tcIdx = fullText.indexOf(cleanedOriginal);
    let needleLen = cleanedOriginal.length;
    if (tcIdx < 0) {
      const collapsedDoc = fullText.replace(/\s+/g, ' ');
      const collapsedNeedle = cleanedOriginal.replace(/\s+/g, ' ').trim();
      if (!collapsedNeedle) return null;
      const cIdx = collapsedDoc.indexOf(collapsedNeedle);
      if (cIdx < 0) return null;
      let consumed = 0;
      let prevWs = false;
      for (let i = 0; i < fullText.length; i++) {
        const isWs = /\s/.test(fullText[i]);
        const collapsedHere = isWs ? !prevWs : true;
        if (collapsedHere) {
          if (consumed === cIdx) { tcIdx = i; break; }
          consumed += 1;
        }
        prevWs = isWs;
      }
      if (tcIdx < 0) return null;
      let needleConsumed = 0;
      let j = tcIdx;
      let prevWs2 = false;
      while (j < fullText.length && needleConsumed < collapsedNeedle.length) {
        const isWs = /\s/.test(fullText[j]);
        if (!(isWs && prevWs2)) needleConsumed += 1;
        prevWs2 = isWs;
        j += 1;
      }
      needleLen = j - tcIdx;
    }
    const tcEnd = tcIdx + needleLen;

    // Translate textContent indices to ProseMirror positions via the span
    // map. Each span owns the half-open interval [tcStart, tcStart + len).
    function tcToPm(tc: number): number | null {
      for (const s of spans) {
        if (tc >= s.tcStart && tc <= s.tcStart + s.len) {
          return s.pmStart + (tc - s.tcStart);
        }
      }
      return null;
    }
    const from = tcToPm(tcIdx);
    const to = tcToPm(tcEnd);
    if (from === null || to === null || to <= from) {
      console.warn('[RichEditor] locateOriginal: span-map miss', { tcIdx, tcEnd, spans: spans.length });
      return null;
    }
    return { from, to };
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
        Image.configure({
          inline: false,
          allowBase64: false,
          // `resize` is an OBJECT or `false`, never a boolean true — the type is
          // `{ enabled, directions?, minWidth?, minHeight?, alwaysPreserveAspectRatio? } | false`.
          // It ships inside @tiptap/extension-image, so turning it on costs no new
          // package (and every @tiptap/* must move as ONE unit, so a new one would
          // drag a coordinated bump of all six). The sanitiser already permits
          // width/height on <img>.
          resize: { enabled: true, minWidth: 120, alwaysPreserveAspectRatio: true },
        }),
        Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
        Placeholder.configure({ placeholder: 'Write your post… paste images directly into the body.' }),
        TextStyle,
        FontFamily,
        FontSize,
        Figure,
        ProjectEmbed,
        PullQuote,
        Callout,
        Disclosure,
        Sidenote,
        SuggestionDecorations,
      ],
      content: content || '',
      onUpdate: () => {
        recomputeScores();
        scheduleAutoSave();
      },
      editorProps: {
        attributes: { class: 'rich-content' },
        // The slash menu owns these keys only while it is open, and returning
        // true is what stops the keystroke reaching the document.
        handleKeyDown: (_view, event) => {
          if (!slashOpen) return false;
          const items = slashFiltered;
          if (event.key === 'Escape') {
            closeSlash();
            return true;
          }
          if (event.key === 'ArrowDown') {
            slashIndex = items.length ? (slashIndex + 1) % items.length : 0;
            return true;
          }
          if (event.key === 'ArrowUp') {
            slashIndex = items.length ? (slashIndex - 1 + items.length) % items.length : 0;
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const item = items[slashIndex];
            if (!item) return false;
            runSlashItem(item);
            return true;
          }
          return false;
        },
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
      // The early return is load-bearing: it is what lets ProseMirror handle
      // an INTERNAL drag (image, figure and projectEmbed are all draggable).
      // Calling preventDefault() unconditionally here kills node reordering.
      if (!files.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      // Resolve the drop point NOW — the pointer is gone by the time the
      // upload resolves.
      const coords = editor?.view.posAtCoords({ left: ev.clientX, top: ev.clientY });
      let at = coords?.pos;
      for (const f of files) {
        uploadAndInsert(f, at);
        // Advance so a multi-file drop keeps the dropped order.
        if (typeof at === 'number') at += 1;
      }
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
  let activeMap = $state({ bold: false, italic: false, strike: false, underline: false, h2: false, h3: false, ul: false, ol: false, quote: false, code: false, link: false, image: false, figure: false, fontFamily: '', fontSize: '' });
  function refreshActive() {
    if (!editor) return;
    const textStyle = editor.getAttributes('textStyle');
    activeMap = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      underline: editor.isActive('underline'),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      ul: editor.isActive('bulletList'),
      ol: editor.isActive('orderedList'),
      quote: editor.isActive('blockquote'),
      code: editor.isActive('codeBlock'),
      link: editor.isActive('link'),
      image: editor.isActive('image'),
      figure: editor.isActive('figure'),
      fontFamily: (textStyle.fontFamily as string | undefined) ?? '',
      fontSize: (textStyle.fontSize as string | undefined) ?? '',
    };
  }

  function applyFontFamily(v: string) {
    if (!editor) return;
    if (v) editor.chain().focus().setFontFamily(v).run();
    else editor.chain().focus().unsetFontFamily().run();
    refreshActive();
  }

  function applyFontSize(v: string) {
    if (!editor) return;
    if (v) editor.chain().focus().setFontSize(v).run();
    else editor.chain().focus().unsetFontSize().run();
    refreshActive();
  }

  function toggleCaption() {
    if (!editor) return;
    if (activeMap.figure) editor.chain().focus().figureToImage().run();
    else editor.chain().focus().imageToFigure().run();
  }

  function embedProject() {
    if (!editor) return;
    const input = window.prompt('Project to embed — a /projects/<slug> path or full URL', '/projects/');
    if (!input) return;
    let path = input.trim();
    try {
      if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
    } catch {
      // keep as typed; the check below rejects anything unusable
    }
    if (!/^\/projects\/[a-z0-9][a-z0-9-]*/i.test(path)) {
      window.alert('Embeds must point at a /projects/<slug> page.');
      return;
    }
    const slug = path.split('/')[2];
    const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    editor.chain().focus().setProjectEmbed({ src: path, title }).run();
  }

  // ---------------------------------------------------------------------
  // Slash menu.
  //
  // Written natively rather than with @tiptap/suggestion. That package is not
  // installed, and TipTap 3.x extensions peer on an EXACT @tiptap/core version
  // — adding one drags a coordinated bump of all six @tiptap packages, which is
  // a disproportionate risk for a menu. Everything it needs is already
  // reachable: the doc state says whether a trigger is active, and
  // `coordsAtPos` says where to draw it.
  //
  // The trigger is a "/" that OPENS a text block. Allowing it mid-sentence
  // means every URL and every date opens a menu, which is how a helpful
  // affordance becomes something the author fights.
  // ---------------------------------------------------------------------

  type SlashItem = {
    key: string;
    label: string;
    hint: string;
    /** Search terms beyond the label. */
    terms?: string[];
    run: () => void;
  };

  // These are read by the template, so they are genuinely reactive state —
  // unlike the timer and observer handles elsewhere in this file.
  let slashOpen = $state(false);
  let slashQuery = $state('');
  let slashIndex = $state(0);
  let slashLeft = $state(0);
  let slashTop = $state(0);
  // The document position of the "/" itself. Not reactive: only the handlers
  // read it, and making it reactive would put a read and a write of the same
  // signal inside one function.
  let slashFrom = -1;

  function slashItems(): SlashItem[] {
    if (!editor) return [];
    const e = editor;
    return [
      { key: 'h2', label: 'Heading', hint: 'Section heading', terms: ['h2', 'title'], run: () => e.chain().focus().toggleHeading({ level: 2 }).run() },
      { key: 'h3', label: 'Subheading', hint: 'Sub-section', terms: ['h3'], run: () => e.chain().focus().toggleHeading({ level: 3 }).run() },
      { key: 'ul', label: 'Bulleted list', hint: 'A list of points', terms: ['bullet', 'list'], run: () => e.chain().focus().toggleBulletList().run() },
      { key: 'ol', label: 'Numbered list', hint: 'An ordered list', terms: ['number', 'ordered'], run: () => e.chain().focus().toggleOrderedList().run() },
      { key: 'quote', label: 'Quote', hint: 'Block quotation', terms: ['blockquote'], run: () => e.chain().focus().toggleBlockquote().run() },
      { key: 'pull', label: 'Pull quote', hint: 'A line lifted out and set large', terms: ['pullquote', 'feature'], run: () => e.chain().focus().setPullQuote().run() },
      { key: 'note', label: 'Callout', hint: 'A bordered aside', terms: ['aside', 'info'], run: () => e.chain().focus().setCallout('note').run() },
      { key: 'warn', label: 'Warning callout', hint: 'A callout in the warn colour', terms: ['caution'], run: () => e.chain().focus().setCallout('warn').run() },
      { key: 'sidenote', label: 'Sidenote', hint: 'A note in the margin', terms: ['margin', 'footnote'], run: () => e.chain().focus().setSidenote().run() },
      { key: 'details', label: 'Collapsible section', hint: 'Hidden until the reader opens it', terms: ['disclosure', 'accordion', 'interactive'], run: () => e.chain().focus().setDisclosure('Details').run() },
      { key: 'code', label: 'Code block', hint: 'Syntax-highlighted code', terms: ['pre'], run: () => e.chain().focus().toggleCodeBlock().run() },
      { key: 'hr', label: 'Divider', hint: 'A break between sections', terms: ['rule', 'separator'], run: () => e.chain().focus().setHorizontalRule().run() },
      { key: 'image', label: 'Image', hint: 'Upload or drop a picture', terms: ['photo', 'picture', 'media'], run: () => pickImage() },
      { key: 'embed', label: 'Project embed', hint: 'Embed a /projects page', terms: ['iframe'], run: () => embedProject() },
    ];
  }

  const slashFiltered = $derived.by(() => {
    const q = slashQuery.trim().toLowerCase();
    const all = slashItems();
    if (!q) return all;
    return all.filter(
      (i) => i.label.toLowerCase().includes(q) || (i.terms ?? []).some((t) => t.includes(q)),
    );
  });

  function closeSlash() {
    slashOpen = false;
    slashQuery = '';
    slashIndex = 0;
    slashFrom = -1;
  }

  /** Re-evaluate the trigger from the document. Called on every transaction. */
  function refreshSlash() {
    if (!editor) return;
    const { state } = editor;
    // Aliased away from `$from`: Svelte reserves the `$` prefix for binding
    // names, so destructuring ProseMirror's resolved position under its own
    // property name is a compile error in a component.
    const { $from: cursor, empty } = state.selection;
    if (!empty || !cursor.parent.isTextblock) {
      if (slashOpen) closeSlash();
      return;
    }
    const start = cursor.start();
    const before = state.doc.textBetween(start, cursor.pos, '\n', '\n');
    const match = /^\/([\w-]*)$/.exec(before);
    if (!match) {
      if (slashOpen) closeSlash();
      return;
    }
    slashFrom = start;
    slashQuery = match[1];
    slashIndex = 0;
    if (!slashOpen) slashOpen = true;
    try {
      const coords = editor.view.coordsAtPos(start);
      slashLeft = coords.left;
      slashTop = coords.bottom + 6;
    } catch {
      // A position that cannot be measured (mid-relayout) is not worth
      // throwing over; the menu keeps its last coordinates.
    }
  }

  function runSlashItem(item: SlashItem) {
    if (!editor || slashFrom < 0) return;
    const to = editor.state.selection.from;
    const from = slashFrom;
    closeSlash();
    // Delete the "/query" text FIRST, in its own transaction, so the command
    // below acts on a clean empty block. Chaining the two lets the command see
    // a block that still contains the trigger text, which several of them then
    // wrap instead of replacing.
    editor.chain().focus().deleteRange({ from, to }).run();
    item.run();
  }

  $effect(() => {
    if (!editor) return;
    const handler = () => {
      refreshActive();
      refreshSlash();
    };
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
      <button class="tool-btn" class:active={activeMap.underline} onclick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline (Ctrl+U)"><u>U</u></button>
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
      <button class="tool-btn" onclick={pickImage} disabled={!uploadImage} title="Upload image (or paste/drop a screenshot straight into the body)">Image</button>
      <button class="tool-btn" class:active={activeMap.figure} onclick={toggleCaption} disabled={!activeMap.image && !activeMap.figure} title={activeMap.figure ? 'Remove the caption (back to a plain image)' : 'Add a caption to the selected image'}>Caption</button>
      <button class="tool-btn" onclick={embedProject} title="Embed a /projects page into the post">Embed</button>
      <span class="tool-divider"></span>
      <select class="tool-select" title="Font for the selected text — site fonts only" value={activeMap.fontFamily} onchange={(e) => applyFontFamily(e.currentTarget.value)}>
        <option value="">Font</option>
        {#each FONT_OPTIONS as f (f.key)}
          <option value={f.cssVar} title={f.hint}>{f.label}</option>
        {/each}
      </select>
      <select class="tool-select" title="Text size" value={activeMap.fontSize} onchange={(e) => applyFontSize(e.currentTarget.value)}>
        <option value="">Size</option>
        <option value="0.875em">Small</option>
        <option value="1.15em">Large</option>
        <option value="1.35em">XL</option>
      </select>
    </div>
  </div>

  <div bind:this={host} class="rich-host"></div>

  {#if slashOpen && slashFiltered.length > 0}
    <!-- position: fixed against viewport coordinates from coordsAtPos, so the
         menu tracks the caret without the editor needing a positioned parent. -->
    <div class="slash-menu" style="left: {slashLeft}px; top: {slashTop}px;" role="listbox" aria-label="Insert">
      {#each slashFiltered as item, i (item.key)}
        <button
          class="slash-item"
          class:active={i === slashIndex}
          role="option"
          aria-selected={i === slashIndex}
          onmouseenter={() => (slashIndex = i)}
          onmousedown={(e) => {
            // mousedown, not click: a click fires after the editor has already
            // lost focus, and the command then has no selection to act on.
            e.preventDefault();
            runSlashItem(item);
          }}
        >
          <span class="slash-label">{item.label}</span>
          <span class="slash-hint">{item.hint}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if scores.words > 0}
    <div class="readability">
      <span class="r-pill">Reading ease <strong>{scores.fleschReadingEase}</strong></span>
      <span class="r-pill">Grade <strong>{scores.fleschKincaidGrade}</strong></span>
      <span class="r-audience">{scores.audience}</span>
      <span class="r-meta">{scores.sentences} sentences · {(scores.words / Math.max(1, scores.sentences)).toFixed(1)} words/sentence</span>
    </div>
  {/if}

  {#if voiceCard}
    <VoicePanel text={plainForVoice} card={voiceCard} />
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
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--card-bg);
  }
  .toolbar {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line-strong);
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
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    transition: background 0.15s, color 0.15s;
  }
  .tool-btn:hover:not(:disabled) { background: var(--accent-tint-08); color: var(--text-primary); }
  .tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .tool-btn.active { background: var(--accent-tint-14); color: var(--accent); }
  .tool-divider { width: 1px; height: 16px; background: var(--card-border); margin: 0 4px; }
  .tool-select {
    height: 28px; padding: 0 4px;
    border: 1px solid var(--line-strong); border-radius: 4px;
    background: transparent; color: var(--text-secondary);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .tool-select:hover { background: var(--accent-tint-08); color: var(--text-primary); }
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
    font-family: var(--font-code); font-size: max(0.875em, var(--fs-label-xs));
    padding: 0.15em 0.45em; background: var(--card-bg); border: 1px solid var(--line-strong);
  }
  .rich-host :global(pre) {
    padding: 1.1em 1.4em; margin: 1.4em 0; overflow-x: auto;
    background: var(--card-bg); border: 2px solid var(--line-strong); font-size: 0.875rem;
  }
  .rich-host :global(pre code) { padding: 0; background: none; border: none; }
  .rich-host :global(blockquote) {
    border-left: 3px solid var(--accent); padding-left: 1.1em; margin: 1.3em 0;
    font-style: italic; color: var(--text-muted);
  }
  /* Tailwind's preflight strips list markers globally — restore them here. */
  .rich-host :global(ul), .rich-host :global(ol) { padding-left: 1.4em; margin-bottom: 1.1em; }
  .rich-host :global(ul) { list-style: disc; }
  .rich-host :global(ul ul) { list-style: circle; }
  .rich-host :global(ol) { list-style: decimal; }
  .rich-host :global(li) { margin-bottom: 0.4em; }
  .rich-host :global(li::marker) { color: var(--accent); }
  .rich-host :global(ol > li::marker) { font-family: var(--font-mono); }
  .rich-host :global(img) { max-width: 100%; margin: 1.2em 0; }

  .rich-host :global(figure) { margin: 1.4em 0; }
  .rich-host :global(figure img) { margin: 0; border: 1px solid var(--card-border); }
  .rich-host :global(figcaption) {
    margin-top: 0.5em; font-family: var(--font-mono); font-size: max(0.8125rem, var(--fs-label-xs));
    color: var(--text-muted);
  }
  .rich-host :global(figure.project-embed) { border: 2px solid var(--line-strong); background: var(--card-bg); }
  .rich-host :global(figure.project-embed iframe) {
    display: block; width: 100%; aspect-ratio: 16 / 10; border: 0;
    /* Inert while editing — clicks select the node instead of the embedded page. */
    pointer-events: none;
  }
  .rich-host :global(figure.project-embed figcaption) {
    margin: 0; padding: 6px 10px; border-top: 1px solid var(--line-strong);
    font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em;
  }
  .rich-host :global(.ProseMirror-selectednode) { outline: 2px solid var(--accent); outline-offset: 2px; }

  .status-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 12px; border-top: 1px solid var(--line-strong);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--text-ghost); background: var(--card-bg);
  }
  .status-left, .status-right { display: flex; align-items: center; gap: 12px; }
  .status-saving { color: var(--accent); }
  .status-saved { color: var(--success); }
  .status-error { color: var(--error); }

  .readability {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    padding: 8px 12px; border-top: 1px solid var(--line-strong);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--text-secondary); background: var(--accent-tint-04);
  }
  .r-pill {
    padding: 2px 8px; border: 1px solid var(--line-strong); border-radius: var(--radius-pill);
    text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--fs-label-xs);
  }
  .r-pill strong { color: var(--accent); margin-left: 4px; font-weight: 700; }
  .r-audience { color: var(--text-primary); font-style: italic; }
  .r-meta { color: var(--text-ghost); margin-left: auto; font-size: var(--fs-label-xs); }

  /* Margin-only display: highlight the original (will be replaced) in the
     body, hide the proposed insertion entirely (it lives in the callout). */
  :global(.sg-remove) {
    background: var(--accent-tint-25); /* warm marker-pen highlight */
    text-decoration: none;
    border-radius: var(--radius-sharp);
    padding: 0 1px;
    cursor: pointer;
    transition: background 0.2s var(--ease-out);
  }
  :global(.sg-add) {
    display: none;
  }
  /* Active state — bumped highlight when the user clicks a callout. */
  :global(.sg-remove.sg-active) {
    background: var(--accent-tint-35);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .slash-menu {
    position: fixed;
    z-index: 80;
    width: 19rem;
    max-height: 17rem;
    overflow-y: auto;
    /* Opaque. --card-bg is a 7% tint and would show the prose through the
       menu, which is the recurring overlay trap in this codebase. */
    background: var(--surface-elevated, var(--bg));
    border: 2px solid var(--line-strong);
  }

  .slash-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    width: 100%;
    padding: 0.45rem 0.7rem;
    text-align: left;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--divider);
    cursor: pointer;
  }

  .slash-item:last-child {
    border-bottom: none;
  }

  .slash-item.active {
    background: var(--accent);
  }

  .slash-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .slash-hint {
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .slash-item.active .slash-label,
  .slash-item.active .slash-hint {
    color: var(--bg);
  }
</style>
