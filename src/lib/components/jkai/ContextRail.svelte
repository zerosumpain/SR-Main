<script lang="ts">
  import { contextPanelSchema, type ContextLens, type ContextPanel } from '$lib/jkai/context-panel/types';
  import { hub } from '$lib/jkai/hub-bus.svelte';
  import ContextCard from './context/ContextCard.svelte';
  import KnowledgeGraphRail from './KnowledgeGraphRail.svelte';

  let { conversationId, threadCostUsd = null, contextFraction = null, sheetDetent = 'closed', onCloseSheet }: {
    conversationId: string | null;
    threadCostUsd?: number | null;
    contextFraction?: number | null;
    sheetDetent?: 'closed' | 'peek' | 'full';
    onCloseSheet?: () => void;
  } = $props();

  let panel = $state<ContextPanel | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let manualLens = $state<ContextLens | null>(null);
  let loadedKey = '';
  let lensConversationId: string | null = null;
  let sequence = 0;
  const orderedLenses = $derived(
    panel?.lenses.slice().sort((a, b) =>
      a.id === 'general' ? -1 : b.id === 'general' ? 1 : b.score - a.score,
    ) ?? [],
  );

  async function load(id: string, lens: ContextLens | null) {
    const seq = ++sequence;
    loading = true;
    error = null;
    try {
      const query = lens ? `?lens=${lens}` : '';
      const response = await fetch(`/api/jkai/conversations/${id}/context-panel${query}`);
      if (!response.ok) throw new Error(`Context panel returned ${response.status}`);
      const parsed = contextPanelSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Context panel returned an invalid manifest');
      if (seq === sequence) panel = parsed.data;
    } catch (cause) {
      if (seq === sequence) error = cause instanceof Error ? cause.message : 'Context panel unavailable';
    } finally {
      if (seq === sequence) loading = false;
    }
  }

  $effect(() => {
    const id = conversationId;
    const revision = hub.graphRevision;
    if (id !== lensConversationId) {
      lensConversationId = id;
      try {
        const stored = id ? localStorage.getItem(`jkai.contextLens.${id}`) : null;
        const parsed = contextPanelSchema.shape.selectedLens.safeParse(stored);
        manualLens = parsed.success ? parsed.data : null;
      } catch {
        manualLens = null;
      }
      loadedKey = '';
    }
    const key = `${id ?? ''}:${revision}:${manualLens ?? 'auto'}`;
    if (key === loadedKey) return;
    loadedKey = key;
    if (!id) { panel = null; return; }
    void load(id, manualLens);
  });

  function selectLens(lens: ContextLens) {
    manualLens = lens === panel?.automaticLens ? null : lens;
    if (!conversationId) return;
    try {
      if (manualLens) localStorage.setItem(`jkai.contextLens.${conversationId}`, manualLens);
      else localStorage.removeItem(`jkai.contextLens.${conversationId}`);
    } catch {
      // Storage is an enhancement; the in-memory selection still works.
    }
  }

  function askAbout(label: string, detail: string) {
    window.dispatchEvent(new CustomEvent('jkai:context-prompt', { detail: { conversationId, text: `Use the selected context from the side panel:\n${detail}\n\n${label}` } }));
  }
</script>

<aside class="context-rail" data-detent={sheetDetent}>
  <button type="button" class="sheet-handle" onclick={onCloseSheet} aria-label="Close context panel"><span></span></button>
  <header class="ctx-head">
    <div>
      <span class="eyebrow"><i aria-hidden="true"></i>Context aware</span>
      <strong>{panel?.focus.label ?? 'Reading the thread…'}</strong>
      {#if panel}<small>{panel.focus.reason}</small>{/if}
    </div>
    <span class="rail-mark" aria-hidden="true">J/A</span>
    {#if loading}<span class="working"><i></i>updating</span>{/if}
  </header>

  {#if panel}
    <nav class="lenses" aria-label="Context lenses">
      {#each orderedLenses as lens, index (lens.id)}
        <button type="button" class:active={lens.id === panel.selectedLens} onclick={() => selectLens(lens.id)} title={lens.reason}>
          <small class="lens-index">{String(index + 1).padStart(2, '0')}</small>
          <span>{lens.id}</span>
          <small class="lens-score">{Math.round(lens.score * 100)}</small>
        </button>
      {/each}
    </nav>
  {/if}

  <div class="ctx-scroll">
    {#if error}
      <div class="error"><strong>Context unavailable</strong><span>{error}</span><button type="button" onclick={() => conversationId && load(conversationId, manualLens)}>retry →</button></div>
    {:else if !panel}
      <div class="empty">{conversationId ? 'Building the contextual view…' : 'Select a conversation.'}</div>
    {:else}
      <div class="cards">
        {#each panel.cards as card (card.id)}
          <ContextCard {card} onSelect={askAbout} />
        {/each}
      </div>
      {#if panel.selectedLens === 'intel' || panel.selectedLens === 'general'}
        <KnowledgeGraphRail {conversationId} {threadCostUsd} {contextFraction} embedded />
      {/if}
    {/if}
  </div>
</aside>

<style>
  .context-rail { width:390px; flex:none; display:flex; flex-direction:column; height:100%; min-height:0; border-left:1px solid var(--line-strong); background:var(--surface-rail); }
  .sheet-handle { display:none; }
  .ctx-head { position:relative; flex:none; display:flex; justify-content:space-between; gap:10px; min-height:92px; padding:17px 16px 14px 19px; border-bottom:1px solid var(--line-strong); background:linear-gradient(135deg, var(--surface-card) 0%, var(--surface-rail) 72%); overflow:hidden; }
  .ctx-head::before { content:''; position:absolute; inset:17px auto 17px 0; width:3px; background:var(--accent); }
  .ctx-head > div { min-width:0; }
  .eyebrow, .working { display:flex; align-items:center; gap:7px; color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.13em; }
  .eyebrow i { width:5px; height:5px; border-radius:50%; background:var(--accent); box-shadow:var(--accent-glow); }
  .ctx-head strong, .ctx-head small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ctx-head strong { max-width:285px; margin-top:7px; color:var(--text-primary); font-family:var(--font-display); font-size:var(--fs-body-lg); font-weight:400; line-height:1.05; letter-spacing:-.02em; text-transform:uppercase; }
  .ctx-head small { max-width:285px; margin-top:5px; color:var(--text-muted); font-size:var(--fs-label-xs); }
  .rail-mark { position:absolute; right:13px; bottom:-7px; color:var(--text-primary); font-family:var(--font-display); font-size:2.7rem; line-height:1; opacity:.055; pointer-events:none; }
  .working { position:absolute; top:17px; right:14px; color:var(--accent); letter-spacing:.06em; }
  .working i { width:5px; height:5px; border-radius:50%; background:currentColor; animation:pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity:.3; } }
  .lenses { flex:none; display:flex; overflow-x:auto; border-bottom:1px solid var(--line-strong); background:color-mix(in srgb, var(--surface-rail) 82%, var(--text-primary)); scrollbar-width:none; }
  .lenses button { position:relative; flex:1 0 auto; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:6px; min-width:94px; padding:9px 10px 10px; border:0; border-right:1px solid var(--line-hair); background:none; color:var(--text-muted); cursor:pointer; font-family:var(--font-mono); font-size:var(--fs-label-xs); text-align:left; text-transform:uppercase; }
  .lenses button:hover { background:var(--surface-overlay); color:var(--text); }
  .lenses button.active { background:var(--surface-card); box-shadow:inset 0 -3px var(--accent); color:var(--text-primary); font-weight:700; }
  .lenses small { color:var(--text-ghost); font-size:var(--fs-label-xs); font-weight:400; }
  .lens-index { opacity:.65; }
  .lens-score { font-variant-numeric:tabular-nums; }
  .ctx-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
  .cards { display:flex; flex-direction:column; gap:12px; padding:12px; }
  .empty, .error { margin:12px; padding:16px; border:1px solid var(--line-strong); border-left:3px solid var(--accent); background:var(--surface-card); color:var(--text-muted); font-size:var(--fs-body-sm); }
  .error { display:flex; flex-direction:column; gap:4px; color:var(--error); }
  .error button { align-self:flex-start; padding:5px 0; border:0; background:none; color:var(--accent); cursor:pointer; font-family:var(--font-mono); font-size:var(--fs-label-xs); }
  @media (max-width:799px) {
    .context-rail { width:100%; pointer-events:auto; position:absolute; left:0; right:0; bottom:0; height:78%; transform:translateY(100%); transition:transform .2s ease-out; border-left:0; border-top:1px solid var(--line-strong); }
    .context-rail[data-detent='peek'] { height:42%; transform:none; }
    .context-rail[data-detent='full'] { height:94%; transform:none; }
    .sheet-handle { display:flex; height:24px; flex:none; align-items:center; justify-content:center; border:0; background:none; }
    .sheet-handle span { width:38px; height:3px; background:var(--line-strong); border-radius:var(--radius-round); }
  }
  @media (prefers-reduced-motion:reduce) {
    .working i { animation:none; }
  }
</style>
