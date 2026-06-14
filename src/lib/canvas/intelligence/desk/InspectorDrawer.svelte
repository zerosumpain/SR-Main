<!-- src/lib/canvas/intelligence/desk/InspectorDrawer.svelte -->
<script lang="ts">
  import { portal } from '$lib/canvas/portal';
  import { goto } from '$app/navigation';

  type ArtefactKind = 'source' | 'fact' | 'entity';
  interface RelatedRef { id: string; kind: ArtefactKind; label: string; }
  // Loose shape — fields depend on kind (see SHARED CONTRACT).
  type Artefact = { kind: ArtefactKind; id: string } & Record<string, unknown>;

  let {
    open = $bindable(false),
    sessionId,
    artefact,
    related = [],
    onclose,
    onselect,
  }: {
    open?: boolean;
    sessionId: string;
    artefact: Artefact | null;
    related?: RelatedRef[];
    onclose: () => void;
    onselect: (id: string) => void;
  } = $props();

  let exploring = $state(false);
  let exploreErr = $state<string | null>(null);

  // explore type for the /explore endpoint: only fact|entity are addressable by itemId here
  let exploreType = $derived(
    artefact?.kind === 'entity' ? 'entity' : artefact?.kind === 'fact' ? 'fact' : null,
  );

  async function exploreFurther() {
    if (!artefact || !exploreType) return;
    exploring = true;
    exploreErr = null;
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/explore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: exploreType, itemId: artefact.id }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? `Explore failed (${res.status})`);
      }
      const child = await res.json() as { id: string };
      goto(`/deepdive/${child.id}`);
    } catch (err: unknown) {
      exploreErr = err instanceof Error ? err.message : 'Explore failed';
    } finally {
      exploring = false;
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

{#if open && artefact}
  <!-- svelte-ignore a11y_interactive_supports_focus a11y_click_events_have_key_events -->
  <div class="scrim" use:portal={'body'} onclick={onclose} role="presentation"></div>
  <aside class="drawer" use:portal={'body'} role="dialog" aria-label="Artefact inspector">
    <header class="d-head">
      <span class="d-kind d-kind-{artefact.kind}"
            class:challenge={artefact.kind === 'fact' && (artefact.isCounterfactual as boolean)}>
        {(artefact.kind === 'fact' && (artefact.isCounterfactual as boolean)) ? 'CHALLENGE' : kindLabel(artefact.kind)}
      </span>
      <button type="button" class="d-close" onclick={onclose} aria-label="Close inspector">✕</button>
    </header>

    <div class="d-body">
      {#if artefact.kind === 'source'}
        <h2 class="d-title">{(artefact.title as string) ?? (artefact.url as string)}</h2>
        <a class="d-link" href={artefact.url as string} target="_blank" rel="noopener noreferrer">{artefact.domain as string}</a>
        <dl class="d-meta">
          <div><dt>Category</dt><dd>{(artefact.category as string) ?? '—'}</dd></div>
          <div><dt>Credibility</dt><dd>{(artefact.credibilityType as string) ?? '—'} · {fmtPct(artefact.credibilityScore)}</dd></div>
        </dl>

      {:else if artefact.kind === 'fact'}
        <p class="d-fact">{artefact.content as string}</p>
        <div class="d-confbar" aria-label="Confidence">
          <span class="d-conffill" style:width={fmtPct(artefact.confidence)}></span>
        </div>
        <span class="d-confnum">confidence {fmtPct(artefact.confidence)}</span>
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
      <button
        type="button"
        class="d-explore"
        disabled={!exploreType || exploring}
        title={exploreType ? 'Spin up a child research run seeded by this artefact' : 'Explore not available for this artefact'}
        onclick={exploreFurther}
      >
        {exploring ? 'Spinning up…' : '⤓ Explore further'}
      </button>
    </footer>
  </aside>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0;
    background: rgba(26, 16, 8, 0.18);
    z-index: 90;
  }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 380px; max-width: 92vw;
    background: var(--surface-elevated);
    border-left: 1px solid var(--card-border);
    box-shadow: -8px 0 24px rgba(26, 16, 8, 0.18);
    display: flex; flex-direction: column;
    z-index: 91;
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
  .d-meta dd { font-family: var(--font-body); font-size: 13px; color: var(--text-primary); margin: 0; text-align: right; }

  .d-fact { font-family: var(--font-body); font-size: 15px; line-height: 1.5; color: var(--text-primary); margin: 0 0 14px; }
  .d-confbar { height: 6px; background: var(--card-bg); border-radius: var(--radius-pill); overflow: hidden; }
  .d-conffill { display: block; height: 100%; background: var(--accent); }
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
</style>
