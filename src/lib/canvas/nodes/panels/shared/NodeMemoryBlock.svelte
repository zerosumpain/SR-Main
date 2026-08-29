<script lang="ts">
  // What this node remembers between runs, with a per-key Clear — so you can
  // reset a workflow while debugging without going near pgweb.
  //
  // Everything the engine remembers lives in one table keyed by
  // (workflowId, key), never by node, so two nodes can share one key. The
  // button therefore always names the key it is about to wipe rather than
  // saying "Clear memory".
  //
  // Two-click arm/confirm, matching the canvas-wide Memory panel
  // (/jkai/canvas/[slug] — `memoryConfirmKey`): no modal, no window.confirm.
  //
  // Templated keys (`cursor_{{input.accountId}}`) only resolve at run time. We
  // never prefix-guess — same as <StoreKeyPicker>, we say so and list the
  // workflow's real keys so the user picks one explicitly.

  import { sharedMemoryKeyWarning } from '$lib/canvas/node-memory-keys';

  interface MemoryEntry {
    key: string;
    value: string;
    truncated: boolean;
    itemCount: number | null;
    updatedAt: string | null;
  }

  let {
    workflowId,
    keys,
    label = 'Remembered between runs',
    hint,
  }: {
    workflowId?: string;
    /** Store keys this node reads/writes. May contain `{{templates}}`. */
    keys: string[];
    label?: string;
    hint?: string;
  } = $props();

  let entries = $state<MemoryEntry[] | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  /** The key currently awaiting a "Confirm clear". */
  let confirmKey = $state<string | null>(null);
  /** Outcome of the last clear, including the honest "there was nothing there". */
  let status = $state<string | null>(null);

  const literalKeys = $derived(keys.filter((k) => k.trim() && !k.includes('{{')));
  const templatedKeys = $derived(keys.filter((k) => k.includes('{{')));

  async function load() {
    // No key configured → the template says so and there is nothing to filter
    // to, so don't spend a request whose result we'd throw away.
    //
    // `error !== null` is the belt-and-braces half: the $effect below depends on
    // `loading`, so a failed load flipping it back to false re-enters here with
    // `entries` still null. Retry is the ↻ button, not an unbounded loop.
    if (!workflowId || keys.length === 0 || loading || entries !== null || error !== null) return;
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/workflows/${workflowId}/data-store`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      entries = (body.keys ?? []) as MemoryEntry[];
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void load(); });

  function refresh() {
    entries = null;
    error = null;
    confirmKey = null;
    status = null;
    void load();
  }

  // The keys this node names, plus — only when a templated key is in play —
  // every other key the workflow actually holds, so a dynamic key is still
  // clearable by explicit choice.
  const rows = $derived.by(() => {
    const list = literalKeys.map((k) => ({ key: k, entry: entries?.find((e) => e.key === k) }));
    if (templatedKeys.length > 0 && entries) {
      const named = new Set(list.map((r) => r.key));
      for (const e of entries) if (!named.has(e.key)) list.push({ key: e.key, entry: e });
    }
    return list;
  });

  async function clear(key: string) {
    // First click on "Clear" arms the confirm; the confirm button re-invokes.
    if (confirmKey !== key) {
      confirmKey = key;
      return;
    }
    confirmKey = null;
    status = null;
    if (!workflowId) return;
    // Item count as it stood a moment ago — the endpoint reports rows removed,
    // which is the honest "was there anything at all", not how much was in it.
    const heldItems = rows.find((r) => r.key === key)?.entry?.itemCount ?? null;
    try {
      const res = await fetch(
        `/api/workflows/${workflowId}/data-store/${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json().catch(() => ({}));
      const deleted = typeof body?.deleted === 'number' ? body.deleted : null;
      status =
        deleted === 0
          ? `Nothing to clear — ${key} held nothing.`
          : `Cleared ${key}${heldItems !== null ? ` — ${heldItems} item${heldItems === 1 ? '' : 's'} gone` : ''}.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return;
    }
    entries = null;
    await load();
  }

  function when(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : 'never';
  }
</script>

<section class="nmb">
  <header class="nmb-hdr">
    <span class="sr-label-tight">{label}</span>
    <span class="nmb-meta">workflow memory</span>
  </header>
  {#if hint}<p class="nmb-hint">{hint}</p>{/if}

  {#if !workflowId}
    <p class="nmb-empty">Save the canvas first — memory is scoped to a saved workflow.</p>
  {:else if keys.length === 0}
    <p class="nmb-empty">No key configured yet, so this node remembers nothing.</p>
  {:else if loading && entries === null}
    <p class="nmb-empty">Loading…</p>
  {:else if error}
    <p class="nmb-empty nmb-err">Couldn't load memory: {error}</p>
    <button type="button" class="nmb-mini" onclick={refresh}>↻ Retry</button>
  {:else}
    {#each templatedKeys as t (t)}
      <p class="nmb-hint">
        <code>{t}</code> is a templated key — resolved at run time, so it can't be matched here.
        Pick the actual key below.
      </p>
    {/each}

    {#each rows as row (row.key)}
      {@const warning = sharedMemoryKeyWarning(row.key)}
      <div class="nmb-entry">
        <div class="nmb-entry-hd">
          <code class="nmb-key">{row.key}</code>
          <span class="nmb-meta">
            {#if !row.entry}
              nothing stored
            {:else}
              {#if row.entry.itemCount !== null}{row.entry.itemCount} item{row.entry.itemCount === 1 ? '' : 's'} · {/if}{when(row.entry.updatedAt)}
            {/if}
          </span>
        </div>
        {#if row.entry}
          <pre class="nmb-val">{row.entry.value}{row.entry.truncated ? '…' : ''}</pre>
          {#if warning}<p class="nmb-warn">⚠ {warning}</p>{/if}
          <div class="nmb-actions">
            {#if confirmKey === row.key}
              <button type="button" class="nmb-clear nmb-clear-confirm" onclick={() => void clear(row.key)}>
                Confirm clear {row.key}
              </button>
              <button type="button" class="nmb-clear" onclick={() => { confirmKey = null; }}>Cancel</button>
            {:else}
              <button type="button" class="nmb-clear" onclick={() => void clear(row.key)}>Clear {row.key}</button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}

    {#if rows.length === 0}
      <p class="nmb-empty">This workflow holds no memory yet — it appears after the first run.</p>
    {/if}
    {#if status}<p class="nmb-status" role="status">{status}</p>{/if}
    <button type="button" class="nmb-mini" onclick={refresh} title="Refresh from server">↻ Refresh</button>
  {/if}
</section>

<style>
  .nmb {
    display: flex; flex-direction: column; gap: 8px;
    border: 1px solid var(--card-border);
    padding: 8px 10px;
  }
  .nmb-hdr { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .nmb-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .nmb-hint { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); line-height: 1.4; }
  .nmb-hint code { font-size: var(--fs-label); color: var(--text-muted); }
  .nmb-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .nmb-empty.nmb-err { color: var(--status-error, #c0392b); }

  .nmb-entry { display: flex; flex-direction: column; gap: 6px; }
  .nmb-entry + .nmb-entry { border-top: 1px dashed var(--card-border); padding-top: 8px; }
  .nmb-entry-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .nmb-key {
    font-family: var(--font-code); font-size: var(--fs-label);
    color: var(--text-primary);
    word-break: break-all;
  }

  .nmb-val {
    margin: 0;
    padding: 6px 8px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-code);
    font-size: var(--fs-label);
    color: var(--text-primary);
    line-height: 1.4;
    max-height: 120px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .nmb-warn {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--status-error, #c0392b);
    line-height: 1.4;
  }

  .nmb-status {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    line-height: 1.4;
    word-break: break-all;
  }

  .nmb-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .nmb-clear, .nmb-mini {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 3px 10px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    cursor: pointer;
  }
  .nmb-clear:hover, .nmb-mini:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .nmb-clear-confirm {
    color: var(--status-error, #c0392b);
    border-color: var(--status-error, #c0392b);
  }
  .nmb-mini { align-self: flex-start; border-style: dashed; }
</style>
