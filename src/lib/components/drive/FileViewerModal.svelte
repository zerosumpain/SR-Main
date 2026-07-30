<script lang="ts">
  import { Marked } from 'marked';
  import { untrack } from 'svelte';
  import { sanitizeChatHtml, sanitizePreviewHtml } from '$lib/security/sanitize-chat';
  import ShikiCodeBlock from '$lib/canvas/nodes/ShikiCodeBlock.svelte';

  type ViewFile = { id: string; name: string; mimeType: string; sizeBytes?: number };
  // When opened from a citation, `highlight` carries the cited chunk so the viewer
  // can jump to and mark the referenced passage (text) or surface the matched
  // caption (image). `passage` is the chunk text; char offsets are a fallback.
  type Highlight = { passage: string; charStart?: number; charEnd?: number; modality?: string };

  let { file, onClose, highlight }: { file: ViewFile; onClose: () => void; highlight?: Highlight } = $props();

  const marked = new Marked({ gfm: true, breaks: true });

  const ext = $derived((file.name.split('.').pop() ?? '').toLowerCase());
  const mime = $derived((file.mimeType || '').toLowerCase());
  const contentUrl = $derived(`/api/files/${file.id}/download?inline=1`);

  // ── Kind routing (mime first, extension fallback for octet-stream) ──────────
  const CODE_EXT: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
    json: 'json', json5: 'json', xml: 'xml', svg: 'xml', html: 'html', htm: 'html', css: 'css',
    scss: 'scss', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', sh: 'bash', bash: 'bash',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp',
    cs: 'csharp', php: 'php', sql: 'sql', svelte: 'svelte', vue: 'vue', csv: 'csv', tsv: 'text',
    txt: 'text', log: 'text', env: 'bash', conf: 'ini',
  };

  const kind = $derived.by((): 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'doc' | 'code' | 'unknown' => {
    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'].includes(ext)) return 'image';
    if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'ogv'].includes(ext)) return 'video';
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (mime === 'text/markdown' || mime === 'text/x-markdown' || ext === 'md' || ext === 'markdown') return 'markdown';
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword' ||
      ['docx', 'doc', 'odt', 'rtf'].includes(ext) ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/vnd.ms-excel' ||
      ['xlsx', 'xls'].includes(ext) ||
      mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      ['pptx', 'ppt'].includes(ext)
    )
      return 'doc';
    if (mime.startsWith('text/') || mime === 'application/json' || mime.includes('xml') || mime.includes('yaml') || ext in CODE_EXT) return 'code';
    return 'unknown';
  });

  const codeLang = $derived(CODE_EXT[ext] ?? 'text');

  // ── Content loading for text/code/markdown/doc ──────────────────────────────
  let textContent = $state<string | null>(null);
  let htmlContent = $state<string | null>(null); // rich HTML for doc kinds (docx/pptx/xlsx)
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let imgZoom = $state(false);

  $effect(() => {
    const k = kind;
    const id = file.id;
    const url = contentUrl;
    const currentExt = ext;
    if (k !== 'code' && k !== 'markdown' && k !== 'doc') {
      textContent = null;
      htmlContent = null;
      loadError = null;
      loading = false;
      return;
    }
    let cancelled = false;
    loading = true;
    loadError = null;
    textContent = null;
    htmlContent = null;
    (async () => {
      try {
        let text: string;
        if (k === 'doc') {
          // Word/PowerPoint/Excel: server-side extract returns readable `text`
          // plus a rich `html` rendering (mammoth / slide cards / tables). `preview`
          // keeps this read-only — no `.extracted.*` files written to the drive.
          const res = await fetch(`/api/files/${id}/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preview: true }),
          });
          if (!res.ok) throw new Error(`extract failed (${res.status})`);
          const data = await res.json();
          text = String(data.text ?? '');
          if (!cancelled && typeof data.html === 'string' && data.html.trim()) htmlContent = data.html;
        } else {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`load failed (${res.status})`);
          text = await res.text();
          if (currentExt === 'json' || mime === 'application/json') {
            try {
              text = JSON.stringify(JSON.parse(text), null, 2);
            } catch {
              /* leave as-is if not valid JSON */
            }
          }
        }
        if (cancelled) return;
        textContent = text;
      } catch (err) {
        if (cancelled) return;
        loadError = err instanceof Error ? err.message : String(err);
      } finally {
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const renderedMarkdown = $derived(
    kind === 'markdown' && textContent != null ? sanitizeChatHtml(marked.parse(textContent) as string) : '',
  );

  // ── Citation highlight ──────────────────────────────────────────────────────
  // The "reader" is a plain pre-wrap view that marks + scrolls to the cited
  // passage (the rich markdown/Shiki/doc DOM doesn't map cleanly to source char
  // offsets, so highlighting only works in the reader).
  let markEl = $state<HTMLElement | null>(null);

  // ── Rich vs reader ──────────────────────────────────────────────────────────
  // A rich/formatted rendering exists for docx/pptx/xlsx (mammoth HTML), markdown
  // (rendered) and code (Shiki). The viewer DEFAULTS to that rich rendering — even
  // on a citation open — with the passage-highlighting reader one click away via
  // the toggle. `userReader` is the explicit override (true = reader, false =
  // rich, null = default); it resets whenever the file changes so a toggle doesn't
  // leak across opens. A normal /drive open (no highlight) is unchanged: rich, no
  // toggle (there's no cited passage to switch to).
  const hasRichDoc = $derived(kind === 'doc' && htmlContent != null);
  const hasRichForm = $derived(
    hasRichDoc || ((kind === 'markdown' || kind === 'code') && textContent != null),
  );
  let userReader = $state<boolean | null>(null);
  const readerMode = $derived(!!highlight && hasRichForm && (userReader ?? false));
  const richView = $derived(hasRichDoc && !readerMode);
  const renderedDocHtml = $derived(hasRichDoc ? sanitizePreviewHtml(htmlContent as string) : '');
  const canToggleRich = $derived(!!highlight && hasRichForm);
  // Spreadsheets get the full modal width (many columns); docx/pptx keep the measured
  // text column. Detected from the generated markup rather than threading meta.kind.
  const isSheet = $derived(!!htmlContent && htmlContent.includes('class="xlsx-book"'));
  $effect(() => {
    file.id; // reset the explicit rich/reader choice when the viewed file changes
    untrack(() => {
      userReader = null;
    });
  });

  // Locate the cited passage in the loaded text. Anchor on a distinctive prefix
  // (robust to whitespace/offset drift between extracted and displayed text);
  // fall back to char offsets; else no highlight.
  const highlightParts = $derived.by(() => {
    if (!highlight || textContent == null) return null;
    const text = textContent;
    const passage = highlight.passage.replace(/…\s*$/, '').trim();
    if (!passage) return null;
    const anchor = passage.slice(0, 60);
    let start = text.toLowerCase().indexOf(anchor.toLowerCase());
    let end: number;
    if (start >= 0) {
      end = Math.min(start + passage.length, text.length);
    } else if (
      typeof highlight.charStart === 'number' &&
      typeof highlight.charEnd === 'number' &&
      highlight.charStart >= 0 &&
      highlight.charEnd <= text.length &&
      highlight.charEnd > highlight.charStart
    ) {
      start = highlight.charStart;
      end = highlight.charEnd;
    } else {
      return null;
    }
    return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
  });

  // Scroll the mark into view once the reader has rendered it. Read-only in the
  // effect (no state writes) — safe under Svelte 5 runes.
  $effect(() => {
    if (markEl && highlightParts) markEl.scrollIntoView({ block: 'center', behavior: 'auto' });
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  // Portal to <body> with a local append/remove action so the overlay escapes
  // any stacking context and unmounts cleanly (per SR modal-token guidance —
  // do NOT use the shared canvas portal action here).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function fmtSize(n?: number): string {
    if (!n && n !== 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fv-backdrop" use:portal onclick={onClose} role="presentation">
  <div class="fv-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={file.name}>
    <header class="fv-hdr">
      <div class="fv-title">
        <span class="fv-name" title={file.name}>{file.name}</span>
        <span class="fv-meta">{kind === 'unknown' ? mime || 'file' : kind}{file.sizeBytes ? ` · ${fmtSize(file.sizeBytes)}` : ''}</span>
      </div>
      <div class="fv-actions">
        {#if canToggleRich}
          <button
            type="button"
            class="fv-btn"
            onclick={() => (userReader = !readerMode)}
            title={readerMode ? 'Show the formatted view' : 'Show the reader with the cited passage highlighted'}
          >{readerMode ? 'rich' : 'reader'}</button>
        {/if}
        <a class="fv-btn" href={`/api/files/${file.id}/download`} download title="Download">download</a>
        <button type="button" class="fv-btn fv-close" onclick={onClose} title="Close (Esc)" aria-label="Close">✕</button>
      </div>
    </header>

    <div class="fv-body" class:fv-body-pad={richView || ((kind === 'markdown' || kind === 'doc' || kind === 'unknown') && !readerMode)}>
      {#if kind === 'image'}
        <div class="fv-image-view">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <img
            class="fv-img"
            class:fv-img-zoom={imgZoom}
            src={contentUrl}
            alt={file.name}
            onclick={() => (imgZoom = !imgZoom)}
            title={imgZoom ? 'Click to fit' : 'Click to zoom'}
          />
          {#if highlight?.passage}
            <div class="fv-caption">
              <span class="fv-caption-label">matched</span>
              <span class="fv-caption-text">{highlight.passage}</span>
            </div>
          {/if}
        </div>
      {:else if kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="fv-media" src={contentUrl} controls></video>
      {:else if kind === 'audio'}
        <audio class="fv-audio" src={contentUrl} controls></audio>
      {:else if kind === 'pdf'}
        <iframe class="fv-frame" src={contentUrl} title={file.name}></iframe>
      {:else if loading}
        <div class="fv-status">Loading…</div>
      {:else if loadError}
        <div class="fv-status fv-error">Could not open this file: {loadError}</div>
      {:else if richView}
        <!-- Rich formatted rendering for docx (mammoth), pptx (slide cards) and
             xlsx (tables). Sanitised with the preview profile (allows inline
             document images). -->
        <div class="fv-prose fv-rich" class:fv-wide={isSheet}>{@html renderedDocHtml}</div>
      {:else if readerMode && textContent != null}
        <!-- Citation reader: plain pre-wrap text with the cited passage marked +
             scrolled into view. Reliable across doc/markdown/code source. -->
        <div class="fv-reader">
          {#if highlightParts}{highlightParts.before}<mark class="fv-mark" bind:this={markEl}>{highlightParts.match}</mark>{highlightParts.after}{:else}{textContent}{/if}
        </div>
      {:else if kind === 'markdown'}
        <div class="fv-prose">{@html renderedMarkdown}</div>
      {:else if kind === 'doc'}
        <div class="fv-doc">{textContent}</div>
      {:else if kind === 'code' && textContent != null}
        <div class="fv-code">
          <ShikiCodeBlock content={textContent} lang={codeLang} collapsedLines={0} />
        </div>
      {:else}
        <div class="fv-status">
          <p>No inline preview for this file type.</p>
          <a class="fv-btn" href={`/api/files/${file.id}/download`} download>Download instead</a>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .fv-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(8px, 3vw, 40px);
    background: color-mix(in srgb, var(--text-primary) 55%, transparent);
    backdrop-filter: blur(2px);
  }
  .fv-modal {
    display: flex;
    flex-direction: column;
    width: min(1100px, 100%);
    height: min(88vh, 100%);
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-md, 4px);
    overflow: hidden;
  }
  .fv-hdr {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--card-border);
    background: var(--bg);
  }
  .fv-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .fv-name {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fv-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .fv-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fv-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 5px 10px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-secondary);
    cursor: pointer;
    text-decoration: none;
    line-height: 1.4;
  }
  .fv-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .fv-close {
    font-size: var(--fs-label);
    padding: 4px 9px;
  }
  .fv-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    background: var(--bg-base, var(--bg));
  }
  .fv-body-pad {
    padding: clamp(14px, 3vw, 32px);
  }
  .fv-img {
    margin: auto;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    cursor: zoom-in;
  }
  .fv-img-zoom {
    max-width: none;
    max-height: none;
    cursor: zoom-out;
  }
  .fv-media {
    margin: auto;
    max-width: 100%;
    max-height: 100%;
  }
  .fv-audio {
    margin: auto;
    width: min(560px, 90%);
  }
  .fv-frame {
    flex: 1;
    width: 100%;
    height: 100%;
    border: 0;
    background: #fff;
  }
  .fv-code {
    width: 100%;
    align-self: flex-start;
  }
  .fv-status {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .fv-error {
    color: var(--error);
  }
  .fv-doc {
    width: 100%;
    max-width: 78ch;
    margin: 0 auto;
    white-space: pre-wrap;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.7;
    color: var(--text-primary);
  }
  .fv-prose {
    width: 100%;
    max-width: 80ch;
    margin: 0 auto;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: 1.72;
    color: var(--text-primary);
  }
  /* Spreadsheets use the full modal width (many columns); prose text stays measured. */
  .fv-prose.fv-wide { max-width: 100%; }
  .fv-prose > :global(:first-child) { margin-top: 0; }
  .fv-prose :global(h1),
  .fv-prose :global(h2),
  .fv-prose :global(h3),
  .fv-prose :global(h4) {
    font-family: var(--font-display);
    line-height: 1.18;
    margin: 1.5em 0 0.55em;
  }
  .fv-prose :global(h1) { font-size: 1.5em; }
  .fv-prose :global(h2) { font-size: 1.28em; }
  .fv-prose :global(h3) { font-size: 1.12em; }
  .fv-prose :global(h4) { font-size: 1em; }
  .fv-prose :global(p) { margin: 0 0 0.95em; }
  .fv-prose :global(a) { color: var(--accent); text-underline-offset: 2px; }
  .fv-prose :global(ul),
  .fv-prose :global(ol) { margin: 0.5em 0 1em; padding-left: 1.4em; }
  .fv-prose :global(li) { margin: 0.3em 0; }
  .fv-prose :global(blockquote) {
    border-left: 3px solid var(--accent-tint-35, var(--card-border));
    padding: 0.1em 0 0.1em 1em;
    margin: 1em 0;
    color: var(--text-secondary);
  }
  .fv-prose :global(hr) { border: 0; border-top: 1px solid var(--divider); margin: 1.6em 0; }
  .fv-prose :global(img) { max-width: 100%; height: auto; border-radius: 2px; margin: 0.4em 0; }
  .fv-prose :global(code) {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--surface-overlay);
    padding: 0.1em 0.35em;
    border-radius: 2px;
  }
  .fv-prose :global(pre) {
    background: var(--code-bg);
    color: var(--code-text);
    padding: 12px 14px;
    overflow-x: auto;
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
  }
  .fv-prose :global(pre code) { background: none; padding: 0; color: inherit; }

  /* ── Tables: compact cells, header row, row rules, numeric right-align ── */
  .fv-prose :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 1.1em 0 1.6em;
    font-size: max(0.92em, var(--fs-label-xs));
    font-variant-numeric: tabular-nums;
  }
  .fv-prose :global(th),
  .fv-prose :global(td) {
    padding: 7px 12px;
    border: 0;
    border-bottom: 1px solid var(--divider);
    text-align: left;
    vertical-align: top;
  }
  .fv-prose :global(td > p),
  .fv-prose :global(th > p) { margin: 0; }
  .fv-prose :global(td > p + p),
  .fv-prose :global(th > p + p) { margin-top: 0.35em; }
  .fv-prose :global(.num) { text-align: right; white-space: nowrap; }
  /* Word tables carry no <thead>; style their bold first row as the header. */
  .fv-prose :global(table:not(:has(thead)) tr:first-child td) {
    background: var(--surface-overlay);
    border-bottom: 2px solid var(--card-border);
    font-weight: 600;
    color: var(--text-secondary);
  }

  /* ── Rich doc: PowerPoint slide cards ── */
  .fv-rich :global(.pptx-deck) {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .fv-rich :global(.pptx-slide) {
    border: 1px solid var(--card-border);
    border-radius: var(--radius-md, 4px);
    background: var(--surface-overlay);
    padding: 20px 22px;
  }
  .fv-rich :global(.pptx-slide-no) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    margin-bottom: 10px;
  }
  .fv-rich :global(.pptx-title) {
    font-family: var(--font-display);
    font-size: 1.3em;
    line-height: 1.2;
    margin: 0 0 0.6em;
  }
  .fv-rich :global(.pptx-body) { margin: 0; padding-left: 1.2em; }
  .fv-rich :global(.pptx-body li) { margin: 0.35em 0; }
  .fv-rich :global(.pptx-notes) {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed var(--card-border);
    color: var(--text-secondary);
    font-size: max(0.9em, var(--fs-label-xs));
  }
  .fv-rich :global(.pptx-notes-label) {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    margin-bottom: 5px;
  }
  .fv-rich :global(.pptx-notes p) { margin: 0.2em 0; }

  /* ── Rich doc: Excel sheets ── */
  .fv-rich :global(.xlsx-book) {
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .fv-rich :global(.xlsx-sheet-name) {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    margin: 0 0 10px;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--card-border);
  }
  .fv-rich :global(.xlsx-scroll) {
    overflow-x: auto;
    border: 1px solid var(--divider);
    border-radius: 2px;
  }
  .fv-rich :global(.xlsx-sheet table) { font-size: max(0.85em, var(--fs-label-xs)); min-width: 100%; margin: 0; }
  .fv-rich :global(.xlsx-sheet thead th) {
    background: var(--surface-elevated);
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    border-bottom: 2px solid var(--card-border);
  }
  .fv-rich :global(.xlsx-sheet tbody tr:nth-child(even) td) { background: var(--surface-overlay); }
  .fv-rich :global(.xlsx-sheet td),
  .fv-rich :global(.xlsx-sheet th) { white-space: nowrap; }

  /* ── Citation views ── */
  .fv-image-view {
    margin: auto;
    min-height: 0;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: clamp(8px, 2vw, 20px);
  }
  .fv-caption {
    max-width: min(760px, 100%);
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 8px 12px;
    background: var(--surface-overlay);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--accent);
    font-family: var(--font-body);
    font-size: var(--fs-nav);
    line-height: 1.6;
    color: var(--text-primary);
  }
  .fv-caption-label {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    padding-top: 2px;
  }
  .fv-reader {
    width: 100%;
    max-width: 82ch;
    margin: 0 auto;
    padding: clamp(14px, 3vw, 32px);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.75;
    color: var(--text-primary);
  }
  .fv-mark {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: var(--text-primary);
    border-radius: 2px;
    padding: 1px 2px;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
    scroll-margin: 40vh;
  }
</style>
