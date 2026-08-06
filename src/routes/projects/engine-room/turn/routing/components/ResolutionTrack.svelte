<script lang="ts">
  // ResolutionTrack — the four things that can decide which model runs, as a track you
  // operate instead of four paragraphs of prose.
  //
  // RAILED on purpose. RESOLUTION documents itself as a four-layer chain where the first
  // match wins, so drawing them as four unordered mechanisms would contradict the source.
  // The numbers and the readout text are the constants' own, compressed only in wording.
  import Steps from '../../../components/viz/Steps.svelte';
  import { app } from '../../../lib/appState.svelte';
  import { RESOLUTION } from '../../../lib/models';

  interface Props { tone?: string }
  let { tone = 'var(--accent-ink)' }: Props = $props();

  /** The constants' own `what`, compressed to a readout line. No fact changed. */
  const DECIDES: Record<string, string> = {
    '1': 'Set by hand on one call or node, because someone had a reason.',
    '2': 'A profile — general, tool-use, retrieval, agentic — resolved to last night’s winner.',
    '3': 'Three unattended pipelines pin their own model, with the reasoning written at the constant.',
    '4': 'One value from settings. Sixty-one files reach for it; exactly two places construct a client.',
  };
  /** The constants' own `when`, same compression. */
  const FIRES: Record<string, string> = {
    '1': 'Rare. Only when one particular model will do.',
    '2': '04:00 Europe/London — price, capability, observed success.',
    '3': 'Self-improvement, the workflow doctor, the builder.',
    '4': 'Everything the other three do not cover.',
  };
  const SUB: Record<string, string> = { '1': 'manual', '2': '04:00', '3': 'three jobs', '4': 'fallback' };

  // Opens on the auction: it is the only one that moves on its own.
  let picked = $state('2');
  const row = $derived(RESOLUTION.find((l) => l.n === picked) ?? RESOLUTION[0]);
  const eli = $derived(app.narrative === 'eli5');
  const items = $derived(RESOLUTION.map((l) => ({ id: l.n, label: l.name, sub: SUB[l.n] })));
</script>

<div class="rt" style="--tone:{tone}">
  <Steps {items} selected={picked} onselect={(id) => (picked = id)} {tone} />

  <dl class="rt-out" aria-live="polite">
    <div class="o-row">
      <dt>Decides</dt>
      <dd>{eli ? row.eli5 : DECIDES[row.n]}</dd>
    </div>
    <div class="o-row">
      <dt>Fires</dt>
      <dd class="dim">{FIRES[row.n]}</dd>
    </div>
  </dl>
</div>

<style>
  .rt { display: flex; flex-direction: column; gap: 11px; }

  .rt-out { margin: 0; padding: 10px 14px; min-height: 5.4em;
    border-left: 3px solid var(--tone); border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--tone) 7%, transparent); }
  .o-row { display: grid; grid-template-columns: minmax(0, 7ch) 1fr; gap: 4px 12px; align-items: baseline; }
  .o-row + .o-row { margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(28,22,17,0.15); }

  dt { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--tone); }
  dd { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-primary); max-width: 78ch; }
  dd.dim { font-size: 12.5px; color: rgba(28,22,17,0.62); }

  @media (max-width: 520px) {
    .o-row { grid-template-columns: 1fr; gap: 2px; }
  }
</style>
