<script lang="ts">
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

  let showRawJson = $state(false);

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
    <label class="rr-field">
      <span class="rr-label">Session ID</span>
      <textarea
        class="rr-code"
        rows="2"
        spellcheck="false"
        placeholder={'{{input.researchSessionId}}'}
        value={sessionId}
        oninput={(e) => set('sessionId', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="rr-hint">
        Existing session UUID. Typically fed from an upstream
        <code>quick-answer</code> or deep-research commission node via
        <code>{`{{input.researchSessionId}}`}</code>. Empty values yield a
        <em>not commissioned</em> output.
      </span>
    </label>
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
  <details class="rr-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="rr-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .rr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .rr-sec { display: flex; flex-direction: column; gap: 8px; }
  .rr-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .rr-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .rr-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .rr-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .rr-hint { font-size: 11px; color: var(--text-ghost); }
  .rr-hint code { font-size: 11px; color: var(--text-muted); }

  .rr-warn { font-family: var(--font-mono); font-size: 10px; color: var(--status-error, #c0392b); }
  .rr-info { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .rr-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
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

  .rr-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .rr-raw summary { cursor: pointer; }
</style>
