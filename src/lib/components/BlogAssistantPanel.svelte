<script lang="ts">
  type ChatRole = 'user' | 'assistant' | 'tool';
  type ChatEntry =
    | { kind: 'user'; content: string }
    | { kind: 'assistant'; content: string }
    | { kind: 'tool'; name: string; ok: boolean; summary: string; undoToken?: string; undone?: boolean };

  type HistoryRow = { role: ChatRole; content: string };

  type Props = {
    postId: number;
    adminToken: string;
    history: HistoryRow[];
    onPostUpdated: (post: Record<string, unknown>) => void;
  };

  let { postId, adminToken, history, onPostUpdated }: Props = $props();

  function rehydrate(rows: HistoryRow[]): ChatEntry[] {
    return rows.map((r) => {
      if (r.role === 'user') return { kind: 'user', content: r.content };
      if (r.role === 'assistant') return { kind: 'assistant', content: r.content };
      try {
        const parsed = JSON.parse(r.content) as { name: string; ok: boolean; result?: unknown };
        return {
          kind: 'tool',
          name: parsed.name,
          ok: parsed.ok,
          summary: parsed.ok ? `✓ ${parsed.name}` : `✗ ${parsed.name}: ${String(parsed.result)}`,
        };
      } catch {
        return { kind: 'tool', name: 'unknown', ok: false, summary: r.content };
      }
    });
  }

  let entries = $state<ChatEntry[]>(rehydrate(history));
  let input = $state('');
  let open = $state(false);
  let busy = $state(false);
  let abortCtl: AbortController | null = null;

  function summariseToolCall(name: string, args: Record<string, unknown>): string {
    if (name === 'update_title') return `update title → "${String(args.title ?? '').slice(0, 60)}"`;
    if (name === 'update_excerpt') return 'update excerpt';
    if (name === 'update_slug') return `update slug → ${String(args.slug ?? '')}`;
    if (name === 'update_tags') return `set tags → ${(args.tags as string[] | undefined ?? []).join(', ')}`;
    if (name === 'replace_content') return 'replace post body';
    if (name === 'patch_content') return 'patch post body';
    if (name === 'set_status') return `set status → ${String(args.status ?? '')}`;
    if (name === 'set_cover_alt') return `set cover alt`;
    if (name === 'read_post') return 'read post';
    return name;
  }

  async function send() {
    if (!input.trim() || busy) return;
    const message = input.trim();
    input = '';
    busy = true;
    entries = [...entries, { kind: 'user', content: message }];
    let assistantBuf = '';
    let assistantIdx = -1;

    abortCtl = new AbortController();
    try {
      const res = await fetch(`/api/admin/blog/${postId}/assistant?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: abortCtl.signal,
      });
      if (!res.ok || !res.body) {
        entries = [...entries, { kind: 'assistant', content: `Error: ${res.status}` }];
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'text') {
            assistantBuf += ev.delta;
            if (assistantIdx === -1) {
              entries = [...entries, { kind: 'assistant', content: assistantBuf }];
              assistantIdx = entries.length - 1;
            } else {
              entries[assistantIdx] = { kind: 'assistant', content: assistantBuf };
              entries = entries;
            }
          } else if (ev.type === 'tool_call') {
            entries = [...entries, {
              kind: 'tool', name: ev.name, ok: true,
              summary: summariseToolCall(ev.name, ev.arguments),
            }];
          } else if (ev.type === 'tool_result') {
            const last = entries[entries.length - 1];
            if (last && last.kind === 'tool' && last.name === ev.name) {
              entries[entries.length - 1] = {
                ...last,
                ok: ev.ok,
                summary: ev.ok ? `✓ ${last.summary}` : `✗ ${last.summary} — ${ev.error}`,
                undoToken: ev.undoToken,
              };
              entries = entries;
            }
          } else if (ev.type === 'post_state') {
            onPostUpdated(ev.post);
          } else if (ev.type === 'error') {
            entries = [...entries, { kind: 'assistant', content: `Error: ${ev.message}` }];
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        entries = [...entries, { kind: 'assistant', content: `Error: ${(e as Error).message}` }];
      }
    } finally {
      busy = false;
      abortCtl = null;
    }
  }

  function cancel() {
    abortCtl?.abort();
    busy = false;
  }

  async function undo(idx: number) {
    const e = entries[idx];
    if (e.kind !== 'tool' || !e.undoToken) return;
    const res = await fetch(`/api/admin/blog/${postId}/assistant/undo?token=${adminToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ undoToken: e.undoToken }),
    });
    if (!res.ok) return;
    const body = await res.json();
    entries[idx] = { ...e, undone: true, undoToken: undefined };
    entries = entries;
    if (body.post) onPostUpdated(body.post);
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  }
</script>

<section class="nm-sec assistant">
  <div class="nm-sec-hd">
    <button class="toggle" onclick={() => (open = !open)}>
      <span class="sr-label-tight">Assistant</span>
      <span class="caret">{open ? '▾' : '▸'}</span>
    </button>
    <span class="nm-sec-meta">{entries.length} message{entries.length === 1 ? '' : 's'}</span>
  </div>

  {#if open}
    <div class="transcript">
      {#each entries as e, i (i)}
        {#if e.kind === 'user'}
          <div class="row user"><span class="bubble">{e.content}</span></div>
        {:else if e.kind === 'assistant'}
          <div class="row assistant-row"><span class="bubble assistant-bubble">{e.content}</span></div>
        {:else}
          <div class="row tool-row">
            <span class="tool-line" class:fail={!e.ok}>{e.summary}</span>
            {#if e.undoToken && !e.undone}
              <button class="nm-link-btn" onclick={() => undo(i)}>Undo</button>
            {:else if e.undone}
              <span class="undone">undone</span>
            {/if}
          </div>
        {/if}
      {/each}
      {#if entries.length === 0}
        <div class="nm-empty">Ask the assistant to rewrite, retitle, retag, publish, etc.</div>
      {/if}
    </div>

    <div class="composer">
      <textarea
        class="nm-textarea"
        rows="2"
        placeholder="Ask the assistant…"
        bind:value={input}
        onkeydown={onKeydown}
        disabled={busy}
      ></textarea>
      {#if busy}
        <button class="nm-btn-ghost" onclick={cancel}>Stop</button>
      {:else}
        <button class="nm-save-btn" onclick={send} disabled={!input.trim()}>Send</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .toggle {
    background: none; border: 0; cursor: pointer;
    display: flex; align-items: center; gap: 0.4rem;
    color: inherit; padding: 0;
  }
  .caret { font-family: var(--font-mono); }
  .transcript {
    display: flex; flex-direction: column; gap: 0.6rem;
    max-height: 400px; overflow-y: auto;
    padding: 0.6rem 0;
  }
  .row { display: flex; gap: 0.5rem; }
  .row.user { justify-content: flex-end; }
  .bubble {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    font-size: 0.9rem;
    max-width: 85%;
    white-space: pre-wrap;
  }
  .assistant-bubble { background: var(--accent-tint-08); }
  .tool-row {
    align-items: center;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .tool-line.fail { color: var(--danger, #c33); }
  .undone { font-size: 0.75rem; color: var(--text-ghost); }
  .composer { display: flex; gap: 0.5rem; align-items: flex-start; }
  .composer .nm-textarea { flex: 1; }
</style>
