<script lang="ts">
  // The live transcript, in the /health register. A terminal is the one place
  // on this page where a monospace block on a sunken ground IS the design, so
  // the pass here is chrome only: mono eyebrows, hairline rules, the system's
  // button shape, and the status line as a bordered notice rather than a
  // coloured box.
  import { onMount, tick } from 'svelte';
  import StreamLine from '$lib/builds/StreamLine.svelte';
  import { activityStatus, ageLabel, mergeActivityLogs, type ActivityBuild, type ActivityLog } from '$lib/builds/development-activity';
  let { buildId, build, needsOwner = false, showOutput = true }: { buildId: string; build: ActivityBuild; needsOwner?: boolean; showOutput?: boolean } = $props();
  let logs = $state<ActivityLog[]>([]);
  let live = $state<Record<string, { type: string; content: string; iterationId: string | null; streaming: boolean }>>({});
  let connection = $state('Connecting'); let replay = $state('Loading saved output');
  let lastOutput = $state(0); let now = $state(Date.now()); let follow = $state(true);
  let scroller: HTMLDivElement | undefined = $state();
  let cursor = 0; let polling = false; let disposed = false;
  const status = $derived(activityStatus(build, lastOutput, now, needsOwner));
  const latestAction = $derived([...logs].reverse().find(row => row.type === 'code'));
  const lines = $derived([
    ...logs.filter(l => l.type !== 'thinking').map(l => ({ ...l, key: `saved:${l.id}`, streaming: false })),
    ...Object.entries(live).map(([key, l]) => ({ ...l, key, id: null })),
  ]);
  async function scroll() { await tick(); if (follow && scroller) scroller.scrollTop = scroller.scrollHeight; }
  function clearSavedSegments(row: ActivityLog) {
    const type = row.type === 'code' ? 'tool' : row.type === 'error' ? 'output' : row.type;
    for (const [key, part] of Object.entries(live)) if (!part.streaming && part.iterationId === row.iterationId && part.type === type) delete live[key];
  }
  async function recover() {
    if (polling || disposed) return;
    polling = true;
    try {
      const response = await fetch(`/api/jkai/builds/${buildId}/logs?after=${cursor}`);
      if (!response.ok) throw new Error('Saved output unavailable');
      const result: { logs: ActivityLog[]; cursor: number } = await response.json();
      if (disposed) return;
      logs = mergeActivityLogs(logs, result.logs); cursor = result.cursor;
      for (const row of result.logs) { clearSavedSegments(row); lastOutput = Math.max(lastOutput, Date.parse(row.createdAt ?? '') || 0); }
      replay = 'Saved output up to date'; await scroll();
    } catch { if (!disposed) replay = 'Saved output unavailable — retrying'; }
    finally { polling = false; }
  }
  onMount(() => {
    disposed = false;
    const events = new EventSource(`/api/jkai/builds/${buildId}/stream`);
    events.onopen = () => { connection = 'Live stream connected'; void recover(); };
    events.onerror = () => { connection = 'Live stream reconnecting'; };
    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const id = Number(event.lastEventId);
        if (id > 0 && typeof data.content === 'string') {
          const row: ActivityLog = { id, type: data.type, content: data.content, iterationId: data.iterationId ?? null, createdAt: data.createdAt };
          logs = mergeActivityLogs(logs, [row]); clearSavedSegments(row); lastOutput = Date.now();
        } else if (typeof data.streamId === 'string' && String(data.type).startsWith('stream_')) {
          lastOutput = Date.now();
          if (data.type === 'stream_thinking') return;
          const key = data.streamId;
          if (data.type === 'stream_tool_start') live[key] = { type: 'tool', content: data.toolName ? `${data.toolName}\n` : '', iterationId: data.iterationId ?? null, streaming: true };
          else if (data.type === 'stream_text' || data.type === 'stream_tool_delta') {
            const part = live[key] ?? { type: data.type === 'stream_text' ? 'text' : 'tool', content: '', iterationId: data.iterationId ?? null, streaming: true };
            if (typeof data.delta === 'string') part.content = (part.content + data.delta).slice(-32000);
            live[key] = part;
          } else if (data.type === 'stream_tool_output') live[key] = { type: 'output', content: String(data.full ?? '').slice(-32000), iterationId: data.iterationId ?? null, streaming: true };
          else if (live[key] && (data.type === 'stream_turn_end' || data.type === 'stream_tool_end')) {
            if (typeof data.full === 'string') live[key].content = (data.toolName ? `${data.toolName}\n` : '') + data.full.slice(-32000);
            live[key].streaming = false;
          }
          const keys = Object.keys(live); for (const old of keys.slice(0, -24)) delete live[old];
        }
        void scroll();
      } catch { /* Malformed frames must not break reconnection or saved replay. */ }
    };
    void recover();
    const timer = setInterval(() => { now = Date.now(); void recover(); }, 3000);
    return () => { disposed = true; events.close(); clearInterval(timer); };
  });
</script>
<section class="ac" aria-label="Build activity">
  <div class="ac-status" class:warning={status.warning} role="status">
    <strong>{status.label}</strong><span>{status.detail}</span>
  </div>
  <p class="ac-signals">
    <span>{connection}</span><span>Worker heartbeat: {ageLabel(Date.parse(build.heartbeatAt ?? ''), now)}</span><span>Last output: {ageLabel(lastOutput, now)}</span>
  </p>
  {#if showOutput}
    {#if latestAction}<p class="ac-latest"><span class="ac-eyebrow">Latest recorded action</span>{latestAction.content.slice(0, 400)}</p>{/if}
    <div class="ac-head">
      <p class="ac-eyebrow">Activity / live code and commands</p>
      <button class="ac-toggle" class:on={follow} aria-pressed={follow} onclick={() => { follow = !follow; if (follow) void scroll(); }}>{follow ? 'Following output' : 'Follow output'}</button>
    </div>
    <p class="ac-muted">{replay}. Recent output is restored on reload. Long commands can be quiet while the worker heartbeat continues.</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable log needs keyboard focus for scrolling.) -->
    <div class="ac-output" bind:this={scroller} onscroll={() => { if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 80) follow = false; }} role="log" aria-label="Code generation and command output" aria-live="off" tabindex="0">
      {#each lines as line (line.key)}<StreamLine {line} {buildId} />{:else}<p class="ac-muted">No output received yet. Check the worker heartbeat and build status above.</p>{/each}
    </div>
    <p class="ac-muted">Showing the latest 160 saved events; long entries are capped at 16,000 characters. <a class="ac-link" href={`/jkai/builds/${buildId}`}>Open full build console →</a></p>
  {/if}
</section>
<style>
  .ac { margin: 0 0 26px; min-width: 0; }

  .ac-status {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: baseline;
    font-size: var(--fs-nav);
    border-left: 3px solid var(--accent-ink);
    background: var(--surface-sunken);
    padding: 12px 16px;
  }
  .ac-status.warning { border-left-color: var(--accent); }
  .ac-status span { color: var(--text-secondary); }

  .ac-signals,
  .ac-muted {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    line-height: 1.6;
    color: var(--text-muted);
    margin: 10px 0;
  }
  .ac-signals { display: flex; flex-wrap: wrap; gap: 6px 20px; }
  .ac-muted { font-family: var(--font-body); font-size: var(--fs-label); letter-spacing: 0; }

  .ac-eyebrow {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 6px;
  }
  .ac-latest {
    font-family: var(--font-code);
    font-size: var(--fs-label);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border-left: 1px solid var(--line);
    padding-left: 14px;
    margin: 16px 0;
  }
  .ac-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line-strong);
    padding-bottom: 10px;
    margin-top: 18px;
  }
  .ac-head .ac-eyebrow { margin: 0; }

  .ac-toggle {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 7px 14px;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
  }
  .ac-toggle:hover { border-color: var(--accent); color: var(--accent); }
  .ac-toggle.on { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }

  .ac-output {
    height: 300px;
    overflow: auto;
    border: 1px solid var(--card-border);
    padding: 14px;
    background: var(--surface-sunken);
    overflow-wrap: anywhere;
  }
  .ac-output :global(.body) { font-family: var(--font-code); font-size: var(--fs-label); }
  @media (prefers-reduced-motion: reduce) { .ac-output :global(.cursor) { animation: none; } }
  .ac-output:focus-visible,
  .ac-toggle:focus-visible,
  .ac-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .ac-link { color: var(--accent-ink); }

  @media (max-width: 700px) {
    .ac-output { height: 240px; padding: 10px; }
  }
</style>
