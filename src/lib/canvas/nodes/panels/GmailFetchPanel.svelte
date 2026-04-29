<script lang="ts" module>
  // Module-scoped cache so re-mounting the panel doesn't re-fetch the
  // accounts list on every open of the config drawer. Mirrors the cache
  // used by GmailSendPanel.svelte.
  type GmailAccount = {
    id: number;
    email: string;
    status?: string | null;
  };
  let accountsPromise: Promise<GmailAccount[]> | null = null;

  function loadAccounts(): Promise<GmailAccount[]> {
    if (!accountsPromise) {
      accountsPromise = fetch('/api/gmail/accounts')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((rows): GmailAccount[] => {
          if (!Array.isArray(rows)) return [];
          return rows
            .filter((r) => r && typeof r === 'object')
            .map((r) => ({
              id: Number((r as Record<string, unknown>).id ?? 0),
              email: String((r as Record<string, unknown>).email ?? ''),
              status: (r as Record<string, unknown>).status as string | null | undefined,
            }))
            .filter((r) => r.id > 0);
        })
        .catch((err) => {
          // Reset so a later mount can retry, but resolve to [] for the UI
          // (the panel renders a number-input fallback when the list is empty).
          accountsPromise = null;
          console.warn('[GmailFetchPanel] failed to load /api/gmail/accounts', err);
          return [];
        });
    }
    return accountsPromise;
  }
</script>

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

  // ---------- Helpers ----------------------------------------------------
  // Always spread the existing `config` so unknown keys (e.g. _onError,
  // future executor-side fields) round-trip through the editor.

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Account picker --------------------------------------------
  // gmail-fetch's executor reads `accountId` from config and falls back to
  // input.accountId if 0 — so 0 is a legitimate value (inherit from upstream
  // gmail-trigger / gmail-search output) rather than an error.

  const accountId = $derived(Number(config.accountId ?? 0));
  let accounts = $state<GmailAccount[]>([]);
  let accountsLoaded = $state(false);
  let accountsError = $state(false);

  $effect(() => {
    let cancelled = false;
    loadAccounts().then((rows) => {
      if (cancelled) return;
      accounts = rows;
      accountsLoaded = true;
      accountsError = rows.length === 0;
    });
    return () => {
      cancelled = true;
    };
  });

  // ---------- Message id ------------------------------------------------
  // The executor runs strict template interpolation on `messageId`. The
  // common case is `{{trigger.output.messageId}}` (immediately downstream of
  // gmail-trigger) or `{{nodes.search.output.messages[0].id}}` (downstream
  // of gmail-search).

  const messageIdRaw = $derived(String(config.messageId ?? ''));

  function appendTemplate(snippet: string) {
    const current = messageIdRaw;
    // If the field is empty (or only whitespace), replace; otherwise append
    // with a separating space so a user can compose multiple snippets.
    const next = current.trim() === '' ? snippet : `${current} ${snippet}`;
    set('messageId', next);
  }

  const templateExamples: Array<{ label: string; value: string }> = [
    { label: 'From trigger', value: '{{trigger.output.messageId}}' },
    { label: 'From input', value: '{{input.messageId}}' },
    { label: 'First search hit', value: '{{nodes.search.output.messages[0].id}}' },
    { label: 'Reply target', value: '{{input.threadId}}' },
  ];

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="gf">
  <!-- Account picker -->
  <section class="gf-sec">
    <header class="gf-sec-hdr">
      <span class="sr-label-tight">Source account</span>
      {#if !accountId}<span class="gf-info">inherits from upstream</span>{/if}
    </header>
    {#if !accountsLoaded}
      <p class="gf-empty">Loading accounts…</p>
    {:else if accountsError || accounts.length === 0}
      <label class="gf-field">
        <span class="gf-label">Account ID</span>
        <input
          type="number"
          min="0"
          step="1"
          value={accountId || ''}
          placeholder="0 = inherit from input.accountId"
          oninput={(e) =>
            set('accountId', Number((e.currentTarget as HTMLInputElement).value) || 0)}
        />
        <span class="gf-hint">
          Couldn’t load the accounts list. Connect or inspect accounts at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
          Set to <code>0</code> to inherit from the upstream node’s output.
        </span>
      </label>
    {:else}
      <label class="gf-field">
        <span class="gf-label">Account</span>
        <select
          value={String(accountId || 0)}
          onchange={(e) =>
            set('accountId', Number((e.currentTarget as HTMLSelectElement).value) || 0)}
        >
          <option value="0">— inherit from upstream (input.accountId) —</option>
          {#each accounts as a (a.id)}
            <option value={String(a.id)}>{a.email} (#{a.id})</option>
          {/each}
        </select>
        <span class="gf-hint">
          Manage connected accounts at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
          Leave on “inherit” when wiring directly after gmail-trigger or gmail-search.
        </span>
      </label>
    {/if}
  </section>

  <!-- Template helpers (collapsed by default) -->
  <details class="gf-helpers">
    <summary><span class="sr-label-tight">Template helpers</span></summary>
    <p class="gf-hint">
      Click an example to append it to the Message ID field. Most workflows fetch the id
      that arrived from <code>gmail-trigger</code> or <code>gmail-search</code> upstream.
    </p>
    <div class="gf-chip-row">
      {#each templateExamples as ex (ex.value)}
        <button
          type="button"
          class="gf-chip"
          title={ex.value}
          onclick={() => appendTemplate(ex.value)}
        >{ex.label}</button>
      {/each}
    </div>
  </details>

  <!-- Message ID -->
  <section class="gf-sec">
    <header class="gf-sec-hdr">
      <span class="sr-label-tight">Message ID</span>
      {#if !messageIdRaw.trim()}<span class="gf-warn">⚠ required</span>{/if}
    </header>
    <label class="gf-field">
      <span class="gf-label">Gmail message id (template-aware)</span>
      <textarea
        class="gf-code"
        rows="2"
        spellcheck="false"
        placeholder={`{{trigger.output.messageId}}`}
        value={messageIdRaw}
        oninput={(e) => set('messageId', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="gf-hint">
        Templates: <code>{`{{input.field}}`}</code>,
        <code>{`{{trigger.output.messageId}}`}</code>,
        <code>{`{{nodes.<id>.output.messages[0].id}}`}</code>.
        Output: full headers, plain-text body, HTML body, and attachment metadata.
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="gf-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="gf-code"
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
  .gf { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .gf-sec { display: flex; flex-direction: column; gap: 8px; }
  .gf-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .gf-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gf-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gf-hint { font-size: 11px; color: var(--text-ghost); margin: 0; }
  .gf-hint code, .gf-label code { font-size: 11px; color: var(--text-muted); }
  .gf-hint a { color: var(--accent); text-decoration: none; }
  .gf-hint a:hover { text-decoration: underline; }

  .gf-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .gf-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }
  .gf-info {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-muted);
  }

  .gf-helpers {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .gf-helpers[open] { padding-bottom: 10px; }
  .gf-helpers summary { cursor: pointer; padding: 2px 0; }
  .gf-helpers > .gf-hint { margin-top: 6px; }

  .gf-chip-row {
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .gf-chip {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .gf-chip:hover {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .gf-code {
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
  .gf-code:focus { border-color: var(--text-muted); }

  input[type='text'], input[type='number'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='number']:focus, select:focus, textarea:focus {
    border-color: var(--text-muted);
  }

  .gf-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gf-raw summary { cursor: pointer; }
</style>
