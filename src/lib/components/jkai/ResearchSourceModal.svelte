<script lang="ts">
  // Rich in-app reader for an @research source. Opened from a ResearchReferenceChips
  // chip instead of leaving the app for the raw URL. Fetches the reconstructed page
  // material from /api/research/source/[id] and renders it via marked (the stored
  // material is markdown-ish Tavily raw_content) → rich prose, with the cited passage
  // surfaced in a callout and an "open original ↗" affordance. Mirrors the shell,
  // tokens and portal behaviour of $lib/components/drive/FileViewerModal.svelte.
  import { Marked } from 'marked';
  import { sanitizePreviewHtml } from '$lib/security/sanitize-chat';

  export type ResearchSourceRef = {
    sourceId: string | null;
    sessionId: string;
    sessionTopic: string;
    sourceTitle: string | null;
    sourceUrl: string | null;
    domain: string | null;
    score: number;
    passage: string;
  };

  let { ref, onClose }: { ref: ResearchSourceRef; onClose: () => void } = $props();

  const marked = new Marked({ gfm: true, breaks: true });

  // http(s) only — the URL originates from scraped web content (see searchResearch).
  const externalUrl = $derived.by(() => {
    const s = ref.sourceUrl?.trim();
    if (!s) return null;
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
    } catch {
      return null;
    }
  });
  const title = $derived(ref.sourceTitle?.trim() || ref.domain?.trim() || ref.sessionTopic?.trim() || 'source');

  type SourceContent = { url: string; title: string | null; domain: string | null; sessionTopic: string; text: string };
  let content = $state<SourceContent | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  $effect(() => {
    const id = ref.sourceId;
    if (!id) {
      // No stored source to reconstruct (e.g. a fact with no source row) — surface
      // just the cited passage; the header link still reaches the original.
      content = null;
      loadError = null;
      loading = false;
      return;
    }
    let cancelled = false;
    loading = true;
    loadError = null;
    content = null;
    (async () => {
      try {
        const res = await fetch(`/api/research/source/${id}`);
        if (!res.ok) throw new Error(`load failed (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        content = {
          url: String(data.url ?? ''),
          title: data.title ?? null,
          domain: data.domain ?? null,
          sessionTopic: String(data.sessionTopic ?? ''),
          text: String(data.text ?? ''),
        };
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

  const renderedHtml = $derived(
    content && content.text.trim() ? sanitizePreviewHtml(marked.parse(content.text) as string) : '',
  );

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  // Portal to <body> so the overlay escapes any stacking context (SR modal-token
  // guidance — same local action FileViewerModal uses).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fv-backdrop" use:portal onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus a11y_no_static_element_interactions -->
  <div class="fv-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
    <header class="fv-hdr">
      <div class="fv-title">
        <span class="fv-name" title={title}>{title}</span>
        <span class="fv-meta">
          {ref.domain || 'research source'}{ref.sessionTopic ? ` · ${ref.sessionTopic}` : ''} · {Math.round(ref.score * 100)}% match
        </span>
      </div>
      <div class="fv-actions">
        {#if externalUrl}
          <a class="fv-btn" href={externalUrl} target="_blank" rel="noopener noreferrer" title="Open the original page">open original ↗</a>
        {/if}
        {#if ref.sessionId}
          <a class="fv-btn" href={`/deepdive/${ref.sessionId}`} target="_blank" rel="noopener noreferrer" title="Open the research session">session ↗</a>
        {/if}
        <button type="button" class="fv-btn fv-close" onclick={onClose} title="Close (Esc)" aria-label="Close">✕</button>
      </div>
    </header>

    <div class="fv-body fv-body-pad">
      {#if ref.passage?.trim()}
        <div class="fv-caption">
          <span class="fv-caption-label">cited</span>
          <span class="fv-caption-text">{ref.passage}</span>
        </div>
      {/if}

      {#if loading}
        <div class="fv-status">Loading source…</div>
      {:else if loadError}
        <div class="fv-status fv-error">Could not load this source: {loadError}</div>
      {:else if renderedHtml}
        <div class="fv-prose">{@html renderedHtml}</div>
      {:else}
        <div class="fv-status">
          <p>No stored page material for this source.</p>
          {#if externalUrl}
            <a class="fv-btn" href={externalUrl} target="_blank" rel="noopener noreferrer">Open the original ↗</a>
          {/if}
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
    width: min(920px, 100%);
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    white-space: nowrap;
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
    background: var(--bg-base, var(--bg));
  }
  .fv-body-pad {
    padding: clamp(14px, 3vw, 32px);
  }
  .fv-status {
    margin: 2em auto;
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
  .fv-caption {
    max-width: 78ch;
    margin: 0 auto 20px;
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 10px 14px;
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
  .fv-prose {
    width: 100%;
    max-width: 78ch;
    margin: 0 auto;
    font-family: var(--font-body);
    font-size: var(--fs-body);
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
  .fv-prose :global(a) { color: var(--accent); }
  .fv-prose :global(ul),
  .fv-prose :global(ol) { margin: 0.5em 0; padding-left: 1.5em; }
  .fv-prose :global(li) { margin: 0.25em 0; }
  .fv-prose :global(blockquote) {
    border-left: 3px solid var(--card-border);
    padding-left: 1em;
    margin: 0.8em 0;
    color: var(--text-secondary);
  }
  .fv-prose :global(img) { max-width: 100%; height: auto; }
  .fv-prose :global(pre) {
    background: var(--code-bg);
    color: var(--code-text);
    padding: 12px 14px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
  }
  .fv-prose :global(code) {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--surface-overlay);
    padding: 0.1em 0.35em;
  }
  .fv-prose :global(pre code) { background: none; padding: 0; }
  .fv-prose :global(table) { border-collapse: collapse; }
  .fv-prose :global(td),
  .fv-prose :global(th) { border: 1px solid var(--card-border); padding: 4px 8px; }
</style>
