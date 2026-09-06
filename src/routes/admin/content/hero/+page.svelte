<svelte:head><title>Hero — Admin</title></svelte:head>

<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import HeroBackgroundControls from '$lib/components/admin/HeroBackgroundControls.svelte';
  import type { ActionData, PageData } from './$types';
  import type { GeneratedRow } from '$lib/landing/hero-titles-service';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let style = $state('');
  let headlineWords = $state(3);
  let strapWords = $state(22);
  let variantsPerBucket = $state(1);

  let phase = $state<'idle' | 'generating' | 'preview'>('idle');
  let progress = $state({ done: 0, total: 0 });
  let preview = $state<GeneratedRow[]>([]);
  let saveMode = $state<'replace' | 'append'>('replace');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const LS_KEY = 'admin-hero-settings';
  const plannedBatches = $derived(Math.ceil((150 * variantsPerBucket) / 50));
  const failedCount = $derived(preview.filter((r) => r.failed).length);

  onMount(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.style === 'string') style = s.style;
        if (typeof s.headlineWords === 'number') headlineWords = s.headlineWords;
        if (typeof s.strapWords === 'number') strapWords = s.strapWords;
        if (typeof s.variantsPerBucket === 'number')
          variantsPerBucket = s.variantsPerBucket;
      }
    } catch {
      /* ignore corrupt localStorage */
    }
  });

  function persistSettings() {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ style, headlineWords, strapWords, variantsPerBucket }),
      );
    } catch {
      /* ignore */
    }
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return 'never';
    return new Date(iso).toLocaleString('en-GB');
  }

  async function generate() {
    error = null;
    preview = [];
    phase = 'generating';
    progress = { done: 0, total: plannedBatches };
    persistSettings();
    const params = { style, headlineWords, strapWords, variantsPerBucket };
    try {
      let batchIndex = 0;
      let totalBatches = 1;
      do {
        const res = await fetch('/admin/content/hero/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...params, batchIndex }),
        });
        if (!res.ok)
          throw new Error(`Batch ${batchIndex + 1} failed (${res.status})`);
        const payload = await res.json();
        totalBatches = payload.totalBatches;
        preview = [...preview, ...payload.rows];
        batchIndex += 1;
        progress = { done: batchIndex, total: totalBatches };
      } while (batchIndex < totalBatches);
      phase = 'preview';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Generation failed';
      phase = 'idle';
      preview = [];
    }
  }

  async function save() {
    busy = true;
    error = null;
    try {
      const res = await fetch('/admin/content/hero/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: saveMode, rows: preview }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Save failed (${res.status})`);
      }
      preview = [];
      phase = 'idle';
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Save failed';
    } finally {
      busy = false;
    }
  }

  function discard() {
    preview = [];
    phase = 'idle';
    error = null;
  }

  async function deleteRow(id: number) {
    busy = true;
    error = null;
    try {
      const res = await fetch('/admin/content/hero/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Delete failed';
    } finally {
      busy = false;
    }
  }

  async function clearPool() {
    if (!confirm('Delete every saved hero entry? This cannot be undone.')) return;
    busy = true;
    error = null;
    try {
      const res = await fetch('/admin/content/hero/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error(`Clear failed (${res.status})`);
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Clear failed';
    } finally {
      busy = false;
    }
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Landing page"
    title="hero"
    sub="Generate the copy the landing hero snaps to. {data.count} entries saved; last generated {fmtDate(data.generatedAt)}."
  />

  <HeroBackgroundControls settings={data.backgroundSettings} asset={data.backgroundAsset} result={form} />

  {#if error}
    <div class="banner banner-error">{error}</div>
  {/if}

  <section class="controls">
    <div class="nm-field">
      <span class="sr-label-tight">Style influence</span>
      <textarea
        class="nm-textarea"
        rows="3"
        placeholder="Tone, themes, references to steer the copy. Leave blank for the default voice."
        bind:value={style}
        disabled={phase === 'generating'}
      ></textarea>
    </div>

    <div class="ctl-row">
      <div class="nm-field">
        <span class="sr-label-tight">
          Headline length — {headlineWords} word{headlineWords === 1 ? '' : 's'} max
        </span>
        <input
          type="range"
          class="nm-range"
          min="1"
          max="6"
          step="1"
          bind:value={headlineWords}
          disabled={phase === 'generating'}
        />
      </div>
      <div class="nm-field">
        <span class="sr-label-tight">Strap length — {strapWords} words max</span>
        <input
          type="range"
          class="nm-range"
          min="10"
          max="40"
          step="1"
          bind:value={strapWords}
          disabled={phase === 'generating'}
        />
      </div>
      <div class="nm-field ctl-narrow">
        <span class="sr-label-tight">Variants per bucket</span>
        <input
          type="number"
          class="nm-text-input"
          min="1"
          max="5"
          step="1"
          bind:value={variantsPerBucket}
          disabled={phase === 'generating'}
        />
      </div>
    </div>

    <div class="ctl-actions">
      <button
        class="nm-save-btn"
        onclick={generate}
        disabled={phase === 'generating'}
      >
        {phase === 'generating'
          ? `Generating — batch ${progress.done}/${progress.total}…`
          : 'Generate preview'}
      </button>
      <span class="hint">
        {150 * variantsPerBucket} entries · {plannedBatches} batch{plannedBatches ===
        1
          ? ''
          : 'es'} of up to 50
      </span>
    </div>
  </section>

  {#if phase === 'preview'}
    <section class="panel">
      <div class="panel-bar">
        <span class="panel-title">
          Preview — {preview.length} entries{failedCount > 0
            ? `, ${failedCount} fell back`
            : ''}
        </span>
        <div class="save-controls">
          <label class="save-mode">
            <input
              type="radio"
              name="savemode"
              value="replace"
              bind:group={saveMode}
            />
            Replace pool
          </label>
          <label class="save-mode">
            <input
              type="radio"
              name="savemode"
              value="append"
              bind:group={saveMode}
            />
            Append to pool
          </label>
          <button class="nm-save-btn" onclick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button class="nm-btn-ghost" onclick={discard} disabled={busy}>
            Discard
          </button>
        </div>
      </div>
      <div class="nm-table-scroll">
        <table class="nm-table hero-table">
          <thead>
            <tr>
              <th>HR / Steps / Temp</th>
              <th>Headline</th>
              <th>Strap template</th>
            </tr>
          </thead>
          <tbody>
            {#each preview as row, i (i)}
              <tr class:row-failed={row.failed}>
                <td class="cell-meta">
                  {row.hrCentroid} / {row.stepsCentroid.toLocaleString('en-GB')} /
                  {row.tempCentroid}°
                  {#if row.failed}<span class="nm-pill" data-state="warn">fallback</span>{/if}
                </td>
                <td class="cell-headline">
                  {row.primary} <span class="ghost-text">{row.ghost}</span>
                </td>
                <td class="cell-strap">{row.strapTemplate}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {:else}
    <section class="panel">
      <div class="panel-bar">
        <span class="panel-title">Saved pool — {data.count} entries</span>
        {#if data.count > 0}
          <button class="nm-btn-ghost" onclick={clearPool} disabled={busy}>
            Clear pool
          </button>
        {/if}
      </div>
      {#if data.rows.length === 0}
        <p class="nm-empty">
          No entries yet. Generate a batch above to populate the pool.
        </p>
      {:else}
        <div class="nm-table-scroll">
          <table class="nm-table hero-table">
            <thead>
              <tr>
                <th>HR / Steps / Temp</th>
                <th>Headline</th>
                <th>Strap template</th>
                <th>Style</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each data.rows as row (row.id)}
                <tr>
                  <td class="cell-meta">
                    {row.hrCentroid} / {row.stepsCentroid.toLocaleString('en-GB')} /
                    {row.tempCentroid}°
                  </td>
                  <td class="cell-headline">
                    {row.primary} <span class="ghost-text">{row.ghost}</span>
                  </td>
                  <td class="cell-strap">{row.strapTemplate}</td>
                  <td class="cell-style">{row.style ?? '—'}</td>
                  <td class="cell-del">
                    <button
                      class="nm-link-btn danger btn-del"
                      onclick={() => deleteRow(row.id)}
                      disabled={busy}
                      aria-label="Delete entry"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
</PageWrap>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    margin-bottom: 2rem;
  }
  .ctl-row {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }
  .ctl-row > .nm-field {
    flex: 1;
    min-width: 200px;
  }
  .ctl-narrow { flex: 0 0 140px; }
  .ctl-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .panel { margin-top: 1rem; }
  .panel-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .panel-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-secondary);
  }
  .save-controls {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
  }
  .save-mode {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .save-mode input[type='radio'] { accent-color: var(--accent); }

  /* hero-table adds tighter cell padding + special row/cell tints on top of .nm-table */
  .hero-table { font-size: var(--fs-label-xs); }
  .hero-table tbody tr.row-failed {
    background: color-mix(in srgb, var(--error) 8%, transparent);
  }
  .cell-meta { white-space: nowrap; color: var(--text-muted); }
  .cell-headline { font-family: var(--font-body); font-weight: 600; color: var(--text-primary); white-space: nowrap; }
  .ghost-text { color: var(--text-ghost); }
  .cell-strap { color: var(--text-secondary); }
  .cell-style {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell-del { text-align: right; }
  .btn-del { font-size: var(--fs-nav); line-height: 1; padding: 2px 6px; }
</style>
