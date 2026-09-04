<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- Deep-dive session picker ------------------------------------
  // Lets users pick an existing research session instead of pasting a UUID.
  // Falls back to free-text / templates inside ResourcePicker.

  async function fetchDeepDiveSessions(): Promise<Array<{ value: string; label: string; meta?: string }>> {
    const res = await fetch('/api/deepdive');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Expected array');
    return rows
      .filter((r) => r && typeof r.id === 'string')
      .map((r) => {
        const id = r.id as string;
        const title = typeof r.title === 'string' ? r.title.trim() : '';
        const topic = typeof r.topic === 'string' ? r.topic.trim() : '';
        const label = title || topic || id;
        const status = typeof r.status === 'string' ? r.status : '';
        const createdAt = typeof r.createdAt === 'string' ? r.createdAt : '';
        const meta = status || createdAt || undefined;
        return { value: id, label, meta };
      });
  }

  // ---------- Engine / session / topic ------------------------------------
  // The executor reads:
  //   engine    — 'deep' | 'quick'  (default 'deep')
  //   sessionId — string, required to fetch anything; commonly templated from
  //               an upstream node (e.g. {{input.researchSessionId}})
  //   topic     — display-only, passed through to the output

  const engine = $derived(String(config.engine ?? 'deep'));
  const sessionId = $derived(String(config.sessionId ?? ''));
  const topic = $derived(String(config.topic ?? ''));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  const sessionLooksTemplated = $derived(sessionId.includes('{{'));
  const sessionMissing = $derived(!sessionId.trim());

  // ---------- Raw JSON ----------------------------------------------------
  void definition;
</script>

<div class="rr">
  <!-- Engine -->
  <section class="rr-sec">
    <header class="rr-sec-hdr">
      <span class="sr-label-tight">Source engine</span>
      <span class="rr-sec-meta">{engine === 'deep' ? 'Deep research' : 'Quick answer'}</span>
    </header>
    <label class="rr-field">
      <span class="rr-label">Engine</span>
      <select value={engine} onchange={(e) => set('engine', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="deep">Deep research</option>
        <option value="quick">Quick research</option>
      </select>
      <span class="rr-hint">
        {#if engine === 'deep'}
          Reads via the <code>research_get_report</code> site tool.
        {:else}
          Reads from the <code>quick_answers</code> table directly.
        {/if}
      </span>
    </label>
  </section>

  <!-- Session ID -->
  <section class="rr-sec">
    <header class="rr-sec-hdr">
      <span class="sr-label-tight">Session</span>
      {#if sessionMissing}
        <span class="rr-warn">required</span>
      {:else if sessionLooksTemplated}
        <span class="rr-info">templated</span>
      {/if}
    </header>
    <div class="rr-field">
      <span class="rr-label">Session ID</span>
      <ResourcePicker
        value={sessionId}
        fetcher={fetchDeepDiveSessions}
        onChange={(v) => set('sessionId', v)}
        placeholder="select a research session"
        emptyHint="No sessions yet — commission one upstream, or template a value."
      />
      <span class="rr-hint">
        Pick an existing session, type a UUID, or template from upstream — e.g.
        <code>{`{{input.researchSessionId}}`}</code> from a
        <code>quick-answer</code> or deep-research commission node. Empty values
        yield a <em>not commissioned</em> output.
      </span>
    </div>
  </section>

  <!-- Topic (display passthrough) -->
  <section class="rr-sec">
    <header class="rr-sec-hdr">
      <span class="sr-label-tight">Topic (display)</span>
    </header>
    <label class="rr-field">
      <span class="rr-label">Title shown on the node</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'{{input.researchTopic}}'}
        value={topic}
        oninput={(e) => set('topic', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="rr-hint">
        Passed straight through to <code>output.researchTopic</code>; does not
        affect what gets fetched. Templates supported.
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .rr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .rr-sec { display: flex; flex-direction: column; gap: 8px; }
  .rr-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .rr-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .rr-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .rr-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .rr-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .rr-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .rr-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); }
  .rr-info { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .rr-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-code); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .rr-code:focus { border-color: var(--text-muted); }

  input[type='text'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }
</style>
