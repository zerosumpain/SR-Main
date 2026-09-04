<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  // Panel for `deep-research` (single-shot DAG-driven research).
  // The executor lives at src/lib/workflows/nodes/deep-research.ts.
  // Config shape:
  //   { topic: string (templated), goals: string (templated), depth: 'shallow'|'medium'|'deep',
  //     pollIntervalMs: number, maxWaitMs: number, _onError?: ... }
  // We preserve unknown keys via spread so orchestrator-emitted extras survive
  // round-trips through the editor.

  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // The canvas-level header handles the "What this does" line; don't repeat it.
  void definition;

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Derived values ----------------------------------------------

  const topic = $derived(String(config.topic ?? ''));
  const goals = $derived(String(config.goals ?? ''));
  const depth = $derived(String(config.depth ?? 'medium'));
  const pollIntervalMs = $derived.by(() => {
    const raw = config.pollIntervalMs;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
  });
  const maxWaitMs = $derived.by(() => {
    const raw = config.maxWaitMs;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 900_000;
  });

  // Human-readable max-wait readout.
  const maxWaitLabel = $derived.by(() => {
    const minutes = maxWaitMs / 60_000;
    if (minutes >= 1) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;
    return `${(maxWaitMs / 1000).toFixed(0)} s`;
  });

  // Deterministic preview of the prompt that would be sent to research_start.
  // Mirrors `startArgs` assembly in deep-research.ts (topic / goals / depth)
  // — note: the actual research engine builds its own internal prompt from
  // these args, but surfacing them up-front matches the executor's contract.
  const promptPreview = $derived.by(() => {
    const lines: string[] = [];
    lines.push(`topic: ${topic.trim() || '(required — empty)'}`);
    if (goals.trim()) lines.push(`goals: ${goals.trim()}`);
    lines.push(`depth: ${depth}`);
    return lines.join('\n');
  });

  let showPreview = $state(false);
</script>

<div class="dr">
  <!-- Topic (templated input) -->
  <section class="dr-sec">
    <label class="dr-field">
      <span class="dr-label">Topic <span class="dr-req">required</span></span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'What is the impact of {{input.subject}}?'}
        value={topic}
        oninput={(e) => set('topic', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="dr-hint">
        Templates: <code>{`{{input.field}}`}</code> / <code>{`{{item.title}}`}</code>.
        {#if !topic.trim()}<span class="dr-warn">empty — workflow will fail at runtime</span>{/if}
      </span>
    </label>
  </section>

  <!-- Goals (multi-line) -->
  <section class="dr-sec">
    <label class="dr-field">
      <span class="dr-label">Goals (optional)</span>
      <textarea
        class="dr-code"
        rows="4"
        spellcheck="false"
        placeholder={'Understand key players, risks, opportunities.\nOne angle per line.'}
        value={goals}
        oninput={(e) => set('goals', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="dr-hint">Specific angles or questions to address. Templates supported.</span>
    </label>
  </section>

  <!-- Depth (segmented pill toggle) -->
  <section class="dr-sec">
    <div class="dr-field">
      <span class="dr-label">Depth</span>
      <div class="dr-pill" role="radiogroup" aria-label="Research depth">
        {#each [
          { value: 'shallow', label: 'Shallow', sub: 'quick skim' },
          { value: 'medium', label: 'Medium', sub: 'balanced' },
          { value: 'deep', label: 'Deep', sub: 'thorough' },
        ] as opt (opt.value)}
          <button
            type="button"
            class="dr-pill-btn"
            class:active={depth === opt.value}
            role="radio"
            aria-checked={depth === opt.value}
            onclick={() => set('depth', opt.value)}
          >
            <span class="dr-pill-label">{opt.label}</span>
            <span class="dr-pill-sub">{opt.sub}</span>
          </button>
        {/each}
      </div>
      <span class="dr-hint">Trades latency for thoroughness. Deep can run several minutes.</span>
    </div>
  </section>

  <!-- Polling / timeout -->
  <section class="dr-sec">
    <header class="dr-sec-hdr"><span class="sr-label-tight">Polling</span></header>
    <div class="dr-row">
      <label class="dr-field">
        <span class="dr-label">Poll interval (ms)</span>
        <input
          type="number"
          min="500"
          step="500"
          value={pollIntervalMs}
          oninput={(e) => {
            const v = Math.max(500, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 5000));
            set('pollIntervalMs', v);
          }}
        />
      </label>
      <label class="dr-field">
        <span class="dr-label">Max wait (ms) <span class="dr-meta">{maxWaitLabel}</span></span>
        <input
          type="number"
          min="1000"
          step="1000"
          value={maxWaitMs}
          oninput={(e) => {
            const v = Math.max(1000, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 900_000));
            set('maxWaitMs', v);
          }}
        />
      </label>
    </div>
    <span class="dr-hint">Defaults: poll every 5s, give up after 15min. Long-running deep runs may need a higher ceiling.</span>
  </section>

  <!-- Test prompt preview -->
  <details class="dr-prev" bind:open={showPreview}>
    <summary><span class="sr-label-tight">Test prompt preview</span></summary>
    <pre class="dr-prev-body">{promptPreview}</pre>
    <span class="dr-hint">Args sent to <code>research_start</code>. The downstream engine builds its own search/synthesis prompt from these.</span>
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
  .dr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .dr-sec { display: flex; flex-direction: column; gap: 8px; }
  .dr-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .dr-row { display: flex; gap: 10px; }
  .dr-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .dr-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: flex; align-items: baseline; gap: 8px;
  }
  .dr-meta { color: var(--accent); }
  .dr-req {
    color: var(--status-error, #c0392b);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .dr-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .dr-hint code, .dr-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .dr-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
    margin-left: 6px;
  }

  .dr-pill {
    display: inline-flex;
    border: 1px solid var(--card-border);
    background: var(--bg);
    overflow: hidden;
    width: fit-content;
  }
  .dr-pill-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 14px;
    background: transparent;
    color: var(--text-muted);
    border: 0;
    border-right: 1px solid var(--card-border);
    cursor: pointer;
    font: inherit;
    transition: background 80ms, color 80ms;
  }
  .dr-pill-btn:last-child { border-right: 0; }
  .dr-pill-btn:hover { color: var(--text-primary); }
  .dr-pill-btn.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .dr-pill-label {
    font-family: var(--font-mono); font-size: var(--fs-label);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .dr-pill-sub {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .dr-pill-btn.active .dr-pill-sub { color: color-mix(in srgb, var(--accent) 80%, var(--text-muted)); }

  .dr-code {
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
  .dr-code:focus { border-color: var(--text-muted); }

  input[type='text'], input[type='number'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='number']:focus, textarea:focus {
    border-color: var(--text-muted);
  }

  .dr-prev {
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    padding: 6px 10px;
  }
  .dr-prev summary { cursor: pointer; }
  .dr-prev-body {
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

