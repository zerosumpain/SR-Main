<script lang="ts">
  // Verification — the chain a repo build walks, and the gates it runs. Phases come from the
  // RepoVerificationPhase type (VERIFY_COPY is checked against it) and gate names from
  // codegraph/gates.ts.
  //
  // Bands: the proof chain under the headline, the gates on ink, and the hands-off rules on
  // paper with a drawing of the one door the builder can't open.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Masthead from '../../components/kit/Masthead.svelte';
  import ProofChain from '../../components/art/build/ProofChain.svelte';
  import { BUILD_COPY as C, VERIFY_COPY, GATE_COPY, VERIFY_EXTRA as X } from '../../lib/build';
  import { app } from '../../lib/appState.svelte';
  import { cascade, shown } from '../../lib/motion';
  import type { RepoVerificationPhase } from '$lib/verification/repo';
  import type { GateName } from '$lib/codegraph/gates';

  let { data } = $props();
  const f = $derived(data.facts.build);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  const phases = Object.keys(VERIFY_COPY) as RepoVerificationPhase[];
  const links = $derived(phases.map((p) => ({ id: p, label: VERIFY_COPY[p].label, text: t(VERIFY_COPY[p]) })));
  let phase = $state<string>('feedback_gate');
  let snapped = $state<string | null>(null);
  const status = $derived.by(() => {
    if (!snapped) return t(X.whole);
    const i = phases.indexOf(snapped as RepoVerificationPhase), j = phases.indexOf(phase as RepoVerificationPhase);
    return j > i ? 'This step never runs, because an earlier link is broken.' : j === i ? t(X.snapped) : 'This step passed before the break.';
  });
</script>

<svelte:head><title>Verification — Build — The Engine Room</title></svelte:head>

<LeafHead part="build" title="Verification" line={C.verify.line.eng} lineEli5={C.verify.line.plain}>
  {#snippet art()}
    <p class="hint">{t(X.chain)}</p>
    <ProofChain {links} {snapped} selected={phase} onselect={(id) => (phase = id)} onsnap={(id) => (snapped = id)} />
    <div class="detail" class:bad={!!snapped} aria-live="polite">
      <b>{VERIFY_COPY[phase as RepoVerificationPhase].label}</b>
      <p>{t(VERIFY_COPY[phase as RepoVerificationPhase])}</p>
      <p class="st">{status}</p>
    </div>
  {/snippet}
</LeafHead>

<Band surface="ink" part="build">
  <Masthead kicker="The gate" lines={['What “passing”', '*means*']} strap={t(X.gates)} />
  <ul class="gates" {@attach cascade()}>
    {#each f.gates as g (g)}
      <li>
        <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L35 9 V20 C35 29 28 35 20 37 C12 35 5 29 5 20 V9 Z" /><path class="tk" d="M13 20 L18 25 L28 14" /></svg>
        <code>{g}</code>
        <span>{GATE_COPY[g as GateName]}</span>
      </li>
    {/each}
  </ul>
</Band>

<Band surface="paper" part="build">
  <div class="hands">
    <div>
      <Masthead kicker="Hands off" lines={['What it may', 'never touch *alone*']} strap={t(C.verify.rails)} size="md" />
      <p class="er-prose rev">{t(X.reviewer)}</p>
    </div>
    <svg class="door" viewBox="0 0 320 300" role="img" aria-label="A locked folder of protected files. The builder's arm reaches for it and is turned back; only I hold the key." {@attach shown()}>
      <rect class="folder" x="70" y="80" width="190" height="150" rx="2" />
      <path class="tab" d="M70 80 V64 H140 L152 80" />
      {#each [110, 140, 170, 200] as y, i}<line class="file" x1="96" y1={y} x2={226 - i * 14} y2={y} pathLength="1" data-draw style="--d:{i * 0.1}s" />{/each}
      <g class="lock" data-pop style="--d:0.6s">
        <path class="shackle" d="M150 168 V150 A15 15 0 0 1 180 150 V168" />
        <rect x="140" y="166" width="50" height="40" rx="2" />
        <circle cx="165" cy="184" r="5" />
      </g>
      <g class="arm"><path d="M0 40 H40 L60 60" /><circle cx="64" cy="64" r="8" /></g>
      <g class="key" data-pop style="--d:1s"><circle cx="276" cy="262" r="12" /><path d="M264 262 H226 M236 262 V272 M246 262 V270" /></g>
      <text x="300" y="296" text-anchor="end">only I hold the key</text>
    </svg>
  </div>
</Band>

<PageFoot />

<style>
  .hint { margin: 0 0 18px; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; color: var(--fg-3); }
  .detail { margin-top: 26px; padding: 20px 22px; border-left: 4px solid var(--tone); background: var(--wash); }
  .detail.bad { border-left-color: var(--fail); }
  .detail b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(22px, 2.2vw, 30px); color: var(--fg); }
  .detail p { margin: 8px 0 0; font-size: var(--fs-body); line-height: 1.6; color: var(--fg-2); max-width: 72ch; }
  .detail .st { font-family: var(--er-mono); font-size: var(--fs-label); color: var(--tone-text); }
  .detail.bad .st { color: var(--fail); }

  .gates { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
  .gates li { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 4px 14px; align-items: center; padding: 18px; background: var(--ground); }
  .gates svg { grid-row: span 2; width: 40px; height: 40px; }
  .gates svg path { fill: none; stroke: var(--tone-text); stroke-width: 2.5; }
  .gates svg .tk { stroke: var(--fg); }
  .gates code { font-family: var(--er-mono); font-size: var(--fs-label); color: var(--fg); }
  .gates span { font-size: var(--fs-label); color: var(--fg-2); }

  .hands { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: clamp(24px, 4vw, 64px); align-items: center; }
  .rev { max-width: 60ch; }
  .door { width: 100%; max-width: 420px; height: auto; justify-self: center; overflow: visible; }
  .folder { fill: var(--er-paper-hi); stroke: var(--fg); stroke-width: 3; }
  .tab { fill: none; stroke: var(--fg); stroke-width: 3; }
  .file { stroke: var(--rule-strong); stroke-width: 6; }
  .lock rect { fill: var(--you); }
  .lock .shackle { fill: none; stroke: var(--you); stroke-width: 7; }
  .lock circle { fill: var(--er-paper-hi); }
  .arm path { fill: none; stroke: var(--tone); stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; }
  .arm circle { fill: var(--tone); }
  .arm { transform: translate(40px, 88px); animation: reach 3.2s var(--er-ease) infinite; }
  @keyframes reach { 0%, 100% { transform: translate(0, 60px); } 45% { transform: translate(52px, 96px); } 55% { transform: translate(40px, 88px); } }
  .key circle, .key path { fill: none; stroke: var(--you); stroke-width: 5; }
  text { font-family: var(--er-mono); font-size: 15px; fill: var(--you); }
  @media (max-width: 860px) { .hands { grid-template-columns: minmax(0, 1fr); } }
</style>
