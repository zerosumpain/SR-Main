<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import FilePicker from './shared/FilePicker.svelte';

  // Panel for the `file-delete` workflow node. The executor lives in
  // `src/lib/workflows/nodes/file-ops.ts` (see `fileDeleteExecutor`) and reads:
  //   fileName        – name in the workflow file store, supports {{input.field}}
  //
  // The schema only formally requires `fileName`. We surface a couple of
  // panel-level safety affordances (`confirmDelete`, `force`, `ignoreNotFound`)
  // that round-trip through config so unknown keys are preserved even if the
  // executor doesn't currently consume them. The executor is already idempotent
  // for missing files (returns `{ deleted: false, reason: 'not-found' }`), so
  // `ignoreNotFound` documents that contract for the user.

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- derived state ----------------------------------------------

  const fileName = $derived(String(config.fileName ?? ''));
  const confirmDelete = $derived(!!config.confirmDelete);
  const force = $derived(!!config.force);
  const ignoreNotFound = $derived(config.ignoreNotFound !== false); // default on

  function set(key: string, value: unknown) {
    // Spread first so unknown keys (e.g. `_onError`, future fields) survive.
    onChange({ ...config, [key]: value });
  }

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header renders the "What this does" line so we don't duplicate it here.
  void definition;
</script>

<div class="fd">
  <!-- Destructive-operation banner (top of panel) -->
  <section class="fd-danger" role="alert" aria-label="Destructive operation">
    <span class="fd-danger-tag">Destructive</span>
    <div class="fd-danger-body">
      <strong class="fd-danger-title">This node permanently deletes a file.</strong>
      <p class="fd-danger-text">
        Removes the file from the workflow store and unlinks it from disk. There
        is no trash, no undo, and no version history. Double-check the path —
        especially when it contains <code>{`{{input.field}}`}</code> templates,
        which may resolve to unexpected names at runtime.
      </p>
    </div>
  </section>

  <!-- File name (path) -->
  <section class="fd-sec">
    <header class="fd-sec-hdr">
      <span class="sr-label-tight">File name</span>
      <span class="fd-sec-meta">required</span>
    </header>
    <div class="fd-field">
      <FilePicker
        value={fileName}
        mode="read"
        placeholder={'tmp/{{input.id}}.csv'}
        onChange={(v) => set('fileName', v)}
        hint={'Pick the file to delete, or type a templated name. Templates supported: {{input.field}}.'}
      />
    </div>
  </section>

  <!-- Safety toggles -->
  <section class="fd-sec">
    <header class="fd-sec-hdr">
      <span class="sr-label-tight">Safety</span>
      <span class="fd-sec-meta">{
        confirmDelete
          ? force ? 'Confirmed + force' : 'Confirmed'
          : 'Unconfirmed — will run as-is'
      }</span>
    </header>

    <label class="fd-toggle">
      <input
        type="checkbox"
        checked={confirmDelete}
        onchange={(e) => set('confirmDelete', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="fd-toggle-text">
        <strong>I confirm this node should delete the resolved file.</strong>
        <span class="fd-hint">
          Editor-side acknowledgement. Toggle on after you&apos;re sure the
          path above is what you intend to remove on every run.
        </span>
      </span>
    </label>

    <label class="fd-toggle">
      <input
        type="checkbox"
        checked={force}
        onchange={(e) => set('force', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="fd-toggle-text">
        <strong>Force delete</strong>
        <span class="fd-hint">
          Bypass non-fatal guards where the runtime supports it (e.g. permission
          warnings on read-only files). Has no effect if the underlying
          permission check is hard-required.
        </span>
      </span>
    </label>

    <label class="fd-toggle">
      <input
        type="checkbox"
        checked={ignoreNotFound}
        onchange={(e) => set('ignoreNotFound', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="fd-toggle-text">
        <strong>Ignore &ldquo;not found&rdquo; (default)</strong>
        <span class="fd-hint">
          When on, a missing file is treated as a no-op success
          (<code>{'{ deleted: false, reason: "not-found" }'}</code>). When off,
          let the <em>On failure</em> block decide what happens. The current
          executor is always idempotent — toggling this off documents intent
          for future strict modes.
        </span>
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="fd-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="fd-code"
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
  .fd { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .fd-danger {
    display: flex; align-items: flex-start; gap: 10px;
    border: 1px solid var(--status-error, #c0392b);
    background: color-mix(in srgb, var(--status-error, #c0392b) 10%, transparent);
    padding: 10px 12px;
  }
  .fd-danger-tag {
    flex: 0 0 auto;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--status-error, #c0392b);
    border: 1px solid var(--status-error, #c0392b);
    padding: 2px 6px;
  }
  .fd-danger-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .fd-danger-title { font-size: var(--fs-label); color: var(--text-primary); }
  .fd-danger-text { margin: 0; font-size: var(--fs-label); color: var(--text-muted); line-height: 1.45; }
  .fd-danger-text code { font-size: var(--fs-label); color: var(--text-muted); }

  .fd-sec { display: flex; flex-direction: column; gap: 8px; }
  .fd-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .fd-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .fd-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .fd-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .fd-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .fd-toggle {
    display: grid;
    grid-template-columns: 16px 1fr;
    gap: 8px;
    align-items: start;
    cursor: pointer;
  }
  .fd-toggle input[type='checkbox'] {
    width: 14px; height: 14px;
    margin-top: 2px;
    accent-color: var(--status-error, #c0392b);
    cursor: pointer;
  }
  .fd-toggle-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .fd-toggle-text strong { font-size: var(--fs-label); color: var(--text-primary); font-weight: 600; }

  .fd-code {
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
  .fd-code:focus { border-color: var(--text-muted); }

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
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }

  .fd-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .fd-raw summary { cursor: pointer; }
</style>
