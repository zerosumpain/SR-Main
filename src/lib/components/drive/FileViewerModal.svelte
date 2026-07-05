<script lang="ts">
  import { Marked } from 'marked';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  import ShikiCodeBlock from '$lib/canvas/nodes/ShikiCodeBlock.svelte';

  type ViewFile = { id: string; name: string; mimeType: string; sizeBytes?: number };

  let { file, onClose }: { file: ViewFile; onClose: () => void } = $props();

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
      loadError = null;
      loading = false;
      return;
    }
    let cancelled = false;
    loading = true;
    loadError = null;
    textContent = null;
    (async () => {
      try {
        let text: string;
        if (k === 'doc') {
          // Word/Excel: extract readable text server-side (mammoth/ExcelJS).
          const res = await fetch(`/api/files/${id}/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (!res.ok) throw new Error(`extract failed (${res.status})`);
          const data = await res.json();
          text = String(data.text ?? '');
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
        <a class="fv-btn" href={`/api/files/${file.id}/download`} download title="Download">download</a>
        <button type="button" class="fv-btn fv-close" onclick={onClose} title="Close (Esc)" aria-label="Close">✕</button>
      </div>
    </header>

    <div class="fv-body" class:fv-body-pad={kind === 'markdown' || kind === 'doc' || kind === 'unknown'}>
      {#if kind === 'image'}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <img
          class="fv-img"
          class:fv-img-zoom={imgZoom}
          src={contentUrl}
          alt={file.name}
          onclick={() => (imgZoom = !imgZoom)}
          title={imgZoom ? 'Click to fit' : 'Click to zoom'}
        />
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
    font-size: 14px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fv-meta {
    font-family: var(--font-mono);
    font-size: 10px;
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
    font-size: 10px;
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
    font-size: 12px;
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
    font-size: 12px;
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
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-primary);
  }
  .fv-prose {
    width: 100%;
    max-width: 78ch;
    margin: 0 auto;
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.7;
    color: var(--text-primary);
  }
  .fv-prose :global(h1),
  .fv-prose :global(h2),
  .fv-prose :global(h3) {
    font-family: var(--font-display);
    line-height: 1.2;
    margin: 1.2em 0 0.5em;
  }
  .fv-prose :global(h1) { font-size: 1.6em; }
  .fv-prose :global(h2) { font-size: 1.35em; }
  .fv-prose :global(h3) { font-size: 1.15em; }
  .fv-prose :global(p) { margin: 0 0 0.9em; }
  .fv-prose :global(pre) {
    background: var(--code-bg);
    color: var(--code-text);
    padding: 12px 14px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 0.85em;
  }
  .fv-prose :global(code) {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--surface-overlay);
    padding: 0.1em 0.35em;
  }
  .fv-prose :global(pre code) { background: none; padding: 0; color: inherit; }
  .fv-prose :global(a) { color: var(--accent); }
  .fv-prose :global(ul),
  .fv-prose :global(ol) { margin: 0.5em 0; padding-left: 1.5em; }
  .fv-prose :global(blockquote) {
    border-left: 3px solid var(--card-border);
    padding-left: 1em;
    margin: 0.8em 0;
    color: var(--text-secondary);
  }
  .fv-prose :global(img) { max-width: 100%; }
  .fv-prose :global(table) { border-collapse: collapse; }
  .fv-prose :global(td),
  .fv-prose :global(th) { border: 1px solid var(--card-border); padding: 4px 8px; }
</style>
