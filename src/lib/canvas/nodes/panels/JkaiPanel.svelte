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

  // ----- Config keys (from src/lib/workflows/nodes/jkai.ts) -----------------
  // operation : 'start' | 'status' | 'list' | 'control'
  // prompt    : string  (start)         — supports {{templates}}
  // title     : string  (start, opt.)   — supports {{templates}}
  // buildId   : string  (status|control) — supports {{templates}}
  // action    : 'pause' | 'resume' | 'cancel' (control)
  // _onError  : universal error-handling block

  const operation = $derived(String(config.operation ?? 'list'));
  const action = $derived(String(config.action ?? 'pause'));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // We don't render a "What this does" preview here — the canvas-level header
  // handles it. `definition` is referenced only for typing.
  void definition;

  let showRawJson = $state(false);
</script>

<div class="jk">
  <!-- Operation / action -->
  <section class="jk-sec">
    <header class="jk-sec-hdr">
      <span class="sr-label-tight">Operation</span>
      <span class="jk-sec-meta">{
        operation === 'start' ? 'Kick off a new autonomous build'
        : operation === 'status' ? 'Look up a build by ID'
        : operation === 'list' ? 'List recent builds (≤ 50)'
        : operation === 'control' ? 'Pause / resume / cancel a build'
        : 'Pick an action'
      }</span>
    </header>
    <label class="jk-field">
      <span class="jk-label">Action</span>
      <select
        value={operation}
        onchange={(e) => set('operation', (e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="start">Start build</option>
        <option value="status">Check status</option>
        <option value="list">List builds</option>
        <option value="control">Control build</option>
      </select>
    </label>
  </section>

  <!-- Start: prompt + title -->
  {#if operation === 'start'}
    <section class="jk-sec">
      <header class="jk-sec-hdr"><span class="sr-label-tight">Build prompt</span></header>
      <label class="jk-field">
        <span class="jk-label">Prompt <span class="jk-req">required</span></span>
        <textarea
          class="jk-code"
          rows="6"
          spellcheck="false"
          placeholder={'Build a landing page with...  Templates: {{input.field}}'}
          value={String(config.prompt ?? '')}
          oninput={(e) => set('prompt', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="jk-hint">Describe what JKAI should build. Templates supported: <code>{`{{input.field}}`}</code>.</span>
      </label>
      <label class="jk-field">
        <span class="jk-label">Title <span class="jk-opt">optional</span></span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'Dashboard Build  —  or  {{input.title}}'}
          value={String(config.title ?? '')}
          oninput={(e) => set('title', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="jk-hint">Friendly name shown in the builds list. Templates supported.</span>
      </label>
    </section>
  {/if}

  <!-- Status / control: build ID -->
  {#if operation === 'status' || operation === 'control'}
    <section class="jk-sec">
      <header class="jk-sec-hdr"><span class="sr-label-tight">Target build</span></header>
      <label class="jk-field">
        <span class="jk-label">Build ID <span class="jk-req">required</span></span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'{{input.data.id}}'}
          value={String(config.buildId ?? '')}
          oninput={(e) => set('buildId', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="jk-hint">Often <code>{`{{input.data.id}}`}</code> from an upstream Start node.</span>
      </label>
    </section>
  {/if}

  <!-- Control action -->
  {#if operation === 'control'}
    <section class="jk-sec">
      <header class="jk-sec-hdr"><span class="sr-label-tight">Control action</span></header>
      <div class="jk-pill-row" role="radiogroup" aria-label="Control action">
        {#each [{ v: 'pause', l: 'Pause' }, { v: 'resume', l: 'Resume' }, { v: 'cancel', l: 'Cancel' }] as opt (opt.v)}
          <button
            type="button"
            class="jk-pill"
            class:jk-pill-active={action === opt.v}
            class:jk-pill-danger={opt.v === 'cancel'}
            role="radio"
            aria-checked={action === opt.v}
            onclick={() => set('action', opt.v)}
          >{opt.l}</button>
        {/each}
      </div>
      <span class="jk-hint">
        {#if action === 'cancel'}<strong>Cancel</strong> ends the build run; it cannot be resumed.{/if}
        {#if action === 'pause'}<strong>Pause</strong> halts the build; it can be resumed later.{/if}
        {#if action === 'resume'}<strong>Resume</strong> restarts a paused build.{/if}
      </span>
    </section>
  {/if}

  <!-- List: nothing to configure -->
  {#if operation === 'list'}
    <section class="jk-sec jk-sec-quiet">
      <header class="jk-sec-hdr"><span class="sr-label-tight">List builds</span></header>
      <p class="jk-empty">No fields to configure. Returns up to 50 most recent builds; downstream nodes can read <code>input.builds</code>.</p>
    </section>
  {/if}

  <!-- Output reminder -->
  <section class="jk-sec jk-sec-quiet">
    <header class="jk-sec-hdr"><span class="sr-label-tight">Downstream shape</span></header>
    <p class="jk-empty">Result is merged into the next node's input as <code>input.success</code>, <code>input.data</code>, <code>input.error</code>.</p>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="jk-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="jk-code"
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
  .jk { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .jk-sec { display: flex; flex-direction: column; gap: 8px; }
  .jk-sec-quiet { opacity: 0.85; }
  .jk-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .jk-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .jk-field { display: flex; flex-direction: column; gap: 4px; }
  .jk-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: inline-flex; gap: 6px; align-items: baseline;
  }
  .jk-req { color: var(--status-error, #c0392b); font-size: var(--fs-label-xs); }
  .jk-opt { color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .jk-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .jk-hint code { font-size: var(--fs-label); color: var(--text-muted); }
  .jk-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .jk-empty code { font-size: var(--fs-label); color: var(--text-muted); }

  .jk-pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .jk-pill {
    padding: 5px 12px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .jk-pill:hover { color: var(--text-primary); }
  .jk-pill-active {
    color: var(--text-primary);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .jk-pill-danger.jk-pill-active {
    border-color: var(--status-error, #c0392b);
    background: color-mix(in srgb, var(--status-error, #c0392b) 10%, transparent);
    color: var(--status-error, #c0392b);
  }

  .jk-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .jk-code:focus { border-color: var(--text-muted); }

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

  .jk-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .jk-raw summary { cursor: pointer; }
</style>
