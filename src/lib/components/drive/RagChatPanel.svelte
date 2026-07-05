<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Marked } from 'marked';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  import ModelPicker from '$lib/components/jkai/ModelPicker.svelte';
  import { DEFAULT_GLM_MODEL_ID } from '$lib/constants/glm-models';
  import type { ModelContext } from '$lib/server/models/types';
  import type { RagCollection } from '$lib/db/schema';

  type Citation = { n: number; source: string; ord: number };
  type ChatMsg = { role: 'user' | 'assistant'; content: string; citations?: Citation[]; streaming?: boolean };

  let { collection: initial, onClose, onChanged }: {
    collection: RagCollection;
    onClose: () => void;
    onChanged?: (c: RagCollection) => void;
  } = $props();

  const marked = new Marked({ gfm: true, breaks: true });

  let collection = $state<RagCollection>(initial);
  let messages = $state<ChatMsg[]>([]);
  let input = $state('');
  let sending = $state(false);
  let loadError = $state<string | null>(null);

  // Generation model for the chat (separate from the collection's embedding
  // model). Defaults to the site GLM chat model; the choice persists locally.
  let chatModel = $state<ModelContext>({ provider: 'zai', modelId: DEFAULT_GLM_MODEL_ID });
  const MODEL_KEY = 'drive:rag:chatModel';
  let modelLoaded = false;

  // Non-reactive handles (never $state — see svelte5-pitfalls §1).
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;
  let scrollEl: HTMLElement | null = null;
  let disposed = false;

  const ready = $derived(collection.status === 'ready');
  const indexing = $derived(collection.status === 'pending' || collection.status === 'indexing');

  function render(md: string): string {
    return sanitizeChatHtml(marked.parse(md) as string);
  }

  async function scrollToBottom() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  async function loadDetail() {
    try {
      const res = await fetch(`/api/files/rag/${collection.id}`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const data = await res.json();
      collection = data.collection;
      onChanged?.(data.collection);
      messages = (data.messages ?? []).map((m: { role: 'user' | 'assistant'; content: string; citations?: Citation[] }) => ({
        role: m.role,
        content: m.content,
        citations: m.citations ?? [],
      }));
      await scrollToBottom();
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  function schedulePoll() {
    if (disposed) return;
    pollTimer = setTimeout(async () => {
      if (disposed) return;
      try {
        const res = await fetch(`/api/files/rag/${collection.id}`);
        if (res.ok) {
          const data = await res.json();
          collection = data.collection;
          onChanged?.(data.collection);
        }
      } catch {
        /* transient — keep polling */
      }
      if (collection.status === 'pending' || collection.status === 'indexing') schedulePoll();
    }, 1800);
  }

  onMount(() => {
    try {
      const saved = localStorage.getItem(MODEL_KEY);
      if (saved) {
        const m = JSON.parse(saved);
        if (m && (m.provider === 'zai' || m.provider === 'openrouter') && typeof m.modelId === 'string') {
          chatModel = m;
        }
      }
    } catch { /* ignore */ }
    modelLoaded = true;
    loadDetail();
    if (initial.status === 'pending' || initial.status === 'indexing') schedulePoll();
    return () => {
      disposed = true;
      if (pollTimer) clearTimeout(pollTimer);
      abort?.abort();
    };
  });

  // Persist the model choice once loaded (guard avoids clobbering the saved
  // value with the default on the first effect run before onMount reads it).
  $effect(() => {
    const m = chatModel;
    if (!modelLoaded) return;
    try { localStorage.setItem(MODEL_KEY, JSON.stringify(m)); } catch { /* ignore */ }
  });

  async function send() {
    const question = input.trim();
    if (!question || sending || !ready) return;
    input = '';
    sending = true;
    messages = [...messages, { role: 'user', content: question }];
    const assistantIdx = messages.length;
    messages = [...messages, { role: 'assistant', content: '', streaming: true, citations: [] }];
    await scrollToBottom();

    abort = new AbortController();
    try {
      const res = await fetch(`/api/files/rag/${collection.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, model: chatModel }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.error || `chat failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const evt of events) {
          const line = evt.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let payload: { type: string; token?: string; citations?: Citation[]; message?: string };
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (payload.type === 'token' && payload.token) {
            acc += payload.token;
            messages[assistantIdx] = { ...messages[assistantIdx], content: acc };
            await scrollToBottom();
          } else if (payload.type === 'done') {
            messages[assistantIdx] = {
              role: 'assistant',
              content: acc || '…',
              citations: payload.citations ?? [],
              streaming: false,
            };
          } else if (payload.type === 'error') {
            messages[assistantIdx] = {
              role: 'assistant',
              content: acc + `\n\n_⚠ ${payload.message ?? 'generation failed'}_`,
              streaming: false,
            };
          }
        }
      }
      messages[assistantIdx] = { ...messages[assistantIdx], streaming: false };
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        messages[assistantIdx] = {
          role: 'assistant',
          content: `_⚠ ${(err as Error).message}_`,
          streaming: false,
        };
      }
    } finally {
      sending = false;
      abort = null;
      await scrollToBottom();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function reindex() {
    await fetch(`/api/files/rag/${collection.id}/reindex`, { method: 'POST' });
    collection = { ...collection, status: 'indexing' };
    schedulePoll();
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !sending && onClose()} />

<div class="rc-backdrop" use:portal onclick={onClose} role="presentation">
  <aside class="rc-panel" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Chat with documents">
    <header class="rc-hdr">
      <div class="rc-hdr-main">
        <span class="rc-kicker">Interact using model</span>
        <h2 class="rc-title" title={collection.name}>{collection.name}</h2>
      </div>
      <button type="button" class="rc-x" onclick={onClose} aria-label="Close">✕</button>
    </header>

    <div class="rc-filebar" title={(collection.fileNames ?? []).join(', ')}>
      {#each (collection.fileNames ?? []).slice(0, 6) as fn}
        <span class="rc-chip">{(fn.split('/').pop() ?? fn)}</span>
      {/each}
      {#if (collection.fileNames ?? []).length > 6}
        <span class="rc-chip rc-chip-more">+{(collection.fileNames ?? []).length - 6}</span>
      {/if}
      {#if collection.embeddingModel}
        <span class="rc-model">{collection.embeddingModel.replace('openai/', '')}{collection.chunkCount ? ` · ${collection.chunkCount} chunks` : ''}</span>
      {/if}
    </div>

    <div class="rc-scroll" bind:this={scrollEl}>
      {#if indexing}
        <div class="rc-state">
          <div class="rc-spinner" aria-hidden="true"></div>
          <p class="rc-state-t">Building the index…</p>
          <p class="rc-state-s">Reading, chunking and embedding your files. This can take a moment.</p>
        </div>
      {:else if collection.status === 'error'}
        <div class="rc-state rc-state-err">
          <p class="rc-state-t">Indexing failed</p>
          <p class="rc-state-s">{collection.error ?? 'Unknown error'}</p>
          <button type="button" class="rc-retry" onclick={reindex}>Retry indexing</button>
        </div>
      {:else if loadError}
        <div class="rc-state rc-state-err"><p class="rc-state-s">{loadError}</p></div>
      {:else if messages.length === 0}
        <div class="rc-empty">
          <p class="rc-empty-t">Ask anything about these {(collection.fileNames ?? []).length} file{(collection.fileNames ?? []).length === 1 ? '' : 's'}.</p>
          <p class="rc-empty-s">Answers are grounded in the documents and cite their sources.</p>
        </div>
      {:else}
        {#each messages as m}
          <div class="rc-msg" class:rc-user={m.role === 'user'}>
            {#if m.role === 'user'}
              <p class="rc-user-bubble">{m.content}</p>
            {:else}
              <div class="rc-assistant">
                <div class="rc-md">{@html render(m.content || (m.streaming ? '…' : ''))}</div>
                {#if m.citations && m.citations.length}
                  <div class="rc-cites">
                    {#each m.citations as c}
                      <span class="rc-cite" title={c.source}>[{c.n}] {c.source.split('/').pop()}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <div class="rc-modelrow">
      <span class="rc-modellabel">Model</span>
      <div class="rc-modelpicker">
        <ModelPicker bind:value={chatModel} label="" />
      </div>
    </div>
    <div class="rc-composer">
      <textarea
        class="rc-input"
        placeholder={ready ? 'Ask about your documents…' : 'Waiting for the index…'}
        bind:value={input}
        onkeydown={onKeydown}
        disabled={!ready || sending}
        rows="2"
      ></textarea>
      <button type="button" class="rc-send" onclick={send} disabled={!ready || sending || !input.trim()}>
        {sending ? '…' : 'Send'}
      </button>
    </div>
  </aside>
</div>

<style>
  .rc-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    justify-content: flex-end;
    background: color-mix(in srgb, var(--text-primary) 40%, transparent);
    backdrop-filter: blur(2px);
  }
  .rc-panel {
    display: flex;
    flex-direction: column;
    width: min(560px, 100%);
    height: 100%;
    background: var(--surface-elevated);
    border-left: 1px solid var(--card-border);
    animation: rc-slide 180ms ease;
  }
  @keyframes rc-slide {
    from { transform: translateX(24px); opacity: 0.6; }
    to { transform: translateX(0); opacity: 1; }
  }
  .rc-hdr {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--card-border);
  }
  .rc-hdr-main { flex: 1; min-width: 0; }
  .rc-kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .rc-title {
    font-family: var(--font-display);
    font-size: 19px;
    line-height: 1.2;
    color: var(--text-primary);
    margin: 3px 0 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rc-x {
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px 9px;
    font-size: 12px;
    line-height: 1;
  }
  .rc-x:hover { color: var(--accent); border-color: var(--accent); }
  .rc-filebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--divider, var(--card-border));
  }
  .rc-chip {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 7px;
    background: var(--accent-tint-08, color-mix(in srgb, var(--accent) 8%, transparent));
    color: var(--text-secondary);
    border-radius: var(--radius-round, 100px);
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rc-chip-more { background: transparent; color: var(--text-ghost); }
  .rc-model {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .rc-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .rc-state, .rc-empty {
    margin: auto;
    text-align: center;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .rc-state-t, .rc-empty-t {
    font-family: var(--font-body);
    font-size: 15px;
    color: var(--text-primary);
    margin: 0;
  }
  .rc-state-s, .rc-empty-s {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-muted);
    margin: 0;
  }
  .rc-state-err .rc-state-t { color: var(--error); }
  .rc-retry {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 14px;
    border: 1px solid var(--accent);
    background: var(--bg);
    color: var(--accent);
    cursor: pointer;
  }
  .rc-spinner {
    width: 26px;
    height: 26px;
    border: 2px solid var(--card-border);
    border-top-color: var(--accent);
    border-radius: 100px;
    animation: rc-spin 0.8s linear infinite;
  }
  @keyframes rc-spin { to { transform: rotate(360deg); } }
  .rc-msg { display: flex; flex-direction: column; }
  .rc-user { align-items: flex-end; }
  .rc-user-bubble {
    max-width: 85%;
    margin: 0;
    padding: 8px 12px;
    background: var(--accent);
    color: #fff;
    border-radius: var(--radius-round, 14px);
    font-size: 14px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .rc-assistant { width: 100%; }
  .rc-md {
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-primary);
  }
  .rc-md :global(p) { margin: 0 0 0.6em; }
  .rc-md :global(p:last-child) { margin-bottom: 0; }
  .rc-md :global(pre) {
    background: var(--code-bg);
    color: var(--code-text);
    padding: 10px 12px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 0.82em;
  }
  .rc-md :global(code) {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--surface-overlay);
    padding: 0.1em 0.35em;
  }
  .rc-md :global(pre code) { background: none; padding: 0; color: inherit; }
  .rc-md :global(ul), .rc-md :global(ol) { margin: 0.3em 0; padding-left: 1.4em; }
  .rc-md :global(a) { color: var(--accent); text-decoration: underline; }
  .rc-md :global(blockquote) {
    border-left: 3px solid var(--card-border);
    padding-left: 0.8em;
    color: var(--text-secondary);
  }
  .rc-cites {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dotted var(--card-border);
  }
  .rc-cite {
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 2px 7px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    max-width: 200px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rc-modelrow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 0;
    background: var(--bg);
    border-top: 1px solid var(--card-border);
    padding-top: 10px;
  }
  .rc-modellabel {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    flex-shrink: 0;
  }
  .rc-modelpicker {
    flex: 1;
    min-width: 0;
  }
  /* ModelPicker renders <label><select> — flatten and skin the select to match. */
  .rc-modelpicker :global(label) {
    gap: 0;
  }
  .rc-modelpicker :global(select) {
    width: 100%;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    color: var(--text-secondary);
    border-radius: var(--radius-sharp, 2px);
    cursor: pointer;
  }
  .rc-modelpicker :global(select):focus {
    outline: none;
    border-color: var(--accent);
  }
  .rc-composer {
    display: flex;
    gap: 8px;
    padding: 8px 14px 12px;
    background: var(--bg);
  }
  .rc-input {
    flex: 1;
    resize: none;
    font-family: var(--font-body);
    font-size: 14px;
    padding: 8px 10px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    border-radius: var(--radius-sharp, 2px);
  }
  .rc-input:focus { outline: none; border-color: var(--accent); }
  .rc-input:disabled { opacity: 0.5; }
  .rc-send {
    align-self: flex-end;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 9px 16px;
    background: var(--accent);
    color: #fff;
    border: 1px solid var(--accent);
    cursor: pointer;
  }
  .rc-send:disabled { opacity: 0.45; cursor: default; }
  .rc-send:not(:disabled):hover { background: var(--accent-hover, var(--accent)); }
</style>
