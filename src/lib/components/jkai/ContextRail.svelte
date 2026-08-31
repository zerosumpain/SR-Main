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
      <span class="eyebrow">Context</span>
      <strong>{panel?.focus.label ?? 'Reading the thread…'}</strong>
      {#if panel}<small>{panel.focus.reason}</small>{/if}
    </div>
    {#if loading}<span class="working">updating</span>{/if}
  </header>

  {#if panel}
    <nav class="lenses" aria-label="Context lenses">
      {#each panel.lenses as lens (lens.id)}
        <button type="button" class:active={lens.id === panel.selectedLens} onclick={() => selectLens(lens.id)} title={lens.reason}>
          <span>{lens.id}</span><small>{Math.round(lens.score * 100)}</small>
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
  .context-rail { width:390px; flex:none; display:flex; flex-direction:column; height:100%; min-height:0; border-left:1px solid var(--line-hair); background:var(--surface-rail); }
  .sheet-handle { display:none; }
  .ctx-head { flex:none; display:flex; justify-content:space-between; gap:10px; padding:13px 14px 11px; border-bottom:1px solid var(--line-hair); }
  .ctx-head > div { min-width:0; }
  .eyebrow, .working { display:block; color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.13em; }
  .ctx-head strong, .ctx-head small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ctx-head strong { margin-top:4px; color:var(--text); font-size:var(--fs-body-sm); }
  .ctx-head small { margin-top:2px; color:var(--text-muted); font-size:var(--fs-label-xs); }
  .working { color:var(--accent); letter-spacing:.06em; }
  .lenses { flex:none; display:flex; overflow-x:auto; border-bottom:1px solid var(--line-hair); scrollbar-width:none; }
  .lenses button { flex:1 0 auto; display:flex; align-items:center; gap:5px; padding:8px 9px; border:0; border-right:1px solid var(--line-hair); background:none; color:var(--text-muted); cursor:pointer; font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; }
  .lenses button:hover { background:var(--surface-overlay); color:var(--text); }
  .lenses button.active { box-shadow:inset 0 -2px var(--accent); color:var(--accent); }
  .lenses small { color:var(--text-ghost); font-size:var(--fs-label-xs); }
  .ctx-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
  .cards { display:flex; flex-direction:column; gap:10px; padding:10px; }
  .empty, .error { margin:10px; padding:15px; border:1px solid var(--line-hair); color:var(--text-muted); font-size:var(--fs-body-sm); }
  .error { display:flex; flex-direction:column; gap:4px; color:var(--error); }
  .error button { align-self:flex-start; padding:5px 0; border:0; background:none; color:var(--accent); cursor:pointer; font-family:var(--font-mono); font-size:var(--fs-label-xs); }
  @media (max-width:799px) {
    .context-rail { width:100%; pointer-events:auto; position:absolute; left:0; right:0; bottom:0; height:78%; transform:translateY(100%); transition:transform .2s ease-out; border-left:0; border-top:1px solid var(--line-strong); }
    .context-rail[data-detent='peek'] { height:42%; transform:none; }
    .context-rail[data-detent='full'] { height:94%; transform:none; }
    .sheet-handle { display:flex; height:24px; flex:none; align-items:center; justify-content:center; border:0; background:none; }
    .sheet-handle span { width:38px; height:3px; background:var(--line-strong); border-radius:var(--radius-round); }
  }
</style>
