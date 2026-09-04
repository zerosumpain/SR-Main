<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  // Panel for `deep-dive` (legacy multi-mode research node — distinct from
  // the single-shot `deep-research` node). Marked `hidden: true` in the def
  // since it's been split into deep-dive-{start,status,list,report,control},
  // but existing canvases still mount it so the editor needs to handle it.
  //
  // Config shape:
  //   { operation: 'start'|'status'|'list'|'report'|'control',
  //     topic, goals, depth: 'shallow'|'medium'|'deep',          (start only)
  //     sessionId, action: 'pause'|'resume'|'cancel',             (control only)
  //     _onError?: ... }
  //
  // Visible-when rules mirror the basicConfig in deep-dive.def.ts so the
  // structured editor matches the runtime contract; unknown keys preserved
  // via spread.

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

  void definition;

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Deep-dive session picker ------------------------------------
  // Fetches existing research sessions so the user can pick one rather than
  // pasting a UUID. Falls back to free-text / templates via ResourcePicker.

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

  // ---------- Derived values ----------------------------------------------

  type Op = 'start' | 'status' | 'list' | 'report' | 'control';
  const operation = $derived((String(config.operation ?? 'list') as Op));
  const topic = $derived(String(config.topic ?? ''));
  const goals = $derived(String(config.goals ?? ''));
  const depth = $derived(String(config.depth ?? 'medium'));
  const sessionId = $derived(String(config.sessionId ?? ''));
  const action = $derived(String(config.action ?? 'pause'));

  const showStartFields = $derived(operation === 'start');
  const showSessionId = $derived(
    operation === 'status' || operation === 'report' || operation === 'control',
  );
  const showAction = $derived(operation === 'control');

  // Test prompt preview — assemble the args this node would send to its
  // underlying site-tool. Mirrors deep-dive.ts dispatch.
  const argsPreview = $derived.by(() => {
    switch (operation) {
      case 'start': {
        const lines: string[] = [`tool: research_start`];
        lines.push(`topic: ${topic.trim() || '(required — empty)'}`);
        if (goals.trim()) lines.push(`goals: ${goals.trim()}`);
        lines.push(`depth: ${depth}`);
        return lines.join('\n');
      }
      case 'status':
        return `tool: research_status\nid: ${sessionId.trim() || '(required — empty)'}`;
      case 'list':
        return `tool: research_list\n(no args)`;
      case 'report':
        return `tool: research_get_report\nid: ${sessionId.trim() || '(required — empty)'}`;
      case 'control':
        return `tool: research_control\nid: ${sessionId.trim() || '(required — empty)'}\naction: ${action || '(required — empty)'}`;
      default:
        return `(unknown operation)`;
    }
  });

  let showPreview = $state(false);
  const OP_OPTIONS: Array<{ value: Op; label: string; sub: string }> = [
    { value: 'start', label: 'Start', sub: 'new session' },
    { value: 'status', label: 'Status', sub: 'check progress' },
    { value: 'list', label: 'List', sub: 'recent sessions' },
    { value: 'report', label: 'Report', sub: 'fetch result' },
    { value: 'control', label: 'Control', sub: 'pause/resume/cancel' },
  ];
</script>

<div class="dd">
  <!-- Operation (segmented pill) -->
  <section class="dd-sec">
    <div class="dd-field">
      <span class="dd-label">Operation</span>
      <div class="dd-pill" role="radiogroup" aria-label="Deep-dive operation">
        {#each OP_OPTIONS as opt (opt.value)}
          <button
            type="button"
            class="dd-pill-btn"
            class:active={operation === opt.value}
            role="radio"
            aria-checked={operation === opt.value}
            onclick={() => set('operation', opt.value)}
          >
            <span class="dd-pill-label">{opt.label}</span>
            <span class="dd-pill-sub">{opt.sub}</span>
          </button>
        {/each}
      </div>
      <span class="dd-hint">
        Legacy node — for new graphs prefer the dedicated <code>deep-dive-start</code>, <code>deep-dive-status</code>, etc.
      </span>
    </div>
  </section>

  <!-- Start-only: topic + goals + depth -->
  {#if showStartFields}
    <section class="dd-sec">
      <label class="dd-field">
        <span class="dd-label">Topic <span class="dd-req">required</span></span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'Impact of AI on software engineering'}
          value={topic}
          oninput={(e) => set('topic', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="dd-hint">
          Templates: <code>{`{{input.field}}`}</code>.
          {#if !topic.trim()}<span class="dd-warn">empty — start will fail at runtime</span>{/if}
        </span>
      </label>
    </section>

    <section class="dd-sec">
      <label class="dd-field">
        <span class="dd-label">Goals (optional)</span>
        <textarea
          class="dd-code"
          rows="4"
          spellcheck="false"
          placeholder={'Understand trends, key players, future outlook.\nOne angle per line.'}
          value={goals}
          oninput={(e) => set('goals', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="dd-hint">Specific angles or questions. Templates supported.</span>
      </label>
    </section>

    <section class="dd-sec">
      <div class="dd-field">
        <span class="dd-label">Depth</span>
        <div class="dd-pill" role="radiogroup" aria-label="Research depth">
          {#each [
            { value: 'shallow', label: 'Shallow', sub: 'quick skim' },
            { value: 'medium', label: 'Medium', sub: 'balanced' },
            { value: 'deep', label: 'Deep', sub: 'thorough' },
          ] as opt (opt.value)}
            <button
              type="button"
              class="dd-pill-btn"
              class:active={depth === opt.value}
              role="radio"
              aria-checked={depth === opt.value}
              onclick={() => set('depth', opt.value)}
            >
              <span class="dd-pill-label">{opt.label}</span>
              <span class="dd-pill-sub">{opt.sub}</span>
            </button>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <!-- Status / Report / Control: sessionId -->
  {#if showSessionId}
    <section class="dd-sec">
      <div class="dd-field">
        <span class="dd-label">Session ID <span class="dd-req">required</span></span>
        <ResourcePicker
          value={sessionId}
          fetcher={fetchDeepDiveSessions}
          onChange={(v) => set('sessionId', v)}
          placeholder="select a deep-dive session"
          emptyHint="No sessions yet — start one with the deep-dive-start node, or template a value."
        />
        <span class="dd-hint">
          Pick an existing session, type a UUID, or use a template like
          <code>{`{{input.data.id}}`}</code> from an upstream <em>start</em> node.
          {#if !sessionId.trim()}<span class="dd-warn">empty — workflow will fail at runtime</span>{/if}
        </span>
      </div>
    </section>
  {/if}

  <!-- Control-only: action -->
  {#if showAction}
    <section class="dd-sec">
      <div class="dd-field">
        <span class="dd-label">Action</span>
        <div class="dd-pill" role="radiogroup" aria-label="Control action">
          {#each [
            { value: 'pause', label: 'Pause' },
            { value: 'resume', label: 'Resume' },
            { value: 'cancel', label: 'Cancel' },
          ] as opt (opt.value)}
            <button
              type="button"
              class="dd-pill-btn"
              class:active={action === opt.value}
              role="radio"
              aria-checked={action === opt.value}
              onclick={() => set('action', opt.value)}
            >
              <span class="dd-pill-label">{opt.label}</span>
            </button>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <!-- Test prompt preview (assembled site-tool args) -->
  <details class="dd-prev" bind:open={showPreview}>
    <summary><span class="sr-label-tight">Test prompt preview</span></summary>
    <pre class="dd-prev-body">{argsPreview}</pre>
    <span class="dd-hint">Args this node would send to its site tool, with templates left literal.</span>
  </details>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .dd { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .dd-sec { display: flex; flex-direction: column; gap: 8px; }

  .dd-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .dd-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: flex; align-items: baseline; gap: 8px;
  }
  .dd-req {
    color: var(--status-error, #c0392b);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .dd-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .dd-hint code, .dd-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .dd-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
    margin-left: 6px;
  }

  .dd-pill {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--card-border);
    background: var(--bg);
    overflow: hidden;
    width: fit-content;
    max-width: 100%;
  }
  .dd-pill-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 12px;
    background: transparent;
    color: var(--text-muted);
    border: 0;
    border-right: 1px solid var(--card-border);
    cursor: pointer;
    font: inherit;
    transition: background 80ms, color 80ms;
  }
  .dd-pill-btn:last-child { border-right: 0; }
  .dd-pill-btn:hover { color: var(--text-primary); }
  .dd-pill-btn.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .dd-pill-label {
    font-family: var(--font-mono); font-size: var(--fs-label);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .dd-pill-sub {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .dd-pill-btn.active .dd-pill-sub { color: color-mix(in srgb, var(--accent) 80%, var(--text-muted)); }

  .dd-code {
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
  .dd-code:focus { border-color: var(--text-muted); }

  input[type='text'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, textarea:focus {
    border-color: var(--text-muted);
  }

  .dd-prev {
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    padding: 6px 10px;
  }
  .dd-prev summary { cursor: pointer; }
  .dd-prev-body {
    margin: 8px 0 4px;
    padding: 8px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-code); font-size: var(--fs-label);
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary);
  }
</style>
