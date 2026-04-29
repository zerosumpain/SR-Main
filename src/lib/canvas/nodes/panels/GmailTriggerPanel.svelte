<script lang="ts" module>
  // Module-scoped caches so re-mounting the panel doesn't re-fetch the
  // accounts list, or the watches-per-account list, on every drawer open.
  type GmailAccount = {
    id: number;
    email: string;
    status?: string | null;
  };
  type GmailWatch = {
    id: number;
    accountId: number;
    label: string;
    query: string;
    enabled?: boolean;
  };

  let accountsPromise: Promise<GmailAccount[]> | null = null;
  const watchesPromises = new Map<number, Promise<GmailWatch[]>>();

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
          accountsPromise = null;
          console.warn('[GmailTriggerPanel] failed to load /api/gmail/accounts', err);
          return [];
        });
    }
    return accountsPromise;
  }

  function loadWatches(accountId: number): Promise<GmailWatch[]> {
    if (!accountId) return Promise.resolve([]);
    const cached = watchesPromises.get(accountId);
    if (cached) return cached;
    const p = fetch(`/api/gmail/accounts/${accountId}/watches`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows): GmailWatch[] => {
        if (!Array.isArray(rows)) return [];
        return rows
          .filter((r) => r && typeof r === 'object')
          .map((r) => {
            const o = r as Record<string, unknown>;
            return {
              id: Number(o.id ?? 0),
              accountId: Number(o.accountId ?? 0),
              label: String(o.label ?? ''),
              query: String(o.query ?? ''),
              enabled: Boolean(o.enabled ?? true),
            };
          })
          .filter((r) => r.id > 0);
      })
      .catch((err) => {
        watchesPromises.delete(accountId);
        console.warn(`[GmailTriggerPanel] failed to load watches for account ${accountId}`, err);
        return [] as GmailWatch[];
      });
    watchesPromises.set(accountId, p);
    return p;
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

  // ---------- Watch picker ----------------------------------------------

  const rawWatchId = config.watchId;
  const watchId = $derived(
    rawWatchId == null || rawWatchId === '' ? 0 : Number(rawWatchId) || 0,
  );

  let watches = $state<GmailWatch[]>([]);
  let watchesLoaded = $state(false);
  let watchesError = $state(false);

  $effect(() => {
    const id = accountId;
    let cancelled = false;
    watchesLoaded = false;
    watchesError = false;
    watches = [];
    if (!id) {
      watchesLoaded = true;
      return () => {
        cancelled = true;
      };
    }
    loadWatches(id).then((rows) => {
      if (cancelled) return;
      watches = rows;
      watchesLoaded = true;
      watchesError = rows.length === 0;
    });
    return () => {
      cancelled = true;
    };
  });

  function setWatchId(v: number) {
    // Picking a watch always wins over the freeform query — clear `query`
    // so the executor / dispatcher don't see conflicting hints.
    const next = { ...config, watchId: v || null };
    if ('query' in next) delete (next as Record<string, unknown>).query;
    onChange(next);
  }

  // ---------- Freeform query (advanced) ---------------------------------

  const freeformQuery = $derived(String(config.query ?? ''));
  // Auto-open the advanced section if the config already has a query set.
  let advancedOpen = $state(Boolean(freeformQuery.trim()));

  function setFreeformQuery(q: string) {
    // Setting the freeform query supersedes the watchId selection — clear
    // watchId so dispatch falls through to "any message matching `q`".
    const next: Record<string, unknown> = { ...config, query: q };
    if (q.trim()) {
      next.watchId = null;
    }
    onChange(next);
  }

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` referenced only for typings; canvas-level preview header
  // (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does" line.
  void definition;
</script>

<div class="gt">
  <!-- Account picker -->
  <section class="gt-sec">
    <header class="gt-sec-hdr">
      <span class="sr-label-tight">Gmail account</span>
      {#if !accountId}<span class="gt-warn">⚠ pick an account</span>{/if}
    </header>
    {#if !accountsLoaded}
      <p class="gt-empty">Loading accounts…</p>
    {:else if accountsError || accounts.length === 0}
      <label class="gt-field">
        <span class="gt-label">Account ID</span>
        <input
          type="number"
          min="0"
          step="1"
          value={accountId || ''}
          placeholder="e.g. 1"
          oninput={(e) =>
            set('accountId', Number((e.currentTarget as HTMLInputElement).value) || 0)}
        />
        <span class="gt-hint">
          Couldn’t load the accounts list. Connect or inspect accounts at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
        </span>
      </label>
    {:else}
      <label class="gt-field">
        <span class="gt-label">Account</span>
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
        <span class="gt-hint">
          Manage connected accounts at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
        </span>
      </label>
    {/if}
  </section>

  <!-- Watch picker -->
  <section class="gt-sec">
    <header class="gt-sec-hdr">
      <span class="sr-label-tight">Watch</span>
      {#if accountId && watchesLoaded && watches.length > 0}
        <span class="gt-sec-meta">{watches.length} {watches.length === 1 ? 'watch' : 'watches'}</span>
      {/if}
    </header>
    {#if !accountId}
      <p class="gt-empty">Pick an account first to load its watches.</p>
    {:else if !watchesLoaded}
      <p class="gt-empty">Loading watches…</p>
    {:else if watchesError || watches.length === 0}
      <label class="gt-field">
        <span class="gt-label">Watch ID</span>
        <input
          type="number"
          min="0"
          step="1"
          value={watchId || ''}
          placeholder="e.g. 3 (blank = any watch on this account)"
          oninput={(e) =>
            setWatchId(Number((e.currentTarget as HTMLInputElement).value) || 0)}
        />
        <span class="gt-hint">
          Couldn’t load this account’s watches. Configure them at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
          Leave blank to fire on any watch for this account.
        </span>
      </label>
    {:else}
      <label class="gt-field">
        <span class="gt-label">Watch</span>
        <select
          value={String(watchId || 0)}
          onchange={(e) =>
            setWatchId(Number((e.currentTarget as HTMLSelectElement).value) || 0)}
        >
          <option value="0">— any watch on this account —</option>
          {#each watches as w (w.id)}
            <option value={String(w.id)}>{w.label} — {w.query}</option>
          {/each}
        </select>
        <span class="gt-hint">
          Manage watches at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
        </span>
      </label>
    {/if}
  </section>

  <!-- Advanced freeform query -->
  <details class="gt-adv" bind:open={advancedOpen}>
    <summary><span class="sr-label-tight">Advanced — match by query instead of watch</span></summary>
    <section class="gt-sec gt-adv-body">
      <label class="gt-field">
        <span class="gt-label">Gmail query</span>
        <textarea
          class="gt-code"
          rows="3"
          spellcheck="false"
          placeholder={`from:alerts@example.com is:unread`}
          value={freeformQuery}
          oninput={(e) => setFreeformQuery((e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="gt-hint">
          If set, the trigger fires on any message matching this query, not via a configured watch.
          Setting this clears the selected watch above.
        </span>
      </label>
    </section>
  </details>

  <!-- On failure (limited applicability for triggers) -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />
  <p class="gt-note">
    Triggers fire externally — On-failure mostly relevant if downstream nodes throw.
  </p>

  <!-- Advanced raw JSON -->
  <details class="gt-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="gt-code"
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
  .gt { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .gt-sec { display: flex; flex-direction: column; gap: 8px; }
  .gt-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .gt-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .gt-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gt-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gt-hint { font-size: 11px; color: var(--text-ghost); }
  .gt-hint code, .gt-label code { font-size: 11px; color: var(--text-muted); }
  .gt-hint a { color: var(--accent); text-decoration: none; }
  .gt-hint a:hover { text-decoration: underline; }

  .gt-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .gt-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }
  .gt-note {
    margin: -4px 0 0;
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
  }

  .gt-code {
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
  .gt-code:focus { border-color: var(--text-muted); }

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

  .gt-adv {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
  }
  .gt-adv summary { cursor: pointer; padding: 2px 0; }
  .gt-adv-body { margin-top: 8px; }

  .gt-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gt-raw summary { cursor: pointer; }
</style>
