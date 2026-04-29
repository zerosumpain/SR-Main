<script lang="ts" module>
  // Module-scoped cache so re-mounting the panel doesn't re-fetch the
  // accounts list on every open of the config drawer.
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
          console.warn('[GmailSearchPanel] failed to load /api/gmail/accounts', err);
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

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Account picker --------------------------------------------

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
    {#if !accountsLoaded}
      <p class="gx-empty">Loading accounts…</p>
    {:else if accountsError || accounts.length === 0}
      <label class="gx-field">
        <span class="gx-label">Account ID</span>
        <input
          type="number"
          min="0"
          step="1"
          value={accountId || ''}
          placeholder="e.g. 1"
          oninput={(e) =>
            set('accountId', Number((e.currentTarget as HTMLInputElement).value) || 0)}
        />
        <span class="gx-hint">
          Couldn’t load the accounts list. Connect or inspect accounts at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
        </span>
      </label>
    {:else}
      <label class="gx-field">
        <span class="gx-label">Account</span>
        <select
          value={String(accountId || 0)}
          onchange={(e) =>
            set('accountId', Number((e.currentTarget as HTMLSelectElement).value) || 0)}
        >
          <option value="0">— pick an account —</option>
          {#each accounts as a (a.id)}
            <option value={String(a.id)}>{a.email} (#{a.id})</option>
          {/each}
        </select>
        <span class="gx-hint">
          Manage connected accounts at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
        </span>
      </label>
    {/if}
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
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gx-hint { font-size: 11px; color: var(--text-ghost); }
  .gx-hint code, .gx-label code { font-size: 11px; color: var(--text-muted); }
  .gx-hint a { color: var(--accent); text-decoration: none; }
  .gx-hint a:hover { text-decoration: underline; }

  .gx-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .gx-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }

  .gx-code {
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
    font-family: var(--font-mono); font-size: 11px;
    cursor: pointer;
  }
  .gx-chip:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .gx-chip code { font-size: 11px; color: inherit; }

  .gx-toggle {
    display: inline-flex; align-items: center; gap: 8px;
    cursor: pointer;
  }
  .gx-toggle input[type='checkbox'] { width: auto; cursor: pointer; }
  .gx-toggle-label {
    font-size: 12px; color: var(--text-primary);
  }

  .gx-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gx-raw summary { cursor: pointer; }
</style>
