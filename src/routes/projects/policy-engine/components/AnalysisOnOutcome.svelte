<script lang="ts">
  // AnalysisOnOutcome — "what others have found about this number". Attaches third-party
  // analyses to a specific outcome (or lever, or theme) so the evidence sits ON the
  // shoulders of the live result rather than only calibrating an input. Shows each source's
  // openly-declared lean and a strength tag. Self-contained.
  import { analysesForOutcome, analysesForLever, analysesForTheme, type Analysis, LEAN_META } from '../lib/evidence.ts';

  interface Props {
    outcome?: string;
    lever?: string;
    theme?: string;
    /** Or pass an explicit list of analyses. */
    items?: Analysis[];
    title?: string;
    max?: number;
  }
  let { outcome, lever, theme, items, title = 'What the analysts find', max = 6 }: Props = $props();

  const list = $derived.by<Analysis[]>(() => {
    if (items) return items;
    if (outcome) return analysesForOutcome(outcome);
    if (lever) return analysesForLever(lever);
    if (theme) return analysesForTheme(theme);
    return [];
  });
  const shown = $derived(list.slice(0, max));

  const STRENGTH: Record<string, { label: string; color: string }> = {
    strong: { label: 'strong', color: '#2f7d4f' },
    moderate: { label: 'moderate', color: '#9a7b1f' },
    contested: { label: 'contested', color: '#b4455e' },
    illustrative: { label: 'illustrative', color: '#7a5aa6' },
  };
</script>

{#if shown.length}
  <div class="aoo">
    <div class="aoo-head">
      <span class="aoo-title">{title}</span>
      <span class="aoo-count">{list.length} {list.length === 1 ? 'source' : 'sources'}</span>
    </div>
    <ul class="aoo-list">
      {#each shown as a (a.id)}
        {@const lm = LEAN_META[a.lean]}
        {@const st = STRENGTH[a.strength]}
        <li class="aoo-item">
          <div class="ai-top">
            <span class="ai-org">{a.org}</span>
            <span class="ai-lean" style="color:{lm.color}" title={lm.note}>{lm.label}</span>
            <span class="ai-strength" style="color:{st.color}">{st.label}</span>
            <span class="ai-year">{a.year}</span>
          </div>
          <p class="ai-claim">{a.claim}</p>
          {#if a.url}<a class="ai-src" href={a.url} target="_blank" rel="noopener">{a.title} ↗</a>{:else}<span class="ai-src plain">{a.title}</span>{/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .aoo { border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.35); padding: 9px 11px; margin: 10px 0; }
  .aoo-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .aoo-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px; color: var(--ink); }
  .aoo-count { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.45); }
  .aoo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .aoo-item { border-left: 2px solid rgba(28,22,17,0.12); padding-left: 9px; }
  .ai-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; }
  .ai-org { font-family: 'Fraunces', serif; font-weight: 600; font-size: 12.5px; color: var(--ink); }
  .ai-lean, .ai-strength { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .ai-year { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.4); margin-left: auto; }
  .ai-claim { margin: 2px 0 3px; font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.82); }
  .ai-src { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent-ink); text-decoration: none; }
  .ai-src:hover { text-decoration: underline; }
  .ai-src.plain { color: rgba(28,22,17,0.45); }
</style>
