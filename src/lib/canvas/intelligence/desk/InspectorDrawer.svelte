<!-- src/lib/canvas/intelligence/desk/InspectorDrawer.svelte -->
<script lang="ts">
  import { portal } from '$lib/canvas/portal';
  import { goto } from '$app/navigation';
  import { confidenceColor, confidenceLabel, credibilityBadge } from '$lib/deepdive/display';
  import { buildExplorePrompt, buildExplorePayload, type ExploreType } from './explore';

  type ArtefactKind = 'source' | 'fact' | 'entity';
  interface RelatedRef { id: string; kind: ArtefactKind; label: string; }
  // Loose shape — fields depend on kind (see SHARED CONTRACT).
  type Artefact = { kind: ArtefactKind; id: string } & Record<string, unknown>;

  let {
    open = $bindable(false),
    sessionId,
    artefact,
    related = [],
    summarize = false,
    onclose,
    onselect,
  }: {
    open?: boolean;
    sessionId: string;
    artefact: Artefact | null;
    related?: RelatedRef[];
    /** When true (set by double-click), auto-trigger the page summary fetch. */
    summarize?: boolean;
    onclose: () => void;
    onselect: (id: string) => void;
  } = $props();

  // 3-phase explore flow: idle → confirm (explanation card) → starting (POST).
  let explorePhase = $state<'idle' | 'confirm' | 'starting'>('idle');
  let exploreErr = $state<string | null>(null);
  let focusNote = $state('');

  // ——— Page summary (source cards only) ———
  // Client-side per-source cache: sourceId → summary text.
  // Plain Map (not $state) — not reactive, just a lookup table updated from async handlers.
  const summaryClientCache = new Map<string, string>();

  let summaryText = $state<string | null>(null);
  let summaryLoading = $state(false);
  let summaryError = $state<string | null>(null);
  // Plain let — AbortController must NOT be $state (Svelte 5 proxy footgun).
  let summaryAc: AbortController | null = null;

  // explore type for the /explore endpoint: only fact|entity are addressable by itemId here
  let exploreType = $derived<ExploreType | null>(
    artefact?.kind === 'entity' ? 'entity' : artefact?.kind === 'fact' ? 'fact' : null,
  );

  // What the run would be seeded by — drives the confirm card. Null = not addressable.
  let explorePrompt = $derived(buildExplorePrompt(artefact));

  // Reset explore state when the artefact identity changes (guarded to avoid
  // proxy-churn / effect_update_depth_exceeded: only writes when id actually differs).
  let prevArtefactId = $state<string | null>(null);
  $effect(() => {
    const id = artefact?.id ?? null;
    if (id !== prevArtefactId) {
      prevArtefactId = id;
      resetExplore();
      // Reset summary state on artefact change.
      summaryAc?.abort();
      summaryAc = null;
      summaryText = null;
      summaryLoading = false;
      summaryError = null;
    }
  });

  // Auto-trigger summary when opened via double-click (summarize flag set).
  // Keyed on (artefact id + summarize) — fires once when both are true,
  // cleans up via AbortController (plain let, not $state).
  let prevSummarizeKey = $state<string>('');
  $effect(() => {
    const id = artefact?.id ?? null;
    const kind = artefact?.kind ?? null;
    const key = `${id ?? ''}:${summarize}`;
    if (key === prevSummarizeKey) return;
    prevSummarizeKey = key;

    if (id && kind === 'source' && summarize) {
      fetchSummary(id);
    }
  });

  function resetExplore() {
    explorePhase = 'idle';
    exploreErr = null;
    focusNote = '';
  }

  async function fetchSummary(sourceId: string) {
    // Client-side cache hit — instant re-open.
    const hit = summaryClientCache.get(sourceId);
    if (hit !== undefined) {
      summaryText = hit;
      summaryLoading = false;
      summaryError = null;
      return;
    }

    // Abort any in-flight request for a previous source.
    summaryAc?.abort();
    summaryAc = new AbortController();
    const signal = summaryAc.signal;

    summaryLoading = true;
    summaryText = null;
    summaryError = null;

    try {
      const res = await fetch(`/api/deepdive/${sessionId}/source-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
        signal,
      });
      if (signal.aborted) return;
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json() as { summary: string };
      if (signal.aborted) return;
      summaryText = data.summary ?? '';
      summaryClientCache.set(sourceId, summaryText);
    } catch (err: unknown) {
      if (signal.aborted) return;
      summaryError = err instanceof Error ? err.message : 'Summary failed';
    } finally {
      if (!signal.aborted) {
        summaryLoading = false;
        summaryAc = null;
      }
    }
  }

  async function startExplore() {
    if (!artefact || !exploreType) return;
    explorePhase = 'starting';
    exploreErr = null;
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/explore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildExplorePayload(exploreType, artefact.id, focusNote)),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? `Explore failed (${res.status})`);
      }
      const child = await res.json() as { id: string };
      goto(`/deepdive/${child.id}`);
    } catch (err: unknown) {
      exploreErr = err instanceof Error ? err.message : 'Explore failed';
      // Drop back to the confirm card, preserving the focus note for retry.
      explorePhase = 'confirm';
    }
  }

  function kindLabel(k: ArtefactKind): string {
    return k === 'source' ? 'SOURCE' : k === 'entity' ? 'ENTITY' : 'FACT';
  }
  function fmtPct(n: unknown): string {
    const v = typeof n === 'number' ? n : 0;
    return `${Math.round((v <= 1 ? v * 100 : v))}%`;
  }
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') onclose(); }} />

{#if open && artefact}
  <!-- Single portaled root: scrim + drawer are nested children so DOM order
       (not z-index) decides stacking, and a clean teardown removes the whole
       overlay at once (mirrors BuildViewModal / MobileBottomSheet). -->
  <div class="insp-root" use:portal={'body'}>
    <!-- svelte-ignore a11y_interactive_supports_focus a11y_click_events_have_key_events -->
    <div class="scrim" onclick={onclose} role="presentation"></div>
    <aside class="drawer" role="dialog" aria-label="Artefact inspector">
      <header class="d-head">
        <span class="d-kind d-kind-{artefact.kind}"
              class:challenge={artefact.kind === 'fact' && (artefact.isCounterfactual as boolean)}>
          {(artefact.kind === 'fact' && (artefact.isCounterfactual as boolean)) ? 'CHALLENGE' : kindLabel(artefact.kind)}
        </span>
        <button type="button" class="d-close" onclick={onclose} aria-label="Close inspector">✕</button>
      </header>

      <div class="d-body">
        {#if artefact.kind === 'source'}
          {@const cb = credibilityBadge(artefact.credibilityType as string | null | undefined)}
          <h2 class="d-title">{(artefact.title as string) ?? (artefact.url as string)}</h2>
          <a class="d-link" href={artefact.url as string} target="_blank" rel="noopener noreferrer">{artefact.domain as string}</a>
          <dl class="d-meta">
            <div><dt>Category</dt><dd>{(artefact.category as string) ?? '—'}</dd></div>
            <div>
              <dt>Credibility</dt>
              <dd>
                <span class="d-credbadge" style:color={cb.color} style:border-color={cb.color}>{cb.label}</span>
                <span class="d-credscore">· {fmtPct(artefact.credibilityScore)}</span>
              </dd>
            </div>
          </dl>

          <!-- PAGE SUMMARY section — source artefacts only -->
          <section class="d-sec d-summary-sec">
            <div class="d-summary-head-row">
              <h3>PAGE SUMMARY</h3>
              {#if !summaryLoading && summaryText === null && summaryError === null}
                <button
                  type="button"
                  class="d-summary-trigger"
                  onclick={() => fetchSummary(artefact.id)}
                  title="Double-click the card or click here to summarise this page"
                >Summarise page</button>
              {/if}
              {#if summaryLoading}
                <span class="d-summary-trigger-hint">generating…</span>
              {/if}
            </div>

            {#if summaryLoading}
              <!-- Skeleton -->
              <div class="d-summary-skeleton" aria-label="Generating summary…">
                <span></span><span></span><span></span>
              </div>
            {:else if summaryError}
              <p class="d-summary-error">{summaryError}</p>
            {:else if summaryText !== null}
              <p class="d-summary-text">{summaryText}</p>
              <button
                type="button"
                class="d-summary-refresh"
                onclick={() => {
                  summaryClientCache.delete(artefact.id);
                  fetchSummary(artefact.id);
                }}
                title="Regenerate summary"
              >↺ regenerate</button>
            {/if}
          </section>

        {:else if artefact.kind === 'fact'}
          {@const cc = confidenceColor(Number(artefact.confidence))}
          <p class="d-fact">{artefact.content as string}</p>
          <div class="d-confbar" aria-label="Confidence">
            <span class="d-conffill" style:width={fmtPct(artefact.confidence)} style:background={cc}></span>
          </div>
          <span class="d-confnum" style:color={cc}>confidence {fmtPct(artefact.confidence)} · {confidenceLabel(Number(artefact.confidence))}</span>
          {#if (artefact.tags as string[] | undefined)?.length}
            <div class="d-tags">{#each artefact.tags as string[] as t}<span class="d-tag">{t}</span>{/each}</div>
          {/if}
          {#if artefact.eventDate}<p class="d-date">dated {String(artefact.eventDate).slice(0, 10)}</p>{/if}

        {:else}
          <h2 class="d-entity">{artefact.name as string}</h2>
          <span class="d-etype">{(artefact.type as string) ?? 'entity'}</span>
          {#if artefact.description}<p class="d-desc">{artefact.description as string}</p>{/if}
        {/if}

        {#if related.length}
          <section class="d-sec">
            <h3>RELATED</h3>
            <ul class="d-related">
              {#each related as r (r.id)}
                <li>
                  <button type="button" class="d-rel" onclick={() => onselect(r.id)}>
                    <span class="d-rel-kind d-kind-{r.kind}">{kindLabel(r.kind)}</span>
                    <span class="d-rel-label">{r.label}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>

      <footer class="d-foot">
        {#if exploreErr}<p class="d-err">{exploreErr}</p>{/if}

        {#if explorePhase === 'confirm' && explorePrompt}
          <div class="d-confirm">
            <h4 class="d-confirm-head">{explorePrompt.heading}</h4>
            <p class="d-confirm-body">
              Starts a new focused research run seeded by this {explorePrompt.kind}:
              <span class="d-confirm-quote">“{explorePrompt.snippet}”</span>
            </p>
            <label class="d-confirm-label" for="explore-focus">Extra focus (optional)</label>
            <textarea
              id="explore-focus"
              class="d-confirm-note"
              bind:value={focusNote}
              rows="2"
              placeholder="e.g. concentrate on the economic impact, 2010 onwards…"
            ></textarea>
            <div class="d-confirm-actions">
              <button type="button" class="d-cancel" onclick={resetExplore}>Cancel</button>
              <button type="button" class="d-start" onclick={startExplore}>Start run →</button>
            </div>
          </div>
        {:else}
          <button
            type="button"
            class="d-explore"
            disabled={!exploreType || explorePhase === 'starting'}
            title={exploreType ? 'Spin up a child research run seeded by this artefact' : 'Explore not available for this artefact'}
            onclick={() => { exploreErr = null; explorePhase = 'confirm'; }}
          >
            {explorePhase === 'starting' ? 'Spinning up…' : '⤓ Explore further'}
          </button>
        {/if}
      </footer>
    </aside>
  </div>
{/if}

<style>
  .insp-root {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(26, 16, 8, 0.18);
    pointer-events: auto;
  }
  .drawer {
    position: absolute;
    top: 0; right: 0; bottom: 0;
    width: 380px; max-width: 92vw;
    background: var(--surface-elevated);
    border-left: 1px solid var(--card-border);
    box-shadow: -8px 0 24px rgba(26, 16, 8, 0.18);
    display: flex; flex-direction: column;
    pointer-events: auto;
    animation: slidein 0.18s ease-out;
  }
  @keyframes slidein { from { transform: translateX(100%); } to { transform: translateX(0); } }

  .d-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--card-border); }
  .d-kind {
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em;
    padding: 3px 8px; border-radius: var(--radius-sharp); color: var(--text-muted); border: 1px solid var(--card-border);
  }
  .d-kind-entity { background: #1a1008; color: #ede4d4; border-color: #1a1008; }
  .d-kind-source { color: var(--accent); border-color: var(--accent-tint-35); }
  .d-kind.challenge { color: var(--error); border-color: var(--error); background: var(--error-bg); }
  .d-close { background: none; border: none; color: var(--text-muted); font-size: 15px; cursor: pointer; }
  .d-close:hover { color: var(--accent); }

  .d-body { flex: 1; overflow-y: auto; padding: 16px 14px; }
  .d-title { font-family: var(--font-body); font-size: 17px; font-weight: 700; color: var(--text-primary); margin: 0 0 6px; }
  .d-link { font-family: var(--font-mono); font-size: 12px; color: var(--accent); text-decoration: none; }
  .d-link:hover { text-decoration: underline; }
  .d-meta { margin: 16px 0 0; display: flex; flex-direction: column; gap: 10px; }
  .d-meta div { display: flex; justify-content: space-between; gap: 12px; }
  .d-meta dt { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; color: var(--text-ghost); text-transform: uppercase; margin: 0; }
  .d-meta dd { font-family: var(--font-body); font-size: 13px; color: var(--text-primary); margin: 0; text-align: right; display: flex; align-items: center; gap: 6px; justify-content: flex-end; }

  .d-credbadge {
    font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em;
    padding: 2px 6px; border-radius: var(--radius-sharp); border: 1px solid var(--card-border);
  }
  .d-credscore { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }

  .d-fact { font-family: var(--font-body); font-size: 15px; line-height: 1.5; color: var(--text-primary); margin: 0 0 14px; }
  .d-confbar { height: 6px; background: var(--card-bg); border-radius: var(--radius-pill); overflow: hidden; }
  .d-conffill { display: block; height: 100%; }
  .d-confnum { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .d-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .d-tag { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); background: var(--card-bg); border: 1px solid var(--card-border); padding: 2px 7px; border-radius: var(--radius-pill); }
  .d-date { font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost); margin-top: 10px; }

  .d-entity { font-family: var(--font-display); font-size: 22px; color: var(--text-primary); margin: 0 0 4px; }
  .d-etype { font-family: var(--font-mono); font-size: 11px; color: var(--accent); }
  .d-desc { font-family: var(--font-body); font-size: 14px; line-height: 1.55; color: var(--text-secondary); margin-top: 12px; }

  .d-sec { margin-top: 22px; }
  .d-sec h3 { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; color: var(--text-ghost); margin: 0 0 8px; }
  .d-related { list-style: none; margin: 0; padding: 0; }
  .d-rel { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-sharp); padding: 6px 8px; margin-bottom: 6px; cursor: pointer; }
  .d-rel:hover { border-color: var(--accent); }
  .d-rel-kind { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; padding: 1px 5px; border-radius: var(--radius-sharp); border: 1px solid var(--card-border); color: var(--text-muted); }
  .d-rel-label { font-family: var(--font-body); font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .d-foot { padding: 12px 14px; border-top: 1px solid var(--card-border); }
  .d-err { font-family: var(--font-mono); font-size: 11px; color: var(--error); margin: 0 0 8px; }
  .d-explore {
    width: 100%; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.04em;
    padding: 10px; border: 1px solid var(--accent); border-radius: var(--radius-sharp);
    background: var(--accent); color: #faf6ee; cursor: pointer;
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
  }
  .d-explore:hover:not(:disabled) { background: var(--accent-hover); }
  .d-explore:disabled { opacity: 0.45; cursor: default; box-shadow: none; }

  /* In-drawer confirm card (reuses the drawer footer surface, not a new modal). */
  .d-confirm { display: flex; flex-direction: column; gap: 8px; }
  .d-confirm-head { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.12em; color: var(--text-primary); margin: 0; }
  .d-confirm-body { font-family: var(--font-body); font-size: 12px; line-height: 1.45; color: var(--text-secondary); margin: 0; }
  .d-confirm-quote { display: block; margin-top: 4px; font-style: italic; color: var(--text-primary); }
  .d-confirm-label { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-ghost); }
  .d-confirm-note {
    font-family: var(--font-body); font-size: 12px; color: var(--text-primary);
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-sharp);
    padding: 6px 8px; resize: vertical; min-height: 38px;
  }
  .d-confirm-note:focus { outline: none; border-color: var(--accent); }
  .d-confirm-actions { display: flex; gap: 8px; margin-top: 2px; }
  .d-cancel {
    flex: 0 0 auto; font-family: var(--font-mono); font-size: 12px;
    padding: 8px 12px; border: 1px solid var(--card-border); border-radius: var(--radius-sharp);
    background: var(--card-bg); color: var(--text-muted); cursor: pointer;
  }
  .d-cancel:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .d-start {
    flex: 1; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.04em;
    padding: 8px 12px; border: 1px solid var(--accent); border-radius: var(--radius-sharp);
    background: var(--accent); color: #faf6ee; cursor: pointer;
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
  }
  .d-start:hover { background: var(--accent-hover); }

  /* ——— Page summary section (source artefacts only) ——— */
  .d-summary-sec { margin-top: 22px; }
  .d-summary-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .d-summary-head-row h3 {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    margin: 0;
  }
  .d-summary-trigger {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    color: var(--accent);
    border: 1px solid var(--accent-tint-35);
    background: transparent;
    padding: 2px 7px;
    border-radius: var(--radius-sharp);
    cursor: pointer;
    transition: background 0.14s ease;
  }
  .d-summary-trigger:hover { background: var(--accent-tint-35); }
  .d-summary-trigger-hint {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }

  /* Animated skeleton: 3 lines of varying width */
  .d-summary-skeleton {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .d-summary-skeleton span {
    display: block;
    height: 11px;
    background: linear-gradient(
      90deg,
      rgba(26, 16, 8, 0.06) 25%,
      rgba(26, 16, 8, 0.13) 50%,
      rgba(26, 16, 8, 0.06) 75%
    );
    background-size: 200% 100%;
    animation: d-summary-shimmer 1.4s ease infinite;
    border-radius: 2px;
  }
  .d-summary-skeleton span:nth-child(1) { width: 100%; }
  .d-summary-skeleton span:nth-child(2) { width: 88%; }
  .d-summary-skeleton span:nth-child(3) { width: 72%; }
  @keyframes d-summary-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .d-summary-skeleton span { animation: none; }
  }

  .d-summary-text {
    font-family: var(--font-body);
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 8px;
    border-left: 2px solid var(--accent-tint-35);
    padding-left: 10px;
  }
  .d-summary-error {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--error);
    margin: 0;
  }
  .d-summary-refresh {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: block;
  }
  .d-summary-refresh:hover { color: var(--text-muted); }
</style>
