<script lang="ts">
  import type { EdgeMappingProposal, MappingAction } from '$lib/workflows/mapping/types';

  let {
    proposal,
    pending = false,
    applying = false,
    onApply,
    onDismiss,
  }: {
    proposal: EdgeMappingProposal | null;
    pending?: boolean;
    applying?: boolean;
    onApply: (patch: Record<string, unknown>) => void;
    onDismiss: () => void;
  } = $props();

  // set-config actions are the appliable ones; note/insert-node are advisory.
  const settable = $derived(
    (proposal?.actions ?? [])
      .map((a, i) => ({ a, i }))
      .filter((x) => x.a.kind === 'set-config'),
  );
  const advisory = $derived((proposal?.actions ?? []).filter((a) => a.kind !== 'set-config'));

  // Indices (into proposal.actions) the user has UN-checked. Reset per proposal
  // via a {#key} wrapper in the parent, so this starts empty (all selected).
  let excluded = $state<Set<number>>(new Set());

  function toggle(i: number) {
    const next = new Set(excluded);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    excluded = next;
  }

  const selectedCount = $derived(settable.filter((x) => !excluded.has(x.i)).length);

  function apply() {
    if (!proposal) return;
    const patch: Record<string, unknown> = {};
    for (const { a, i } of settable) {
      if (excluded.has(i)) continue;
      if (a.field) patch[a.field] = a.value;
    }
    onApply(patch);
  }

  function badgeClass(a: MappingAction): string {
    return a.kind === 'insert-node' ? 'ma-adv-insert' : 'ma-adv-note';
  }
</script>

{#if pending && !proposal}
  <div class="ma ma-pending" role="status">
    <span class="ma-spark">✦</span> Analysing the connection…
    <button type="button" class="ma-x" onclick={onDismiss} aria-label="dismiss">×</button>
  </div>
{:else if proposal}
  <div class="ma" role="dialog" aria-label="Connection mapping suggestion">
    <header class="ma-hdr">
      <div class="ma-title">
        <span class="ma-spark">✦</span>
        <span class="ma-route"><b>{proposal.sourceLabel}</b> → <b>{proposal.targetLabel}</b></span>
      </div>
      <div class="ma-meta">
        <span class="ma-compat ma-compat-{proposal.compatibility.level}">{proposal.compatibility.level}</span>
        <span class="ma-prov">{proposal.provenance === 'llm' ? 'AI' : 'auto'}</span>
        <button type="button" class="ma-x" onclick={onDismiss} aria-label="dismiss">×</button>
      </div>
    </header>

    {#if proposal.rationale}
      <p class="ma-rationale">{proposal.rationale}</p>
    {/if}

    {#if settable.length > 0}
      <ul class="ma-actions">
        {#each settable as { a, i } (i)}
          <li class="ma-action">
            <label class="ma-check">
              <input type="checkbox" checked={!excluded.has(i)} onchange={() => toggle(i)} />
              <span class="ma-action-body">
                <span class="ma-action-label">
                  {a.label}
                  {#if a.unverifiedRef}<span class="ma-warn" title="references a field the upstream may not emit">unverified</span>{/if}
                </span>
                {#if a.field}<code class="ma-field">{a.field} = {typeof a.value === 'string' ? a.value : JSON.stringify(a.value)}</code>{/if}
                {#if a.detail}<span class="ma-action-detail">{a.detail}</span>{/if}
              </span>
            </label>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="ma-empty">No automatic field mapping — open the target's panel to wire it from the upstream.</p>
    {/if}

    {#if advisory.length > 0}
      <ul class="ma-advisory">
        {#each advisory as a, k (k)}
          <li><span class="ma-adv-badge {badgeClass(a)}">{a.kind === 'insert-node' ? 'suggest node' : 'note'}</span> {a.label}{#if a.detail} — <span class="ma-adv-detail">{a.detail}</span>{/if}</li>
        {/each}
      </ul>
    {/if}

    <footer class="ma-foot">
      <button type="button" class="ma-btn ma-dismiss" onclick={onDismiss} disabled={applying}>Dismiss</button>
      {#if settable.length > 0}
        <button type="button" class="ma-btn ma-apply" onclick={apply} disabled={applying || selectedCount === 0}>
          {applying ? 'Applying…' : selectedCount === settable.length ? 'Apply all' : `Apply ${selectedCount}`}
        </button>
      {/if}
    </footer>
  </div>
{/if}

<style>
  .ma {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 60;
    width: 340px;
    max-width: calc(100vw - 40px);
    background: var(--surface-elevated, var(--bg));
    border: 1px solid var(--card-border);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.28);
    font-family: var(--font-sans, system-ui);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }
  .ma-pending {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    width: auto;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .ma-spark { color: var(--accent-ink, var(--accent, #b5651d)); }

  .ma-hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ma-title { display: flex; align-items: center; gap: 6px; font-size: var(--fs-label); min-width: 0; }
  .ma-route { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ma-route b { color: var(--text-primary); }
  .ma-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .ma-compat, .ma-prov {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em;
    padding: 0 4px; border: 1px solid var(--card-border); color: var(--text-ghost);
  }
  .ma-compat-direct { color: var(--status-success, #2a9d4a); border-color: currentColor; }
  .ma-compat-incompatible { color: var(--status-error, #c0392b); border-color: currentColor; }
  .ma-compat-transform { color: var(--accent-ink, #b5651d); border-color: currentColor; }
  .ma-x {
    background: transparent; border: none; color: var(--text-ghost);
    font-size: var(--fs-body); line-height: 1; cursor: pointer; padding: 0 2px;
  }
  .ma-x:hover { color: var(--text-primary); }

  .ma-rationale { margin: 0; font-size: var(--fs-label); color: var(--text-muted); line-height: 1.45; }

  .ma-actions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
  .ma-check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
  .ma-check input { margin-top: 2px; width: auto; flex-shrink: 0; }
  .ma-action-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ma-action-label { font-size: var(--fs-label); color: var(--text-primary); }
  .ma-field {
    font-family: var(--font-code); font-size: var(--fs-label-xs); color: var(--text-muted);
    background: color-mix(in srgb, var(--card-border) 20%, transparent);
    padding: 1px 4px; word-break: break-all; align-self: flex-start;
  }
  .ma-action-detail { font-size: var(--fs-label); color: var(--text-ghost); line-height: 1.35; }
  .ma-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); margin-left: 4px; text-transform: uppercase; }

  .ma-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }

  .ma-advisory { list-style: none; margin: 0; padding: 6px 0 0; border-top: 1px dashed var(--card-border); display: flex; flex-direction: column; gap: 4px; }
  .ma-advisory li { font-size: var(--fs-label); color: var(--text-muted); line-height: 1.35; }
  .ma-adv-badge { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; padding: 0 4px; border: 1px solid var(--card-border); margin-right: 4px; }
  .ma-adv-insert { color: var(--accent-ink, #b5651d); }
  .ma-adv-detail { color: var(--text-ghost); }

  .ma-foot { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
  .ma-btn {
    font-family: var(--font-mono); font-size: var(--fs-label);
    padding: 5px 12px; cursor: pointer; border: 1px solid var(--card-border);
    background: transparent; color: var(--text-muted);
  }
  .ma-btn:disabled { opacity: 0.5; cursor: default; }
  .ma-dismiss:hover:not(:disabled) { border-color: var(--text-muted); }
  .ma-apply {
    background: var(--accent-ink, var(--accent, #b5651d));
    color: var(--bg, #fff);
    border-color: var(--accent-ink, var(--accent, #b5651d));
  }
  .ma-apply:hover:not(:disabled) { filter: brightness(1.05); }
</style>
