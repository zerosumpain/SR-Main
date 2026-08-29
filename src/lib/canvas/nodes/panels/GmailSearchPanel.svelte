<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';
  import { fetchGmailAccountOptions } from './shared/gmailAccounts';

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

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Account picker --------------------------------------------
  // ResourcePicker works with string values; we round-trip via String/Number
  // because the executor expects accountId as a number. Templated values
  // (e.g. `{{input.accountId}}`) round-trip as strings.

  const accountId = $derived(Number(config.accountId ?? 0));
  const accountValue = $derived(
    typeof config.accountId === 'string' && config.accountId.includes('{{')
      ? config.accountId
      : accountId ? String(accountId) : '',
  );

  function setAccount(next: string) {
    if (!next) { set('accountId', 0); return; }
    if (next.includes('{{')) { set('accountId', next); return; }
    const n = Number(next);
    set('accountId', Number.isFinite(n) ? n : 0);
  }

  // ---------- Query state ------------------------------------------------

  const queryRaw = $derived(String(config.query ?? ''));

  function appendFragment(frag: string) {
    const current = queryRaw;
    const sep = current && !current.endsWith(' ') ? ' ' : '';
    set('query', `${current}${sep}${frag}`);
  }

  const QUERY_HELPERS: Array<{ frag: string; hint: string }> = [
    { frag: 'is:unread', hint: 'only unread messages' },
    { frag: 'from:', hint: 'sender filter — append an address' },
    { frag: 'subject:', hint: 'subject contains — append text' },
    { frag: 'has:attachment', hint: 'with attachments' },
    { frag: 'newer_than:7d', hint: 'last 7 days' },
    { frag: 'label:Inbox', hint: 'in a specific label' },
  ];

  // ---------- Max results ------------------------------------------------

  const maxResults = $derived(Number(config.maxResults ?? 50));

  // ---------- Fetch full messages ---------------------------------------

  const fetchFullMessages = $derived(Boolean(config.fetchFullMessages));

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="gx">
  <!-- Account picker -->
  <section class="gx-sec">
    <header class="gx-sec-hdr">
      <span class="sr-label-tight">Gmail account</span>
      {#if !accountId}<span class="gx-warn">⚠ pick an account</span>{/if}
    </header>
    <ResourcePicker
      label="Account"
      value={accountValue}
      fetcher={fetchGmailAccountOptions}
      onChange={setAccount}
      placeholder="pick an account"
      emptyHint="No connected accounts — connect one at /admin/connections/gmail."
    />
    <span class="gx-hint">
      Manage connected accounts at
      <a href="/admin/connections/gmail" target="_blank" rel="noreferrer"><code>/admin/connections/gmail</code></a>.
    </span>
  </section>

  <!-- Query -->
  <section class="gx-sec">
    <header class="gx-sec-hdr"><span class="sr-label-tight">Query</span></header>
    <label class="gx-field">
      <span class="gx-label">Gmail search query</span>
      <textarea
        class="gx-code"
        rows="3"
        spellcheck="false"
        placeholder={`from:invoices@supplier.com subject:invoice newer_than:30d`}
        value={queryRaw}
        oninput={(e) => set('query', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="gx-hint">
        Gmail advanced search operators. Templates supported: <code>{`{{input.field}}`}</code>.
      </span>
    </label>

    <details class="gx-helpers">
      <summary><span class="sr-label-tight">Query builder helpers</span></summary>
      <p class="gx-hint gx-helpers-intro">Click a fragment to append it to the query.</p>
      <div class="gx-chip-row">
        {#each QUERY_HELPERS as h (h.frag)}
          <button
            type="button"
            class="gx-chip"
            title={h.hint}
            onclick={() => appendFragment(h.frag)}
          ><code>{h.frag}</code></button>
        {/each}
      </div>
    </details>
  </section>

  <!-- Max results -->
  <section class="gx-sec">
    <header class="gx-sec-hdr"><span class="sr-label-tight">Limits</span></header>
    <label class="gx-field gx-field-narrow">
      <span class="gx-label">Max results</span>
      <input
        type="number"
        min="1"
        step="1"
        value={maxResults || ''}
        placeholder="50"
        oninput={(e) =>
          set('maxResults', Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 50))}
      />
      <span class="gx-hint">Maximum number of messages to return (default 50).</span>
    </label>
  </section>

  <!-- Fetch full messages -->
  <section class="gx-sec">
    <header class="gx-sec-hdr"><span class="sr-label-tight">Advanced</span></header>
    <label class="gx-toggle">
      <input
        type="checkbox"
        checked={fetchFullMessages}
        onchange={(e) => set('fetchFullMessages', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="gx-toggle-label">Fetch full message content</span>
    </label>
    <span class="gx-hint">
      If enabled, returns full body and attachments for each result (slower for large sets). When
      off, only message ids are returned — pair with <code>gmail-fetch</code> downstream for
      specific results.
    </span>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="gx-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="gx-code"
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
  .gx { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .gx-sec { display: flex; flex-direction: column; gap: 8px; }
  .gx-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .gx-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gx-field-narrow { max-width: 200px; }
  .gx-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gx-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .gx-hint code, .gx-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .gx-hint a { color: var(--accent); text-decoration: none; }
  .gx-hint a:hover { text-decoration: underline; }

  .gx-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .gx-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
  }

  .gx-code {
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
  .gx-code:focus { border-color: var(--text-muted); }

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

  .gx-helpers {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gx-helpers[open] { padding-bottom: 10px; }
  .gx-helpers summary { cursor: pointer; padding: 2px 0; }
  .gx-helpers-intro { margin: 4px 0 2px; }

  .gx-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .gx-chip {
    padding: 4px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    cursor: pointer;
  }
  .gx-chip:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .gx-chip code { font-size: var(--fs-label); color: inherit; }

  .gx-toggle {
    display: inline-flex; align-items: center; gap: 8px;
    cursor: pointer;
  }
  .gx-toggle input[type='checkbox'] { width: auto; cursor: pointer; }
  .gx-toggle-label {
    font-size: var(--fs-label); color: var(--text-primary);
  }

  .gx-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gx-raw summary { cursor: pointer; }
</style>
