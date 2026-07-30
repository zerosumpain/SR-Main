<!--
  ResearchChatNode — in-graph chat thread for the research-chat desk node.
  Bound to the desk's sessionId; grounds answers in the session's facts/sources
  via POST /api/deepdive/[id]/chat (SSE-over-POST). Rendered as a DIRECT flex
  child of the desk node frame (position:absolute; display:flex; row;
  overflow:hidden) — so .rc-root must be flex:1; min-height:0; no position here.

  Svelte 5 footguns honoured:
   - `reader` and `abort` are plain `let`, never $state (never read a $state
     stream handle from an $effect → effect_update_depth_exceeded).
   - messages are reassigned (messages = [...messages]) to fire reactivity.
   - scrolling happens in handlers / queueMicrotask, never an $effect that
     reads+writes messages.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import { parseSseFrames, applyFrame, type ChatMessage, type ChatSource } from './chatStream';

  let {
    sessionId,
    nodeId,
    readonly = false,
  } = $props<{
    sessionId: string;
    nodeId: string;
    readonly?: boolean;
  }>();

  let messages = $state<ChatMessage[]>([]);
  let input = $state('');
  let busy = $state(false);
  let errorText = $state<string | null>(null);
  let scrollEl: HTMLDivElement | undefined;

  // Plain lets — NOT $state. Read only inside handlers, never inside an $effect.
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let abort: AbortController | null = null;

  const SUGGESTIONS = [
    'Summarise the strongest findings in this session.',
    'What do the sources disagree about?',
    'Which claims are weakest / least supported?',
  ];

  function scrollToEnd() {
    queueMicrotask(() => scrollEl?.scrollTo({ top: scrollEl.scrollHeight }));
  }

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!question || busy || readonly) return;
    input = '';
    errorText = null;
    messages = [...messages, { role: 'user', content: question }, { role: 'assistant', content: '' }];
    const aIdx = messages.length - 1;
    busy = true;
    scrollToEnd();

    abort = new AbortController();
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          question,
          history: messages
            .slice(0, aIdx - 1)
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        messages[aIdx].content =
          res.status === 429
            ? 'Too many questions — give it a moment.'
            : `Sorry, that didn't go through (${res.status}).`;
        messages = [...messages];
        return;
      }

      reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { frames, rest } = parseSseFrames(buf);
        buf = rest;
        for (const frame of frames) {
          applyFrame(messages[aIdx], frame);
        }
        if (frames.length) {
          messages = [...messages];
          scrollEl?.scrollTo({ top: scrollEl.scrollHeight });
        }
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        messages[aIdx].content ||= 'Sorry — the connection dropped. Please try again.';
        messages = [...messages];
      }
    } finally {
      reader = null;
      abort = null;
      busy = false;
      scrollToEnd();
    }
  }

  function stop() {
    abort?.abort();
  }

  function clearChat() {
    if (busy) return;
    messages = [];
    errorText = null;
  }

  // Cancel any in-flight stream when the node unmounts (drag-delete, route change).
  onDestroy(() => {
    abort?.abort();
    reader?.cancel().catch(() => {});
  });

  function srcLabel(s: ChatSource): string {
    return s.domain || s.title || `source ${s.n}`;
  }
</script>

<div class="rc-root" data-node={nodeId}>
  <div class="rc-header">
    <span class="kind-bar"></span>
    <span class="title">Research chat</span>
    {#if busy}
      <button type="button" class="rc-stop" onclick={stop}>stop</button>
    {:else if messages.length}
      <button type="button" class="rc-clear" onclick={clearChat}>clear</button>
    {/if}
  </div>

  <div class="rc-scroll" bind:this={scrollEl}>
    {#if messages.length === 0}
      <div class="rc-intro">
        <p class="rc-lede">
          Ask about <b>this research session</b>. Answers are grounded in its facts and sources,
          with citations shown. It only answers from this session's corpus.
        </p>
        {#if !readonly}
          <div class="rc-suggest">
            {#each SUGGESTIONS as s}
              <button type="button" class="sg" onclick={() => send(s)}>{s}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#each messages as m, i (i)}
      <div class="msg {m.role}">
        <span class="role">{m.role === 'user' ? 'You' : 'Research'}</span>
        {#if m.content}
          {#if m.role === 'assistant'}
            <div class="body"><ChatMarkdown content={m.content} role="assistant" /></div>
          {:else}
            <div class="body plain">{m.content}</div>
          {/if}
        {:else if busy}
          <div class="body thinking"><span></span><span></span><span></span></div>
        {/if}
        {#if m.sources?.length}
          <div class="sources">
            <span class="src-lab">Sources</span>
            {#each m.sources as s (s.n)}
              {#if s.url}
                <a class="src" href={s.url} target="_blank" rel="noopener noreferrer"
                   title={s.title}>{s.n}. {srcLabel(s)}</a>
              {:else}
                <span class="src" title={s.title}>{s.n}. {srcLabel(s)}</span>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if !readonly}
    <form class="rc-input" onsubmit={(e) => { e.preventDefault(); send(); }}>
      <input
        type="text"
        bind:value={input}
        placeholder="Ask this session…"
        disabled={busy}
        aria-label="Ask the research session"
      />
      <button type="submit" class="ask" disabled={busy || !input.trim()}>{busy ? '…' : 'Ask'}</button>
    </form>
  {/if}
</div>

<style>
  /* Direct flex child of the desk node frame (.desk-node-host is display:flex row
     align-items:stretch): fill it vertically, stack content as a column. */
  .rc-root {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface-elevated);
    color: var(--text-primary);
    font-family: var(--font-mono);
  }
  .rc-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider);
    font-size: var(--fs-label);
    color: var(--text-muted);
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }
  .kind-bar { width: 3px; align-self: stretch; background: var(--accent); flex-shrink: 0; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rc-stop, .rc-clear {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--divider);
    border-radius: var(--radius-pill);
    padding: 0 6px;
    font: inherit;
    font-size: var(--fs-label-xs);
    cursor: pointer;
    flex-shrink: 0;
  }
  .rc-stop:hover, .rc-clear:hover { color: var(--text-primary); border-color: var(--text-muted); }

  .rc-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scrollbar-width: thin;
  }
  .rc-intro { padding: 2px; }
  .rc-lede {
    margin: 0 0 10px;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 56ch;
  }
  .rc-suggest { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .sg {
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 4px;
    padding: 6px 9px;
    cursor: pointer;
  }
  .sg:hover { border-color: var(--accent); color: var(--accent); }

  .msg { display: flex; flex-direction: column; gap: 4px; }
  .msg .role {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .msg.user .role { color: var(--accent); }
  .msg .body { font-size: var(--fs-label); line-height: 1.45; color: var(--text-primary); }
  .msg .body.plain { white-space: pre-wrap; word-break: break-word; color: var(--text-primary); }

  .thinking { display: flex; gap: 4px; padding: 4px 0; }
  .thinking span {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text-muted);
    animation: rc-bounce 1.2s infinite ease-in-out;
  }
  .thinking span:nth-child(2) { animation-delay: 0.15s; }
  .thinking span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes rc-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40% { transform: translateY(-4px); opacity: 1; }
  }

  .sources {
    display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
    margin-top: 4px; padding-top: 6px;
    border-top: 1px solid var(--divider);
  }
  .src-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted); margin-right: 2px;
  }
  .src {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 4px;
    padding: 1px 6px;
    text-decoration: none;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a.src:hover { border-color: var(--accent); color: var(--accent); }

  .rc-input {
    display: flex; gap: 8px;
    padding: 8px;
    border-top: 1px solid var(--divider);
    flex-shrink: 0;
  }
  .rc-input input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 4px;
    padding: 7px 9px;
    outline: none;
  }
  .rc-input input:focus { border-color: var(--accent); }
  .ask {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--bg);
    background: var(--accent);
    border: none;
    border-radius: 4px;
    padding: 7px 14px;
    cursor: pointer;
  }
  .ask:disabled { opacity: 0.5; cursor: default; }
</style>
