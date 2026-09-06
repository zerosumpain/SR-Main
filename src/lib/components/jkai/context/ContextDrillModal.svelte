<script lang="ts">
  /**
   * The drill — what a double-click on the thread inspector opens.
   *
   * It draws a server-composed manifest (`drill.server.ts`) and knows nothing
   * about research runs, thoughts or memories beyond their shape: eyebrow,
   * title, facts, sections, actions. One modal in one register for every
   * segment of the column; a modal per lens would drift the way the rail's
   * three visual registers once did. The one embed is the intel `EntityCard`
   * for `entity` targets, as `KnowledgeGraphModal` does.
   *
   * Navigation is in place — a row with its own drill key replaces the
   * manifest and `← back` retraces the stack. Actions are declared by the
   * server and EXECUTED here: `link`, `ask`, `post`, `prompt` (one line of
   * text first), `confirm` (two clicks). After a post the manifest re-reads.
   */
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import EntityCard from '$lib/components/intel/EntityCard.svelte';
  import { commission } from '$lib/jkai/intel/entity-card-store';
  import { drillManifestSchema, type DrillAction, type DrillManifest } from '$lib/jkai/context-panel/types';
  import { relativeStamp } from '$lib/jkai/context-panel/drill';

  let {
    conversationId,
    target,
    onClose,
    onAsk,
    onRefresh,
  }: {
    conversationId: string;
    target: string;
    onClose: () => void;
    onAsk: (label: string, detail: string) => void;
    /** Something changed on the server; the rail decides what to reload. */
    onRefresh?: (what: 'panel' | 'graph' | 'memory') => void;
  } = $props();

  let manifest = $state<DrillManifest | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let current = $state<string>('');
  let stack = $state<string[]>([]);
  let seq = 0;

  async function load(key: string): Promise<void> {
    const mine = ++seq;
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/jkai/conversations/${conversationId}/context-panel/drill?target=${encodeURIComponent(key)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Drill returned ${res.status}`);
      const parsed = drillManifestSchema.safeParse(body);
      if (!parsed.success) throw new Error('The drill returned an invalid manifest');
      if (mine === seq) manifest = parsed.data;
    } catch (cause) {
      if (mine === seq) error = cause instanceof Error ? cause.message : 'Could not open this';
    } finally {
      if (mine === seq) loading = false;
    }
  }

  // The prop is the entry point; in-modal navigation is local. `current` is
  // written here, so the body runs untracked (an effect must not read its own write).
  $effect(() => {
    const key = target;
    untrack(() => {
      stack = [];
      current = key;
      void load(key);
    });
  });

  function navigate(key: string): void {
    if (key === current) return;
    stack = [...stack, current];
    current = key;
    confirming = null;
    prompting = null;
    void load(key);
  }

  function back(): void {
    const prev = stack[stack.length - 1];
    if (!prev) return;
    stack = stack.slice(0, -1);
    current = prev;
    confirming = null;
    prompting = null;
    void load(prev);
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  let confirming = $state<string | null>(null);
  let prompting = $state<string | null>(null);
  let promptText = $state('');
  let acting = $state<string | null>(null);
  let actionNote = $state<string | null>(null);

  async function post(action: DrillAction, extra: Record<string, unknown> = {}): Promise<void> {
    if (!action.endpoint || acting) return;
    acting = action.id;
    actionNote = null;
    try {
      const res = await fetch(action.endpoint, {
        method: action.method ?? 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(action.body ?? {}), ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) throw new Error(body?.error ?? body?.message ?? `${res.status}`);
      actionNote = summarise(action, body);
      onRefresh?.(action.refresh ?? 'panel');
      await load(current);
    } catch (cause) {
      actionNote = `${action.label}: ${cause instanceof Error ? cause.message : 'failed'}`;
    } finally {
      acting = null;
      confirming = null;
      prompting = null;
      promptText = '';
    }
  }

  /** One line saying what happened, from whatever the endpoint sent back. */
  function summarise(action: DrillAction, body: Record<string, unknown>): string {
    if (typeof body.memory === 'string') return `Remembered: ${body.memory}`;
    if (typeof body.verdict === 'string') return `Ruling: ${body.verdict}${typeof body.likelihood === 'number' ? ` (${Math.round(body.likelihood * 100)}%)` : ''}`;
    if (typeof body.status === 'string') return `Now ${body.status}`;
    if (typeof body.saved === 'number') return `${body.saved} saved`;
    return `${action.label} — done`;
  }

  function run(action: DrillAction): void {
    if (action.disabled) return;
    switch (action.kind) {
      case 'link':
        if (action.href) {
          onClose();
          void goto(action.href);
        }
        return;
      case 'ask':
        if (action.ask) {
          onAsk(action.ask.label, action.ask.detail);
          onClose();
        }
        return;
      case 'post':
        void post(action);
        return;
      case 'confirm':
        if (confirming === action.id) void post(action);
        else confirming = action.id;
        return;
      case 'prompt':
        if (prompting === action.id) {
          const text = promptText.trim();
          if (!text) return;
          void post(action, { [action.promptField ?? 'text']: text });
        } else {
          prompting = action.id;
          confirming = null;
          promptText = action.promptDefault ?? '';
        }
        return;
    }
  }

  // ── Entity embed ────────────────────────────────────────────────────────

  let busy = $state(false);
  async function onCommission(kind: string, payload: string, entityIds: string[]): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const result = await commission(kind, payload, entityIds);
      onClose();
      await goto(result.url);
    } catch (err) {
      console.error('[drill] commission failed:', err);
    } finally {
      busy = false;
    }
  }
  function focusEntity(entityId: string): void {
    navigate(`entity:${entityId}`);
  }

  // Portal to <body>: a LOCAL action, not $lib/canvas/portal, which re-appends
  // on destroy and resurrects the overlay.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (prompting || confirming) {
        prompting = null;
        confirming = null;
        return;
      }
      if (stack.length) back();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const isEntity = $derived(manifest?.kind === 'entity' && Boolean(manifest?.entityId));
  /** A 3D graph wants the room an entity does. */
  const isWide = $derived(isEntity || Boolean(manifest?.graph));

  // Three.js and Mapbox are loaded only by the drills that draw with them.
  const graphView = () => import('./DrillGraph3D.svelte');
  const mapView = () => import('./DrillMap.svelte');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="dm-backdrop" use:portal onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="dm-panel" class:wide={isWide} role="dialog" aria-modal="true" aria-label={manifest?.title ?? 'Detail'} onclick={(e) => e.stopPropagation()}>
    <header class="dm-hd">
      <div class="dm-hd-left">
        {#if stack.length}
          <button type="button" class="dm-chip" onclick={back} aria-label="Back">← back</button>
        {/if}
        <span class="dm-eyebrow">{manifest?.eyebrow ?? (loading ? 'opening…' : 'detail')}</span>
      </div>
      <div class="dm-hd-right">
        {#if manifest?.href}
          <a class="dm-chip" href={manifest.href} onclick={onClose}>open ↗</a>
        {/if}
        <button type="button" class="dm-chip" onclick={onClose} aria-label="Close">✕</button>
      </div>
    </header>

    {#if error}
      <div class="dm-body">
        <div class="dm-alert">
          <span class="dm-eyebrow">Could not open this</span>
          <p class="dm-note dm-err">{error}</p>
          <button type="button" class="dm-more" onclick={() => load(current)}>retry →</button>
        </div>
      </div>
    {:else if !manifest}
      <div class="dm-body"><p class="dm-empty">Opening…</p></div>
    {:else}
      <div class="dm-title-row">
        <h2 class="dm-title" title={manifest.title}>{manifest.title}</h2>
        {#if manifest.subtitle}<p class="dm-sub">{manifest.subtitle}</p>{/if}
      </div>

      {#if manifest.facts.length}
        <div class="dm-facts" style="--n: {Math.min(4, manifest.facts.length)}">
          {#each manifest.facts as f (f.label)}
            <div class="dm-fact" data-tone={f.tone ?? 'default'}>
              <span class="dm-fact-label">{f.label}</span>
              <strong class="dm-fact-val">{f.value}</strong>
              {#if f.detail}<small class="dm-fact-detail">{f.detail}</small>{/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if manifest.graph}
        <!-- The thread's entities in three dimensions — the intel page's own
             3D view, fed this thread and coloured by the rail's four classes. -->
        {#await graphView() then Graph}
          {#key manifest.target}
            <Graph.default graph={manifest.graph} onOpen={navigate} />
          {/key}
        {:catch err}
          <p class="dm-note dm-err">The 3D view could not load: {err instanceof Error ? err.message : String(err)}</p>
        {/await}
      {/if}
      {#if manifest.map && !isEntity}
        {#await mapView() then Map}
          {#key manifest.target}
            <Map.default map={manifest.map} onOpen={navigate} />
          {/key}
        {:catch err}
          <p class="dm-note dm-err">The map could not load: {err instanceof Error ? err.message : String(err)}</p>
        {/await}
      {/if}

      <div class="dm-body" class:split={isEntity}>
        {#if isEntity && manifest.entityId}
          <div class="dm-entity">
            <!-- Keyed so moving to a neighbour remounts rather than re-running
                 the card's own fetch effect against stale rendered state. -->
            {#key manifest.entityId}
              <EntityCard entityId={manifest.entityId} onFocus={focusEntity} onCommission={onCommission} />
            {/key}
          </div>
        {/if}

        <div class="dm-sections" class:dimmed={loading}>
          {#if manifest.map && isEntity}
            <!-- An entity that names a place: the map sits at the head of its
                 column, beside the card rather than above both. -->
            {#await mapView() then Map}
              {#key manifest.target}
                <Map.default map={manifest.map} height="240px" onOpen={navigate} />
              {/key}
            {/await}
          {/if}
          {#each manifest.sections as s (s.id)}
            <section class="dm-sec">
              <div class="dm-sec-hd">
                <span class="dm-eyebrow">{s.title}</span>
                {#if s.kind === 'rows'}<span class="dm-meta">{s.rows.length}</span>{/if}
              </div>
              {#if s.kind === 'prose'}
                <p class="dm-prose" data-tone={s.tone ?? 'default'}>{s.body}</p>
              {:else if s.kind === 'list'}
                <ol class="dm-list">
                  {#each s.items as item, i (i)}<li>{item}</li>{/each}
                </ol>
              {:else if s.rows.length === 0}
                <p class="dm-note">{s.empty ?? 'Nothing here.'}</p>
              {:else}
                <div class="dm-rows">
                  {#each s.rows as r (r.id)}
                    <div class="dm-row" data-tone={r.tone ?? 'default'}>
                      {#if r.external && r.href}
                        <!-- Off-site (a research source): a new tab, and the
                             modal stays where it is. -->
                        <a class="dm-row-main dm-row-link" href={r.href} target="_blank" rel="noopener noreferrer" title="Open the source in a new tab">
                          <span class="dm-row-label">{r.label}</span>
                          {#if r.meta || r.when}
                            <span class="dm-row-meta">{r.meta ?? ''}{r.meta && r.when ? ' · ' : ''}{r.when ? relativeStamp(r.when) : ''}</span>
                          {/if}
                          {#if r.note}<span class="dm-row-note">{r.note}</span>{/if}
                        </a>
                      {:else if r.drill}
                        <button type="button" class="dm-row-main dm-row-btn" onclick={() => navigate(r.drill!)} title="Open">
                          <span class="dm-row-label">{r.label}</span>
                          {#if r.meta || r.when}
                            <span class="dm-row-meta">{r.meta ?? ''}{r.meta && r.when ? ' · ' : ''}{r.when ? relativeStamp(r.when) : ''}</span>
                          {/if}
                          {#if r.note}<span class="dm-row-note">{r.note}</span>{/if}
                        </button>
                      {:else}
                        <div class="dm-row-main">
                          <span class="dm-row-label">{r.label}</span>
                          {#if r.meta || r.when}
                            <span class="dm-row-meta">{r.meta ?? ''}{r.meta && r.when ? ' · ' : ''}{r.when ? relativeStamp(r.when) : ''}</span>
                          {/if}
                          {#if r.note}<span class="dm-row-note">{r.note}</span>{/if}
                        </div>
                      {/if}
                      {#if r.href && r.external}
                        <a class="dm-row-go" href={r.href} target="_blank" rel="noopener noreferrer" aria-label="Open {r.label} in a new tab">↗</a>
                      {:else if r.href}
                        <a class="dm-row-go" href={r.href} onclick={onClose} aria-label="Open {r.label}">↗</a>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </section>
          {/each}
        </div>
      </div>

      {#if manifest.actions.length}
        <footer class="dm-actions">
          {#if actionNote}<span class="dm-action-note">{actionNote}</span>{/if}
          {#if prompting}
            {@const a = manifest.actions.find((x) => x.id === prompting)}
            {#if a}
              <div class="dm-prompt">
                <label class="dm-prompt-label" for="dm-prompt-input">{a.promptLabel ?? a.label}</label>
                <input
                  id="dm-prompt-input"
                  class="dm-prompt-input"
                  type="text"
                  bind:value={promptText}
                  onkeydown={(e) => { if (e.key === 'Enter') run(a); }}
                />
                <button type="button" class="dm-btn primary" disabled={acting !== null || !promptText.trim()} onclick={() => run(a)}>
                  {acting === a.id ? 'saving…' : 'save'}
                </button>
                <button type="button" class="dm-btn" onclick={() => (prompting = null)}>cancel</button>
              </div>
            {/if}
          {/if}
          <div class="dm-action-row">
            {#each manifest.actions as a (a.id)}
              <button
                type="button"
                class="dm-btn"
                class:danger={a.tone === 'danger'}
                class:armed={confirming === a.id}
                class:primary={a.kind === 'ask'}
                disabled={a.disabled || acting !== null}
                title={a.note ?? ''}
                onclick={() => run(a)}
              >
                {#if acting === a.id}working…
                {:else if confirming === a.id}sure? {a.label}
                {:else}{a.label}
                {/if}
              </button>
            {/each}
          </div>
        </footer>
      {/if}
    {/if}
  </div>
</div>

<style>
  /* Same register as the graph modal: opaque elevated paper, a 2px ink rule,
     mono eyebrows, hairlines. No shadow, no radius. */
  .dm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(26, 16, 8, 0.45);
  }
  .dm-panel {
    display: flex;
    flex-direction: column;
    width: min(760px, 100%);
    max-height: 100%;
    background: var(--surface-elevated);
    border: 2px solid rgba(26, 16, 8, 0.22);
    border-radius: 0;
  }
  .dm-panel.wide {
    width: min(1180px, 100%);
  }

  .dm-hd {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--line-hair);
    background: var(--surface-rail);
  }
  .dm-hd-left,
  .dm-hd-right {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .dm-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dm-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .dm-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    text-decoration: none;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .dm-chip:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }

  .dm-title-row {
    flex: none;
    padding: 14px 18px 12px;
    border-bottom: 1px solid var(--line-hair);
  }
  .dm-title {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    font-weight: 600;
    line-height: 1.25;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .dm-sub {
    margin: 5px 0 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  /* Facts: a ruled strip, mono tabular figures, never display-face. */
  .dm-facts {
    flex: none;
    display: grid;
    grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr));
    border-bottom: 1px solid var(--line-hair);
    background: var(--bg);
  }
  .dm-fact {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 9px 14px 11px;
    border-right: 1px solid var(--line-hair);
  }
  .dm-fact:nth-child(4n),
  .dm-fact:last-child {
    border-right: none;
  }
  .dm-fact:nth-child(n + 5) {
    border-top: 1px solid var(--line-hair);
  }
  .dm-fact-label,
  .dm-fact-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dm-fact-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  .dm-fact-val {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-num-md);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    line-height: 1.1;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dm-fact[data-tone='good'] .dm-fact-val { color: var(--success); }
  .dm-fact[data-tone='warn'] .dm-fact-val { color: var(--warn); }
  .dm-fact[data-tone='bad'] .dm-fact-val { color: var(--error); }
  .dm-fact[data-tone='accent'] .dm-fact-val { color: var(--accent-ink); }
  /* Rows and prose take the same four tones on their leading rule. */
  .dm-row[data-tone='good'], .dm-prose[data-tone='good'] { border-left-color: var(--success); }
  .dm-row[data-tone='warn'], .dm-prose[data-tone='warn'] { border-left-color: var(--warn); }
  .dm-row[data-tone='bad'], .dm-prose[data-tone='bad'] { border-left-color: var(--error); }
  .dm-row[data-tone='accent'] { border-left-color: var(--accent-ink); }
  .dm-fact-detail {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .dm-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
  }
  .dm-body.split {
    display: flex;
  }
  .dm-entity {
    flex: 1;
    min-width: 0;
    padding: 16px 18px;
    border-right: 1px solid var(--line-hair);
  }
  .dm-body.split .dm-sections {
    flex: none;
    width: 400px;
  }
  .dm-sections.dimmed {
    opacity: 0.55;
  }
  .dm-sec {
    padding: 12px 18px 14px;
    border-bottom: 1px solid var(--line-hair);
  }
  .dm-sec:last-child {
    border-bottom: none;
  }
  .dm-sec-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .dm-prose {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .dm-prose[data-tone='warn'],
  .dm-prose[data-tone='bad'],
  .dm-prose[data-tone='good'] {
    border-left: 3px solid var(--line-hair);
    padding-left: 10px;
  }
  .dm-list {
    margin: 0;
    padding-left: 22px;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .dm-list li {
    margin: 2px 0;
    overflow-wrap: anywhere;
  }
  .dm-note {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .dm-err {
    color: var(--error);
  }
  .dm-empty {
    margin: 0;
    padding: 28px 18px;
    text-align: center;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }
  .dm-alert {
    margin: 14px 18px;
    padding: 12px 13px;
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--error);
    background: var(--bg);
  }
  .dm-more {
    display: block;
    margin-top: 8px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }

  /* Rows: the card's link-row grammar — a 2px leading rule that takes the
     tone, label on the line, mono meta beneath. */
  .dm-rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .dm-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border-left: 2px solid var(--line-hair);
    padding-left: 8px;
    transition: border-color 0.15s ease-out, background 0.15s ease-out;
  }
  .dm-row:hover {
    background: var(--surface-sunken);
  }
  .dm-row-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 4px 8px;
    text-align: left;
  }
  .dm-row-btn {
    border: none;
    background: none;
    cursor: pointer;
    font: inherit;
  }
  .dm-row-btn:hover .dm-row-label,
  .dm-row-link:hover .dm-row-label {
    color: var(--accent);
  }
  .dm-row-link {
    text-decoration: none;
    color: inherit;
  }
  .dm-row-label {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .dm-row-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .dm-row-note {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .dm-row-go {
    flex: none;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-decoration: none;
  }
  .dm-row-go:hover {
    color: var(--accent);
  }

  /* Actions on the rail paper; the one primary is the bridge back into the
     conversation. Danger colours only when ARMED — a red row is a threat. */
  .dm-actions {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  .dm-action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .dm-btn {
    padding: 6px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--bg);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
    transition: color 0.15s ease-out, border-color 0.15s ease-out, background 0.15s ease-out;
  }
  .dm-btn:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .dm-btn:disabled {
    color: var(--text-ghost);
    cursor: default;
  }
  .dm-btn.primary {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .dm-btn.primary:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }
  .dm-btn.danger.armed {
    background: var(--error);
    border-color: var(--error);
    color: #fff;
  }
  .dm-action-note {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .dm-prompt {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 6px;
    align-items: center;
  }
  .dm-prompt-label {
    grid-column: 1 / -1;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .dm-prompt-input {
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--bg);
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .dm-prompt-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  @media (max-width: 899px) {
    .dm-backdrop {
      padding: 0;
    }
    .dm-panel,
    .dm-panel.wide {
      width: 100%;
      height: 100%;
      border-width: 0;
    }
    .dm-body.split {
      flex-direction: column;
    }
    .dm-entity {
      border-right: none;
      border-bottom: 1px solid var(--line-hair);
    }
    .dm-body.split .dm-sections {
      width: auto;
    }
    .dm-facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .dm-fact:nth-child(2n) {
      border-right: none;
    }
    .dm-fact:nth-child(n + 3) {
      border-top: 1px solid var(--line-hair);
    }
  }
</style>
