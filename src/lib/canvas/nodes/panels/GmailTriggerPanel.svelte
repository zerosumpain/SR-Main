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

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Account picker --------------------------------------------
  // ResourcePicker works with string values; we round-trip via String/Number
  // because the executor / dispatcher treat accountId as a number.

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

  // ---------- Watch picker ----------------------------------------------
  // Powered by the shared ResourcePicker. The fetcher closes over the live
  // accountId so the dropdown always reflects the currently selected
  // account (DataStorePanel uses the same workflowId-capture pattern).
  // ResourcePicker re-runs its loader whenever its identity changes, and
  // because we re-create `watchesFetcher` via `$derived` whenever
  // accountId changes, the picker re-fetches transparently.

  const watchId = $derived(
    config.watchId == null || config.watchId === '' ? 0 : Number(config.watchId) || 0,
  );
  // ResourcePicker speaks strings; "0" is our sentinel for "any watch".
  const watchValue = $derived(String(watchId || 0));

  const watchesFetcher = $derived.by(() => {
    const id = accountId;
    return async (): Promise<Array<{ value: string; label: string; meta?: string }>> => {
      if (!id) return [];
      const res = await fetch(`/api/gmail/accounts/${id}/watches`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      const items = rows
        .filter((r) => r && typeof r === 'object')
        .map((r) => {
          const o = r as Record<string, unknown>;
          const wid = Number(o.id ?? 0);
          const lbl = String(o.label ?? '').trim();
          const q = String(o.query ?? '').trim();
          const display = lbl || q || `watch ${wid}`;
          const metaQ = q && q.length > 40 ? `${q.slice(0, 37)}…` : q;
          return { value: String(wid), label: display, meta: metaQ || undefined };
        })
        .filter((r) => r.value !== '0');
      // Synthetic "any watch" entry preserves the previous UX where
      // leaving watchId unset matches every watch on this account.
      return [{ value: '0', label: 'any watch on this account' }, ...items];
    };
  });

  function setWatchValue(next: string) {
    const n = next === '' ? 0 : Number(next) || 0;
    // Picking a watch always wins over the freeform query — clear `query`
    // so the executor / dispatcher don't see conflicting hints.
    const out: Record<string, unknown> = { ...config, watchId: n || null };
    if ('query' in out) delete out.query;
    onChange(out);
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
    <ResourcePicker
      label="Account"
      value={accountValue}
      fetcher={fetchGmailAccountOptions}
      onChange={setAccount}
      placeholder="pick an account"
      emptyHint="No connected accounts — connect one at /admin/connections/gmail."
    />
    <span class="gt-hint">
      Manage connected accounts at
      <a href="/admin/connections/gmail" target="_blank" rel="noreferrer"><code>/admin/connections/gmail</code></a>.
    </span>
  </section>

  <!-- Watch picker -->
  <section class="gt-sec">
    <header class="gt-sec-hdr">
      <span class="sr-label-tight">Watch</span>
    </header>
    {#if !accountId}
      <p class="gt-empty">Pick an account first to load its watches.</p>
    {:else}
      {#key accountId}
        <ResourcePicker
          label="Watch"
          value={watchValue}
          fetcher={watchesFetcher}
          onChange={setWatchValue}
          placeholder="any watch on this account"
          emptyHint="No watches configured — set them up at /admin/connections/gmail."
        />
      {/key}
      <span class="gt-hint">
        Manage watches at
        <a href="/admin/connections/gmail" target="_blank" rel="noreferrer"><code>/admin/connections/gmail</code></a>.
        Pick "any watch" to fire on every watch attached to this account.
      </span>
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
  .gt-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .gt-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gt-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gt-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .gt-hint code, .gt-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .gt-hint a { color: var(--accent); text-decoration: none; }
  .gt-hint a:hover { text-decoration: underline; }

  .gt-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .gt-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
  }
  .gt-note {
    margin: -4px 0 0;
    font-size: var(--fs-label);
    color: var(--text-ghost);
    font-style: italic;
  }

  .gt-code {
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
