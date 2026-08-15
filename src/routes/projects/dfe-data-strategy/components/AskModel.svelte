<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { pct } from '../lib/format';
  import { POSTURE_BY_ID } from '../lib/postures';

  let { compact = false, onClose }: { compact?: boolean; onClose?: () => void } = $props();

  interface Msg { role: 'user' | 'assistant'; content: string; sources?: { n: number; title: string; url: string | null }[] }
  let messages = $state<Msg[]>([]);
  let input = $state('');
  let busy = $state(false);

  const SUGGESTIONS = [
    'What pressures should the department’s data strategy prioritise?',
    'What is the consistent child identifier and why does it matter?',
    'How do the legal gateways for data-sharing differ from a lawful basis?',
    'What does “data maturity” mean for a department?',
  ];

  function scenarioSummary(): string {
    const a = app.align;
    const postures = Object.entries(app.state.postures)
      .filter(([, v]) => Math.abs(v) > 0.12)
      .map(([id, v]) => `${v < 0 ? POSTURE_BY_ID[id]?.leftLabel : POSTURE_BY_ID[id]?.rightLabel} (${Math.round(Math.abs(v) * 100)}%)`)
      .join(', ');
    const tensions = a.tensions.map((t) => t.title).join('; ') || 'none';
    return `Strategy "${app.scenarioName}". Posture leanings: ${postures || 'all balanced'}. Overall pressure coverage ${pct(a.overallCoverage)} (cross-gov ${pct(a.coverageByOrigin['cross-government'])}, the department policy ${pct(a.coverageByOrigin['dfe-policy'])}, partners ${pct(a.coverageByOrigin.partners)}). Flagged tensions: ${tensions}.`;
  }

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    input = '';
    messages = [...messages, { role: 'user', content: question }];
    const idx = messages.length;
    messages = [...messages, { role: 'assistant', content: '', sources: [] }];
    busy = true;
    try {
      const res = await fetch('/projects/dfe-data-strategy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          scenario: scenarioSummary(),
          history: messages.slice(0, idx - 1).slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'sources') messages[idx].sources = obj.sources;
            else if (obj.type === 'token') messages[idx].content += obj.token;
            else if (obj.type === 'error') messages[idx].content += `\n[${obj.message}]`;
          } catch { /* ignore */ }
        }
        messages = [...messages];
      }
    } catch (e) {
      messages[idx].content = 'Sorry — the model is unavailable right now.';
      messages = [...messages];
    } finally {
      busy = false;
    }
  }
</script>

<div class="am" class:compact>
  <div class="am-log">
    {#if messages.length === 0}
      <p class="am-intro">Ask about the data-strategy landscape, the pressures, the legal stack, the frameworks — grounded in this project’s research only.</p>
      <div class="am-sugg">
        {#each SUGGESTIONS as s}<button onclick={() => send(s)}>{s}</button>{/each}
      </div>
    {/if}
    {#each messages as m}
      <div class="msg {m.role}">
        <span class="m-who">{m.role === 'user' ? 'You' : '✦ Model'}</span>
        <div class="m-body">{m.content}{#if busy && m.role === 'assistant' && m === messages[messages.length - 1] && !m.content}<span class="dots">…</span>{/if}</div>
        {#if m.sources && m.sources.length}
          <div class="m-src">{#each m.sources as s}<span class="src" title={s.title}>[{s.n}] {s.url ? '' : ''}{s.title.slice(0, 28)}</span>{/each}</div>
        {/if}
      </div>
    {/each}
  </div>
  <form class="am-form" onsubmit={(e) => { e.preventDefault(); send(); }}>
    <input bind:value={input} placeholder="Ask the strategy model…" disabled={busy} />
    <button type="submit" disabled={busy || !input.trim()}>{busy ? '…' : '↑'}</button>
  </form>
</div>

<style>
  .am { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .am-log { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }
  .am-intro { margin: 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.65); }
  .am-sugg { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
  .am-sugg button { text-align: left; font-size: var(--fs-label-xs); color: var(--accent-ink); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-22); border-radius: var(--radius-sharp); padding: 7px 10px; cursor: pointer; }
  .am-sugg button:hover { background: var(--accent-ink-tint-22); }
  .msg { display: flex; flex-direction: column; gap: 2px; }
  .m-who { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .m-body { font-size: var(--fs-label); line-height: 1.55; color: var(--ink); white-space: pre-wrap; }
  .msg.user .m-body { color: rgba(28,22,17,0.72); }
  .m-src { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; }
  .src { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); background: rgba(28,22,17,0.05); padding: 1px 5px; border-radius: var(--radius-sharp); }
  .am-form { display: flex; gap: 6px; margin-top: 10px; }
  .am-form input { flex: 1; border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-sharp); padding: 9px 11px; font-size: var(--fs-label); font-family: var(--font-body); background: rgba(255,255,255,0.7); color: var(--ink); }
  .am-form button { width: 38px; border: none; border-radius: var(--radius-sharp); background: var(--accent-ink); color: #fff; font-size: var(--fs-body-sm); cursor: pointer; }
  .am-form button:disabled { opacity: 0.5; }
  .dots { color: rgba(28,22,17,0.4); }
</style>
