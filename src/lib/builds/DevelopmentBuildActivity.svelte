<script lang="ts">
  import { onMount, tick } from 'svelte';
  import StreamLine from './StreamLine.svelte';
  import { activityStatus, ageLabel, mergeActivityLogs, type ActivityBuild, type ActivityLog } from './development-activity';
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
<section class="activity" aria-label="Build activity">
  <div class:warning={status.warning} class="activity-status" role="status"><strong>{status.label}</strong><span>{status.detail}</span></div>
  <div class="signals"><span>{connection}</span><span>Worker heartbeat: {ageLabel(Date.parse(build.heartbeatAt ?? ''), now)}</span><span>Last output: {ageLabel(lastOutput, now)}</span></div>
  {#if showOutput}
    {#if latestAction}<p class="latest-action"><strong>Latest recorded action:</strong> {latestAction.content.slice(0, 400)}</p>{/if}
    <div class="output-heading"><h2>Activity / live code and commands</h2><button class="nm-btn-ghost" aria-pressed={follow} onclick={() => { follow = !follow; if (follow) void scroll(); }}>{follow ? 'Following output' : 'Follow output'}</button></div>
    <p class="muted">{replay}. Recent output is restored on reload. Long commands can be quiet while the worker heartbeat continues.</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable log needs keyboard focus for scrolling.) -->
    <div class="output" bind:this={scroller} onscroll={() => { if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 80) follow = false; }} role="log" aria-label="Code generation and command output" aria-live="off" tabindex="0">
      {#each lines as line (line.key)}<StreamLine {line} {buildId} />{:else}<p>No output received yet. Check the worker heartbeat and build status above.</p>{/each}
    </div>
    <p class="muted">Showing the latest 160 saved events; long entries are capped at 16,000 characters. <a href={`/jkai/builds/${buildId}`}>Open full build console →</a></p>
  {/if}
</section>
<style>
  .latest-action { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-code); font-size: var(--fs-label); }
  .activity { margin: 10px 0; min-width: 0; }
  .activity-status { border-left: 3px solid var(--accent-ink); padding: 8px 10px; background: var(--surface-sunken); }
  .activity-status.warning { border-color: var(--accent); } .activity-status { display: flex; flex-wrap: wrap; gap: 5px 12px; font-size: var(--fs-label); } .activity-status span { color: var(--text-secondary); }
  .output-heading h2 { font-size: var(--fs-label); text-transform: uppercase; letter-spacing: .06em; }
  .signals, .output-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 7px 0; }
  .output-heading { justify-content: space-between; } h2 { font-size: var(--fs-body-lg); margin: 0; }
  .signals, .muted { color: var(--text-secondary); font-size: var(--fs-label); }
  .output { height: 260px; overflow: auto; border: 1px solid var(--line-strong); padding: 10px; background: var(--surface-sunken); overflow-wrap: anywhere; }
  .output :global(.body) { font-family: var(--font-code); font-size: var(--fs-label); }
  @media(prefers-reduced-motion: reduce) { .output :global(.cursor) { animation: none; } }
  .output:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media(max-width: 700px) { .output { height: 220px; padding: 6px; } }
</style>
