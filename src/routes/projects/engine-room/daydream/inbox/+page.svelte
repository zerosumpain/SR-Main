<script lang="ts">
  // Inbox — the stages every note moves through, the double-check state machine, the steps a
  // note can carry out, and what a double-check can conclude. Stage names and the plain line
  // for each are the feature's own (STAGE_LABEL and STAGE_EXPLAIN); the lists of states, kinds
  // and verdicts come from facts, so a new one appears here and fails the type check on its
  // copy map until it has a sentence.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import NoteJourney from '../../components/art/daydream/NoteJourney.svelte';
  import VerdictScales from '../../components/art/daydream/VerdictScales.svelte';
  import { DAYDREAM_COPY as C, STAGE_ENG, STAGE_TURN, COMMISSION_COPY, ACT_COPY, ACT_BADGE, VERDICT_COPY } from '../../lib/daydream';
  import { app } from '../../lib/appState.svelte';
  import { cascade, reveal } from '../../lib/motion';
  import { words } from '../../lib/format';
  import type { Stage } from '$lib/daydream/think/explain';
  import type { CommissionState } from '$lib/daydream/commissioning';
  import type { ActKind } from '$lib/daydream/act/plan';
  import type { RedTeamVerdict } from '$lib/daydream/red-team';

  let { data } = $props();
  const f = $derived(data.facts.daydream);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  const stages = $derived(f.stages.map((s) => {
    const turn = STAGE_TURN[s.id as Stage];
    return { id: s.id, label: s.label, text: eli ? s.explain : STAGE_ENG[s.id as Stage], who: turn.who, turn: t(turn) };
  }));

  // Grouped by the feature's own nextActor(), so a state that changes hands moves lane here too.
  const ACTOR: Record<string, { head: string; sub: string; key: string }> = {
    You: { head: 'Waiting on me', sub: 'nothing moves until I answer', key: 'me' },
    jkai: { head: 'Running', sub: 'it’s working on it', key: 'it' },
    Nobody: { head: 'Finished', sub: 'nobody needs to act', key: 'done' },
  };
  const ORDER = ['You', 'jkai', 'Nobody'];
  const actors = $derived([...new Set(f.commissions.map((c) => c.actor))].sort((a, b) => (ORDER.indexOf(a) + 9) % 9 - (ORDER.indexOf(b) + 9) % 9));
  let commission = $state<string | null>(null);
  const picked = $derived(f.commissions.find((c) => c.id === commission) ?? null);

  let done = $state<Record<string, boolean>>({});
  let verdict = $state<string | null>('holds');
</script>

<svelte:head><title>Inbox — Daydream — The Engine Room</title></svelte:head>

<LeafHead part="daydream" title="Inbox" line={C.inbox.line.eng} lineEli5={C.inbox.line.plain}>
  {#snippet art()}<NoteJourney {stages} />{/snippet}
</LeafHead>

<Band surface="ink" part="daydream" label="The double-check">
  <div class="split">
    <header>
      <span class="er-kicker">The double-check</span>
      <h2 class="er-display sec-title" {@attach reveal({ y: 30 })}>Asking it to<br />argue with itself</h2>
      <p class="er-lede">{t(C.inbox.check)}</p>
    </header>
    <div>
      <div class="lanes" {@attach cascade()}>
        {#each actors as a (a)}
          {@const A = ACTOR[a] ?? { head: a, sub: '', key: 'done' }}
          <section class="lane" data-k={A.key}>
            <header class="l-head"><span class="l-dot" aria-hidden="true"></span><b>{A.head}</b><span>{A.sub}</span></header>
            <div class="chips">
              {#each f.commissions.filter((c) => c.actor === a) as c (c.id)}
                <button class="chip" class:on={commission === c.id} aria-pressed={commission === c.id}
                  onclick={() => (commission = commission === c.id ? null : c.id)}>{c.label}</button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
      <p class="say" aria-live="polite">{#if picked}<b>{picked.label}.</b> {t(COMMISSION_COPY[picked.id as CommissionState])}{:else}Every state a double-check can be in, sorted by who has to act next. Pick one.{/if}</p>
    </div>
  </div>
</Band>

<Band surface="paper" part="daydream" label="Do it for me">
  <header class="head">
    <span class="er-kicker">Do it for me</span>
    <h2 class="er-display sec-title" {@attach reveal({ y: 30 })}>One tap from<br />a note to done</h2>
    <p class="er-lede">{t(C.inbox.act)}</p>
  </header>
  <div class="acts" {@attach cascade()}>
    {#each f.actKinds as k (k)}
      {@const tried = done[k]}
      <article class="act" class:tried data-k={k}>
        <div class="a-ico" aria-hidden="true">
          <svg viewBox="0 0 48 48">
            {#if k === 'calendar_event' || k === 'calendar_move'}
              <rect x="6" y="10" width="36" height="32" rx="2" /><path d="M6 19 H42 M15 5 V14 M33 5 V14" />
              {#if k === 'calendar_move'}<path class="acc" d="M16 31 H32 M27 26 L32 31 L27 36" />{:else}<rect class="accf" x="14" y="25" width="10" height="9" />{/if}
            {:else if k === 'reminder'}
              <path d="M12 34 V22 a12 12 0 0 1 24 0 V34 L40 38 H8Z" /><path class="acc" d="M20 42 H28" />
            {:else}
              <rect x="5" y="11" width="38" height="26" rx="2" /><path d="M5 13 L24 27 L43 13" /><path class="acc" d="M30 40 L38 32 L42 36 L34 44Z" />
            {/if}
          </svg>
          {#if tried}<span class="tick">{k === 'email_draft' ? '✎' : '✓'}</span>{/if}
        </div>
        <h3>{words(k)}</h3>
        <span class="badge" class:draft={k === 'email_draft'}>{ACT_BADGE[k as ActKind]}</span>
        <p>{t(ACT_COPY[k as ActKind])}</p>
        <button class="try" onclick={() => (done = { ...done, [k]: !tried })}>
          {#if !tried}Try it{:else if k === 'email_draft'}Draft ready, sending is mine{:else}Done. Undo{/if}
        </button>
      </article>
    {/each}
  </div>
</Band>

<Band surface="ink" part="daydream" label="What the double-check can conclude">
  <div class="split">
    <header>
      <span class="er-kicker">Arguing back</span>
      <h2 class="er-display sec-title" {@attach reveal({ y: 30 })}>Three honest<br />answers</h2>
      <p class="er-lede">{eli
        ? 'It restates the note, asks how it could be wrong, and tests each doubt. Then it has to say one of these.'
        : 'The checker restates the claim, generates refutation hypotheses and tests each against the evidence, then returns one of the verdicts below.'}</p>
    </header>
    <div>
      <VerdictScales verdicts={f.checkVerdicts} picked={verdict} onpick={(v) => (verdict = v)} label={words} />
      <p class="say" aria-live="polite">{#if verdict}{t(VERDICT_COPY[verdict as RedTeamVerdict])}{/if}</p>
    </div>
  </div>
  <p class="ruling"><span class="r-k">And my own ruling</span>{t(C.inbox.ruling)}</p>
</Band>

<PageFoot />

<style>
  .split { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: clamp(28px, 5vw, 80px); align-items: center; }
  .split .sec-title, .head .sec-title { font-size: clamp(32px, 4.2vw, 62px); margin-bottom: 20px; }
  .head { max-width: 860px; margin-bottom: clamp(24px, 3vw, 40px); }
  @media (max-width: 900px) { .split { grid-template-columns: minmax(0, 1fr); } }

  .lanes { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  .lane { border-top: 4px solid var(--fg-3); padding: 14px 0 0; display: flex; flex-direction: column; gap: 12px; }
  .lane[data-k='me'] { border-top-color: var(--you); }
  .lane[data-k='it'] { border-top-color: var(--tone); }
  .l-head { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: center; }
  .l-head b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 20px; color: var(--fg); }
  .l-head span:last-child { grid-column: 2; font-size: var(--fs-label); color: var(--fg-3); }
  .l-dot { width: 12px; height: 12px; border-radius: var(--radius-pill); background: var(--fg-3); }
  [data-k='me'] .l-dot { background: var(--you); }
  [data-k='it'] .l-dot { background: var(--tone); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { transform: scale(1.6); opacity: 0.5; } }
  .chips { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .chip { font-size: var(--fs-label); padding: 8px 14px; border-radius: var(--radius-pill); border: 1px solid var(--rule-strong); background: transparent; color: var(--fg); cursor: pointer; text-align: left; transition: background 0.2s, border-color 0.2s; }
  .chip:hover { border-color: var(--fg); }
  .chip.on { background: var(--fg); color: var(--ground); border-color: var(--fg); }
  .say { margin: 22px 0 0; min-height: 3.2em; font-size: var(--fs-body); line-height: 1.6; color: var(--fg-2); }
  .say b { color: var(--fg); }

  .acts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
  .act { background: var(--lift); padding: 24px; display: flex; flex-direction: column; gap: 12px; transition: background 0.4s; }
  .act.tried { background: var(--er-paper-hi); }
  .a-ico { position: relative; width: 64px; height: 64px; }
  .a-ico svg { width: 100%; height: 100%; }
  .a-ico svg * { fill: none; stroke: var(--fg); stroke-width: 2.5; stroke-linejoin: round; }
  .a-ico .acc { stroke: var(--tone-text); stroke-width: 3; }
  .a-ico .accf { fill: var(--tone); stroke: none; }
  .tick { position: absolute; right: -8px; top: -8px; width: 28px; height: 28px; border-radius: var(--radius-pill); background: var(--you); color: #fff; display: grid; place-items: center; font-size: 15px;
    animation: popin 0.5s var(--er-ease); }
  @keyframes popin { from { transform: scale(0); } }
  .act h3 { margin: 0; font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 22px; color: var(--fg); }
  .badge { align-self: flex-start; font-family: var(--er-mono); font-size: var(--fs-label-xs); padding: 3px 10px; border-radius: var(--radius-pill); background: var(--tone); color: var(--er-ink); }
  .badge.draft { background: transparent; border: 1px solid var(--you); color: var(--you); }
  .act p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: var(--fg-2); flex: 1; }
  .try { align-self: flex-start; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; text-transform: uppercase; padding: 9px 14px;
    border-radius: var(--radius-pill); border: 1px solid var(--fg); background: transparent; color: var(--fg); cursor: pointer; transition: background 0.2s, color 0.2s; }
  .try:hover { background: var(--fg); color: var(--ground); }
  .act.tried .try { border-color: var(--you); color: var(--you); }

  .ruling { margin: clamp(28px, 4vw, 48px) 0 0; padding-top: 22px; border-top: 2px solid var(--fg); display: grid; grid-template-columns: minmax(0, 0.5fr) minmax(0, 1.5fr); gap: 14px 40px;
    font-family: var(--er-serif); font-style: italic; font-size: clamp(18px, 1.6vw, 22px); line-height: 1.45; color: var(--fg); }
  .r-k { font-family: var(--er-mono); font-style: normal; font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--tone-text); padding-top: 6px; }
  @media (max-width: 700px) { .ruling { grid-template-columns: minmax(0, 1fr); } }
</style>
