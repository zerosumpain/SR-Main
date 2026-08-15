<script lang="ts">
  // AskModel — the project-bound retrieval chat. Adapted from data-spine/components/AskModel.svelte.
  // Self-contained: posts to ./ask, streams SSE, shows the passages it used.
  //
  // This component is the demonstration the /memory section points at: retrieval over a
  // local corpus, ranked, streamed, with provenance kept all the way to the answer.
  import { onMount } from 'svelte';

  interface Source { n: number; title: string; sourceType: string; url: string | null }
  interface Msg { role: 'user' | 'assistant'; content: string; sources?: Source[] }

  const STORE_KEY = 'er-askmodel-v1';
  let messages = $state<Msg[]>([]);
  let input = $state('');
  let busy = $state(false);
  let scrollEl: HTMLDivElement | undefined;

  const SUGGESTIONS = [
    'Where does the money actually go in an AI system like this?',
    'What is the system allowed to change about itself without asking?',
    'Why is the cheapest seller of a model usually the wrong one?',
    'How does it decide two records are the same person?',
    'Which guardrails exist because something went wrong?',
  ];

  // Hydrate once in onMount — NOT an $effect (an effect reading + writing `messages` loops).
  onMount(() => {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s) { const parsed = JSON.parse(s); if (Array.isArray(parsed) && parsed.length) messages = parsed; }
    } catch { /* ignore */ }
  });
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-20))); } catch { /* ignore */ }
  }

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    input = '';
    messages = [...messages, { role: 'user', content: question }, { role: 'assistant', content: '' }];
    const aIdx = messages.length - 1;
    busy = true;
    queueMicrotask(() => scrollEl?.scrollTo({ top: scrollEl.scrollHeight }));

    try {
      const res = await fetch('/projects/engine-room/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: messages.slice(0, aIdx - 1).slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) {
        const txt = res.status === 429 ? 'Too many questions — give it a moment.' : `Sorry, that didn't go through (${res.status}).`;
        messages[aIdx].content = txt; messages = [...messages]; return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const f of frames) {
          const line = f.trim();
          if (!line.startsWith('data:')) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === 'sources') messages[aIdx].sources = evt.sources;
          else if (evt.type === 'token') messages[aIdx].content += evt.token;
          else if (evt.type === 'error') messages[aIdx].content += `\n\n_(${evt.message})_`;
          messages = [...messages];
          scrollEl?.scrollTo({ top: scrollEl.scrollHeight });
        }
      }
    } catch {
      messages[aIdx].content ||= 'Sorry — the connection dropped. Please try again.';
      messages = [...messages];
    } finally {
      busy = false;
      persist();
    }
  }

  function clearChat() { messages = []; persist(); }

  // minimal, XSS-safe markdown → HTML (escape FIRST, then a tiny subset + [n] citation chips).
  // The order is the whole safety property: escaping after formatting is not escaping.
  function md(s: string): string {
    let h = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2" rel="noopener">$1</a>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    h = h.replace(/\[(\d+)\]/g, '<sup class="cite">$1</sup>');
    h = h.replace(/^\s*[-•]\s+(.*)$/gm, '<li>$1</li>');
    h = h.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    h = h.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    return `<p>${h}</p>`;
  }
</script>

<div class="am">
  <div class="am-scroll" bind:this={scrollEl}>
    {#if messages.length === 0}
      <div class="am-intro">
        <p class="am-lede">Ask about <b>how this system works</b> — the models, the caching, the tools, the memory, the
          automation, the safety rails. Answers are grounded in this study's own corpus, with the passages used shown
          underneath. It only answers about this project.</p>
        <p class="am-meta">This dock <i>is</i> the thing the study describes: a lexical index over the study's content,
          ranked, streamed, with provenance kept to the answer. Deliberately not a vector index — at this corpus size
          the simpler tool is the better one, which the Memory section argues at more length.</p>
        <div class="am-suggest">
          {#each SUGGESTIONS as s}<button class="sg" onclick={() => send(s)}>{s}</button>{/each}
        </div>
      </div>
    {/if}
    {#each messages as m (m)}
      <div class="msg {m.role}">
        <span class="role">{m.role === 'user' ? 'You' : 'The system'}</span>
        {#if m.content}
          <div class="body">{@html md(m.content)}</div>
        {:else if busy}
          <div class="body thinking"><span></span><span></span><span></span></div>
        {/if}
        {#if m.sources?.length}
          <div class="sources">
            <span class="src-lab">Passages used</span>
            {#each m.sources as s}
              {#if s.url}
                <a class="src" data-t={s.sourceType} href={s.url}>{s.n}. {s.title}</a>
              {:else}
                <span class="src" data-t={s.sourceType}>{s.n}. {s.title}</span>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <form class="am-input" onsubmit={(e) => { e.preventDefault(); send(); }}>
    <input type="text" bind:value={input} placeholder="Ask about models, caching, memory, safety…"
           disabled={busy} aria-label="Ask the system" />
    <button type="submit" class="ask" disabled={busy || !input.trim()}>{busy ? '…' : 'Ask'}</button>
  </form>
  <div class="am-foot">
    <span>Grounded in the study's corpus · cites passages · no secrets, by construction</span>
    {#if messages.length}<button class="clear" onclick={clearChat}>clear</button>{/if}
  </div>
</div>

<style>
  .am { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .am-scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 2px 2px 8px; display: flex; flex-direction: column; gap: 12px; }
  .am-intro { padding: 4px 2px; }
  .am-lede { margin: 0 0 8px; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.75); max-width: 62ch; }
  .am-meta { margin: 0 0 12px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.55); max-width: 62ch;
    padding: 7px 10px; border-left: 2px solid var(--accent-ink); background: var(--accent-ink-tint-12);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; }
  .am-suggest { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .sg { text-align: left; font-family: var(--font-body); font-size: var(--fs-label); color: var(--text-primary);
    background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-sharp);
    padding: 7px 11px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .sg:hover { background: var(--accent-ink-tint-12); border-color: var(--accent-ink-tint-35); }

  .msg { display: flex; flex-direction: column; gap: 4px; }
  .msg .role { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .msg.user .role { color: #b4632e; }
  .msg .body { font-size: var(--fs-label); line-height: 1.6; color: var(--text-primary); }
  .msg.user .body { color: rgba(28,22,17,0.85); }
  .msg .body :global(p) { margin: 0 0 8px; }
  .msg .body :global(p:last-child) { margin-bottom: 0; }
  .msg .body :global(ul) { margin: 4px 0; padding-left: 18px; }
  .msg .body :global(li) { margin-bottom: 2px; }
  .msg .body :global(code) { font-family: var(--font-mono); font-size: var(--fs-label-xs); background: rgba(28,22,17,0.06); padding: 1px 4px; border-radius: var(--radius-sharp); }
  .msg .body :global(a) { color: var(--accent-ink); }
  .msg .body :global(sup.cite) { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-sharp); padding: 0 3px; margin: 0 1px; }
  .thinking { display: flex; gap: 4px; padding: 4px 0; }
  .thinking span { width: 6px; height: 6px; border-radius: var(--radius-pill); background: rgba(28,22,17,0.3); animation: bounce 1.2s infinite ease-in-out; }
  .thinking span:nth-child(2) { animation-delay: 0.15s; }
  .thinking span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-4px); opacity: 1; } }

  .sources { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(28,22,17,0.08); }
  .src-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.4); margin-right: 2px; }
  .src { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.65); background: rgba(28,22,17,0.04); border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); padding: 1px 6px; text-decoration: none; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src:hover { background: rgba(28,22,17,0.09); }
  .src[data-t='guardrails'] { border-color: rgba(138,45,58,0.4); color: #8a2d3a; }
  .src[data-t='models'], .src[data-t='tools'] { border-color: var(--accent-ink-tint-35); color: var(--accent-ink); }
  .src[data-t='building'], .src[data-t='shipping'] { border-color: rgba(196,87,10,0.4); color: #b4632e; }

  .am-input { display: flex; gap: 8px; margin-top: 10px; }
  .am-input input { flex: 1; font-family: var(--font-body); font-size: var(--fs-label); color: var(--text-primary); background: rgba(255,255,255,0.7); border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-sharp); padding: 9px 12px; outline: none; }
  .am-input input:focus { border-color: var(--accent-ink); }
  .ask { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--bg); background: var(--accent-ink); border: none; border-radius: var(--radius-sharp); padding: 9px 18px; cursor: pointer; }
  .ask:disabled { opacity: 0.5; cursor: default; }
  .am-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
  .am-foot span { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.4); }
  .clear { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); background: none; border: none; border-bottom: 1px dashed currentColor; cursor: pointer; padding: 0; }
</style>
