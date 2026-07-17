<script lang="ts">
  import { onMount } from 'svelte';
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
  void definition;

  type ToolMeta = {
    name: string;
    toolset: string;
    description: string;
    destructive: boolean;
    parameters?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  };

  let allTools = $state<ToolMeta[]>([]);
  let loadError = $state<string | null>(null);
  let search = $state('');

  onMount(async () => {
    try {
      const res = await fetch('/api/workflows/site-tools');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      allTools = (body.tools ?? []) as ToolMeta[];
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load tools';
    }
  });

  const toolName = $derived(String(config.toolName ?? ''));
  const selectedTool = $derived(allTools.find((t) => t.name === toolName) ?? null);
  const allowDestructive = $derived(config.allowDestructive === true);

  const grouped = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, ToolMeta[]>();
    for (const t of allTools) {
      if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q) && !t.toolset.toLowerCase().includes(q)) {
        continue;
      }
      const list = map.get(t.toolset) ?? [];
      list.push(t);
      map.set(t.toolset, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function pickTool(name: string) {
    // Selecting a tool that isn't destructive clears any stale allowDestructive flag.
    const next: Record<string, unknown> = { ...config, toolName: name };
    const meta = allTools.find((t) => t.name === name);
    if (!meta?.destructive) next.allowDestructive = false;
    onChange(next);
  }

  // ---- Args JSON editing (local text buffer so invalid JSON doesn't clobber) ----
  function argsToText(raw: unknown): string {
    if (raw == null) return '{}';
    if (typeof raw === 'string') return raw;
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return '{}';
    }
  }

  let argsText = $state(argsToText(config.args));
  let argsValid = $state(true);

  function onArgsInput(text: string) {
    argsText = text;
    if (!text.trim()) {
      argsValid = true;
      set('args', {});
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        argsValid = true;
        set('args', parsed);
      } else {
        argsValid = false;
      }
    } catch {
      argsValid = false;
    }
  }

  function prefillArgs() {
    const props = selectedTool?.parameters?.properties ?? {};
    const required = selectedTool?.parameters?.required ?? Object.keys(props);
    const skeleton: Record<string, unknown> = {};
    for (const key of required) skeleton[key] = '';
    const text = JSON.stringify(skeleton, null, 2);
    argsText = text;
    argsValid = true;
    set('args', skeleton);
  }

  let showRawJson = $state(false);
</script>

<div class="st">
  <p class="st-lead">
    Invoke any registered <strong>site tool</strong> that has no dedicated node — decks, publish,
    media, memory, diagnostics, RAG search. Args are JSON; string values support
    <code>{'{{input.field}}'}</code> templates.
  </p>

  {#if loadError}
    <p class="st-err">Could not load tools: {loadError}</p>
  {/if}

  <!-- Tool picker -->
  <section class="st-sec">
    <header class="st-sec-hdr"><span class="sr-label-tight">Tool</span></header>
    <input
      type="text"
      class="st-text"
      placeholder="search tools (name, toolset, description)…"
      value={search}
      oninput={(e) => (search = (e.currentTarget as HTMLInputElement).value)}
    />
    <div class="st-picker">
      {#each grouped as [toolset, tools] (toolset)}
        <div class="st-group">
          <div class="st-group-hdr">{toolset}</div>
          {#each tools as t (t.name)}
            <button
              type="button"
              class="st-tool"
              class:selected={t.name === toolName}
              onclick={() => pickTool(t.name)}
              title={t.description}
            >
              <span class="st-tool-name">{t.name}</span>
              {#if t.destructive}<span class="st-badge-dest">destructive</span>{/if}
            </button>
          {/each}
        </div>
      {/each}
      {#if grouped.length === 0 && !loadError}
        <p class="st-hint">{allTools.length === 0 ? 'Loading…' : 'No tools match your search.'}</p>
      {/if}
    </div>
  </section>

  {#if selectedTool}
    <section class="st-sec">
      <header class="st-sec-hdr">
        <span class="sr-label-tight">Selected</span>
        {#if selectedTool.destructive}<span class="st-badge-dest">destructive</span>{/if}
      </header>
      <p class="st-selected-name"><code>{selectedTool.name}</code> <span class="st-selected-ts">· {selectedTool.toolset}</span></p>
      <p class="st-hint">{selectedTool.description}</p>
      {#if selectedTool.parameters?.properties}
        <details class="st-schema">
          <summary><span class="sr-label-tight">Parameter schema</span></summary>
          <ul class="st-schema-list">
            {#each Object.entries(selectedTool.parameters.properties) as [key, prop] (key)}
              <li>
                <code>{key}</code>
                <span class="st-schema-type">{prop.type ?? 'any'}</span>
                {#if (selectedTool.parameters?.required ?? []).includes(key)}<span class="st-req">required</span>{/if}
                {#if prop.description}<span class="st-schema-desc">— {prop.description}</span>{/if}
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    </section>
  {/if}

  <!-- Args JSON -->
  <section class="st-sec">
    <header class="st-sec-hdr">
      <span class="sr-label-tight">Args (JSON)</span>
      <span class="st-args-actions">
        {#if argsValid}<span class="st-ok">JSON ✓</span>{:else}<span class="st-warn">invalid JSON</span>{/if}
        {#if selectedTool}<button type="button" class="st-prefill" onclick={prefillArgs}>fill required</button>{/if}
      </span>
    </header>
    <textarea
      class="st-code"
      rows="8"
      spellcheck="false"
      placeholder={'{\n  "query": "{{input.topic}}"\n}'}
      value={argsText}
      oninput={(e) => onArgsInput((e.currentTarget as HTMLTextAreaElement).value)}
    ></textarea>
    <p class="st-hint">
      Must match the tool's parameter schema. String values support
      <code>{'{{input.field}}'}</code>, <code>{'{{state.KEY}}'}</code>,
      <code>{'{{today}}'}</code>, <code>{'{{now}}'}</code>.
    </p>
  </section>

  <!-- Destructive gating -->
  {#if selectedTool?.destructive}
    <section class="st-sec st-dest">
      <header class="st-sec-hdr"><span class="sr-label-tight">Destructive action</span></header>
      <label class="st-check">
        <input
          type="checkbox"
          checked={allowDestructive}
          onchange={(e) => set('allowDestructive', (e.currentTarget as HTMLInputElement).checked)}
        />
        <span>Allow this destructive tool to run</span>
      </label>
      <p class="st-hint">
        {#if allowDestructive}
          You must also place an <strong>approval</strong> node upstream of this node. The run pauses
          for human sign-off before the destructive tool fires. Without it the workflow fails
          verification.
        {:else}
          This tool sends / publishes / deletes. It will refuse to run until you allow it here AND
          wire an approval node upstream.
        {/if}
      </p>
    </section>
  {/if}

  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <details class="st-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="st-code"
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
  .st { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .st-lead { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
  .st-lead strong { color: var(--text-primary); }
  .st-lead code, .st-hint code { font-size: 11px; color: var(--text-muted); }
  .st-err { margin: 0; font-size: 12px; color: var(--status-error, #c0392b); }

  .st-sec { display: flex; flex-direction: column; gap: 8px; }
  .st-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .st-text, .st-code {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 12px;
    box-sizing: border-box;
    outline: none;
  }
  .st-code { font-size: 11px; padding: 8px; resize: vertical; }
  .st-text:focus, .st-code:focus { border-color: var(--text-muted); }

  .st-picker {
    max-height: 220px; overflow-y: auto;
    border: 1px solid var(--card-border);
    display: flex; flex-direction: column;
  }
  .st-group-hdr {
    position: sticky; top: 0;
    background: var(--surface-elevated, var(--bg));
    font-family: var(--font-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-ghost);
    padding: 4px 8px;
    border-bottom: 1px dashed var(--card-border);
  }
  .st-tool {
    display: flex; align-items: center; gap: 8px; justify-content: space-between;
    width: 100%; text-align: left;
    padding: 5px 8px;
    background: transparent; border: none;
    color: var(--text-primary);
    font-family: var(--font-mono); font-size: 11px;
    cursor: pointer;
  }
  .st-tool:hover { background: color-mix(in srgb, var(--card-border) 18%, transparent); }
  .st-tool.selected { background: color-mix(in srgb, var(--accent-ink, var(--text-muted)) 16%, transparent); }
  .st-tool-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .st-badge-dest {
    font-family: var(--font-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--status-error, #c0392b);
    border: 1px solid currentColor;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .st-selected-name { margin: 0; font-size: 12px; }
  .st-selected-name code { font-size: 12px; color: var(--text-primary); }
  .st-selected-ts { color: var(--text-ghost); font-size: 11px; }
  .st-hint { font-size: 11px; color: var(--text-ghost); margin: 0; line-height: 1.4; }

  .st-schema { margin-top: 2px; }
  .st-schema summary { cursor: pointer; }
  .st-schema-list { margin: 6px 0 0; padding-left: 14px; display: flex; flex-direction: column; gap: 4px; }
  .st-schema-list li { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
  .st-schema-list code { color: var(--text-primary); font-size: 11px; }
  .st-schema-type { color: var(--text-ghost); font-size: 10px; margin-left: 4px; }
  .st-schema-desc { color: var(--text-ghost); }
  .st-req { color: var(--status-error, #c0392b); font-size: 9px; text-transform: uppercase; margin-left: 4px; }

  .st-args-actions { display: flex; align-items: center; gap: 8px; }
  .st-ok   { font-family: var(--font-mono); font-size: 10px; color: var(--status-success, #2a9d4a); }
  .st-warn { font-family: var(--font-mono); font-size: 10px; color: var(--status-error, #c0392b); }
  .st-prefill {
    font-family: var(--font-mono); font-size: 10px;
    background: transparent; border: 1px solid var(--card-border);
    color: var(--text-muted); cursor: pointer; padding: 1px 6px;
  }
  .st-prefill:hover { border-color: var(--text-muted); }

  .st-dest { border: 1px solid var(--status-error, #c0392b); padding: 8px; }
  .st-check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-primary); cursor: pointer; }
  .st-check input { width: auto; }

  .st-raw { margin-top: 4px; border-top: 1px dashed var(--card-border); padding-top: 8px; }
  .st-raw summary { cursor: pointer; }
</style>
