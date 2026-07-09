<script lang="ts">
  // AskModel — the project-bound RAG chat (adapted from policy-engine). Self-contained:
  // posts to ./chat, streams SSE, shows sources. Conversation is ephemeral (localStorage).
  import { onMount } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import { PERSONAS } from '../lib/personas';

  interface Source { n: number; title: string; sourceType: string; url: string | null }
  interface Msg { role: 'user' | 'assistant'; content: string; sources?: Source[] }

  const STORE_KEY = 'ds-askmodel-v1';
  let messages = $state<Msg[]>([]);
  let input = $state('');
  let busy = $state(false);
  let scrollEl: HTMLDivElement | undefined;

  const SUGGESTIONS = [
    'What exactly has the DfE committed to, and what is still undecided?',
    'How is the data spine different from the consistent identifier?',
    'Why did ContactPoint fail, and what survived it?',
    'What would make a MAT support the spine — and what would turn them against it?',
    'Which privacy techniques would answer the trust deficit?',
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

  // The user's current lens, so the model can answer in-persona when one is selected.
  function lensSnapshot(): string {
    if (!app.persona) return '';
    const p = PERSONAS.find((x) => x.id === app.persona);
    return p ? `The user is currently reading through the "${p.label}" lens (${p.who})` : '';
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
      const res = await fetch('/projects/data-spine/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          lens: lensSnapshot(),
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

  // minimal, XSS-safe markdown → HTML (escape first, then a tiny subset + [n] citation chips)
  function md(s: string): string {
    let h = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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
        <p class="am-lede">Ask anything about <b>this project</b> — what the spine is, the precedents, the personas, the value ledger or the governance design. Answers are grounded in the project's own research corpus, with sources shown. It only answers about this project.</p>
        <div class="am-suggest">
          {#each SUGGESTIONS as s}<button class="sg" onclick={() => send(s)}>{s}</button>{/each}
        </div>
      </div>
    {/if}
    {#each messages as m (m)}
      <div class="msg {m.role}">
        <span class="role">{m.role === 'user' ? 'You' : 'The project'}</span>
        {#if m.content}
          <div class="body">{@html md(m.content)}</div>
        {:else if busy}
          <div class="body thinking"><span></span><span></span><span></span></div>
        {/if}
        {#if m.sources?.length}
          <div class="sources">
            <span class="src-lab">Sources</span>
            {#each m.sources as s}
              {#if s.url}
                <a class="src" data-t={s.sourceType} href={s.url} target="_blank" rel="noopener">{s.n}. {s.title} ↗</a>
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
    <input type="text" bind:value={input} placeholder="Ask about the spine, precedents, personas or governance…"
           disabled={busy} aria-label="Ask the project" />
    <button type="submit" class="ask" disabled={busy || !input.trim()}>{busy ? '…' : 'Ask'}</button>
  </form>
  <div class="am-foot">
    <span>Grounded in the project corpus · cites sources · project-scoped only</span>
    {#if messages.length}<button class="clear" onclick={clearChat}>clear</button>{/if}
  </div>
</div>

<style>
  .am { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .am-scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 2px 2px 8px; display: flex; flex-direction: column; gap: 12px; }
  .am-intro { padding: 4px 2px; }
  .am-lede { margin: 0 0 12px; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.75); max-width: 62ch; }
  .am-suggest { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .sg { text-align: left; font-family: 'DM Sans', system-ui, sans-serif; font-size: 12.5px; color: var(--ink); background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); padding: 7px 11px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .sg:hover { background: var(--accent-ink-tint-12); border-color: var(--accent-ink-tint-35); }

  .msg { display: flex; flex-direction: column; gap: 4px; }
  .msg .role { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .msg.user .role { color: #b4632e; }
  .msg .body { font-size: 13.5px; line-height: 1.6; color: var(--ink); }
  .msg.user .body { color: rgba(28,22,17,0.85); }
  .msg .body :global(p) { margin: 0 0 8px; }
  .msg .body :global(p:last-child) { margin-bottom: 0; }
  .msg .body :global(ul) { margin: 4px 0; padding-left: 18px; }
  .msg .body :global(li) { margin-bottom: 2px; }
  .msg .body :global(code) { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; background: rgba(28,22,17,0.06); padding: 1px 4px; border-radius: var(--radius-sharp); }
  .msg .body :global(a) { color: var(--accent-ink); }
  .msg .body :global(sup.cite) { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; color: var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-sharp); padding: 0 3px; margin: 0 1px; }
  .thinking { display: flex; gap: 4px; padding: 4px 0; }
  .thinking span { width: 6px; height: 6px; border-radius: var(--radius-pill); background: rgba(28,22,17,0.3); animation: bounce 1.2s infinite ease-in-out; }
  .thinking span:nth-child(2) { animation-delay: 0.15s; }
  .thinking span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-4px); opacity: 1; } }

  .sources { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(28,22,17,0.08); }
  .src-lab { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.4); margin-right: 2px; }
  .src { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.65); background: rgba(28,22,17,0.04); border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round); padding: 1px 6px; text-decoration: none; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src:hover { background: rgba(28,22,17,0.09); }
  .src[data-t='governance'] { border-color: rgba(138,45,58,0.4); color: #8a2d3a; }
  .src[data-t='precedent'] { border-color: var(--accent-ink-tint-35); color: var(--accent-ink); }
  .src[data-t='persona'] { border-color: rgba(122,90,166,0.4); color: #7a5aa6; }

  .am-input { display: flex; gap: 8px; margin-top: 10px; }
  .am-input input { flex: 1; font-family: 'DM Sans', system-ui, sans-serif; font-size: 13.5px; color: var(--ink); background: rgba(255,255,255,0.7); border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-round); padding: 9px 12px; outline: none; }
  .am-input input:focus { border-color: var(--accent-ink); }
  .ask { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: var(--paper); background: var(--accent-ink); border: none; border-radius: var(--radius-round); padding: 9px 18px; cursor: pointer; }
  .ask:disabled { opacity: 0.5; cursor: default; }
  .am-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
  .am-foot span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.4); }
  .clear { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); background: none; border: none; border-bottom: 1px dashed currentColor; cursor: pointer; padding: 0; }
</style>
