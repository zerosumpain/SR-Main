<script lang="ts">
  // The one hover card for the whole assessment.
  //
  // Ask 2: heavy use of hover cards, and where an actor is mentioned the card
  // should show the right thing for where it is mentioned. So the card is
  // CONTEXT-AWARE BY SUBJECT KIND rather than by identifier: the anchor says
  // `actor:` or `play:` or `term:`, and each renders the two or three fields
  // that answer "is this worth opening" for that kind. One component, five
  // renderings, one mount.
  //
  // ON PAPER, ALWAYS — the same rule the health hub's card follows. It floats
  // over a document that alternates ink and cream bands, and a layer that
  // changed register depending on what was under it would read as two different
  // components. It sets its own colours and inherits none.
  //
  // It answers nothing the page does not already know. Every figure in here was
  // computed by `view.ts`, `actors.ts` or `glossary.ts`; the card is a second
  // place to READ them, never a second opinion about them.
  import { policyPeek, peekPlacement, PEEK_WIDTH } from '$lib/policy-analysis/peek.svelte';
  import { explain } from '$lib/policy-analysis/glossary';
  import { BAND_FILL, BAND_LABEL, type Band, type Play, type ActorView } from '$lib/policy-analysis/view';
  import type { Artefact } from '$lib/policy-analysis/contracts';

  interface Props {
    artefacts: Artefact[];
    plays: Play[];
    actors: ActorView[];
    /** How many things cite each assumption — the stress test's own count. */
    leverage?: Map<string, number>;
    /** Open the drill on this subject. */
    onopen: (id: string) => void;
    /** Jump to a tab — used by the assumption card's "stress it" affordance. */
    ontab?: (id: string) => void;
  }

  let { artefacts, plays, actors, leverage = new Map(), onopen, ontab }: Props = $props();

  const anchor = $derived(policyPeek.current);

  // Measured after the card exists; until then `peekPlacement` uses its own
  // estimate. A plain `let` would not re-place the card when the height lands,
  // so this one IS state — unlike the controller's timers, which nothing
  // reactive reads.
  let cardEl: HTMLDivElement | null = $state(null);
  let measured = $state(0);

  $effect(() => {
    void anchor?.subject;
    void anchor?.kind;
    if (!cardEl) return;
    const h = cardEl.getBoundingClientRect().height;
    if (h && Math.abs(h - measured) > 1) measured = h;
  });

  const placement = $derived(anchor ? peekPlacement(anchor.rect, measured || 260) : null);

  const artefact = $derived(anchor && anchor.kind !== 'term' ? (artefacts.find((a) => a.id === anchor.subject) ?? null) : null);
  const term = $derived(anchor?.kind === 'term' ? explain(anchor.subject) : null);
  const play = $derived(anchor?.kind === 'play' ? (plays.find((p) => p.artefact.id === anchor.subject) ?? null) : null);
  const actorView = $derived(anchor?.kind === 'actor' ? (actors.find((a) => a.actor.id === anchor.subject) ?? null) : null);

  const pct = (v: unknown) => `${Math.round((Number(v) || 0) * 100)}`;
  const profileField = (key: string) => {
    const raw = actorView?.profile?.data?.[key];
    if (!raw || typeof raw !== 'object') return null;
    const f = raw as { value?: string };
    return f.value ?? null;
  };

  function onkeydown(e: KeyboardEvent) {
    if (policyPeek.current && e.key === 'Escape') policyPeek.close();
  }

  /**
   * A scroll dismisses the card.
   *
   * The anchor rect is captured in viewport coordinates when the card opens, so
   * the moment the page moves under it the card is describing whatever has
   * scrolled into that spot. Dismiss rather than reposition — a card that chases
   * its trigger up the page is worse than one that gets out of the way.
   */
  function onscroll() {
    if (policyPeek.current) policyPeek.close();
  }

  function open() {
    const id = anchor?.kind === 'term' ? null : anchor?.subject;
    policyPeek.close();
    if (id) onopen(id);
  }
</script>

<svelte:window {onkeydown} {onscroll} />

{#if anchor && placement && (term || artefact)}
  <!-- Not a dialog. It describes the thing under the pointer, and trapping
       focus in a hover card would make it a modal. `role="tooltip"` with the
       pointer handlers is what lets the pointer travel into it. -->
  <div
    bind:this={cardEl}
    class="pk"
    role="tooltip"
    style="left: {placement.left}px; top: {placement.top}px; width: {PEEK_WIDTH}px; max-height: {placement.maxHeight}px;"
    onmouseenter={() => policyPeek.keepOpen()}
    onmouseleave={() => policyPeek.release()}
  >
    {#if term}
      <p class="pk-kind">What this column means</p>
      <p class="pk-name">{term.label}</p>
      <p class="pk-what">{term.what}</p>
      <p class="pk-line"><span class="pk-line-label">Why it is here</span> {term.why}</p>
      <p class="pk-line"><span class="pk-line-label">Reading it</span> {term.read}</p>
      <div class="pk-foot"><span class="pk-cite">{term.provenance}</span></div>

    {:else if play && artefact}
      <p class="pk-kind">Exploitation play</p>
      <p class="pk-name">{artefact.label}</p>
      <p class="pk-band" style="background: {BAND_FILL[play.band as Band]}" class:on-dark={play.band === 'severe'}>
        {BAND_LABEL[play.band as Band]} · exposure {pct(play.exposure)}
      </p>
      <p class="pk-what">{play.actor?.label ?? 'Actor unresolved'}{String(artefact.data.legality) === 'compliant' ? ' — stays within the rules as written' : ''}</p>
      <div class="pk-bars">
        {#each play.factors as factor (factor.key)}
          <div class="pk-bar">
            <span class="pk-bar-key">{factor.key}</span>
            <span class="pk-track"><span class="pk-fill" style="width: {pct(factor.value)}%"></span></span>
            <span class="pk-bar-val">{pct(factor.value)}</span>
          </div>
        {/each}
      </div>
      <div class="pk-foot">
        <span class="pk-cite">severity, not certainty</span>
        <button type="button" class="pk-open" onclick={open}>Open the play →</button>
      </div>

    {:else if actorView}
      <p class="pk-kind">{actorView.actor.data.entityType ? String(actorView.actor.data.entityType).replaceAll('_', ' ') : 'Actor'}</p>
      <p class="pk-name">{actorView.actor.label}</p>
      {#if profileField('gainFromFailure')}
        <p class="pk-pointed"><span class="pk-line-label">Better off if it fails</span> {profileField('gainFromFailure')}</p>
      {/if}
      {#if profileField('successCriteria')}
        <p class="pk-line"><span class="pk-line-label">Judged on</span> {profileField('successCriteria')}</p>
      {/if}
      {#if profileField('accountableTo')}
        <p class="pk-line"><span class="pk-line-label">Answers to</span> {profileField('accountableTo')}</p>
      {/if}
      {#if actorView.plays.length}
        <p class="pk-line">
          <span class="pk-line-label">Can run</span>
          {actorView.plays.length} {actorView.plays.length === 1 ? 'play' : 'plays'}, worst
          <strong>{BAND_LABEL[(actorView.plays[0].band as Band)]}</strong> at {pct(actorView.worst)}
        </p>
      {:else}
        <p class="pk-line pk-none">No exploitation play was found for this body. That is a finding, not a guarantee.</p>
      {/if}
      <div class="pk-foot">
        <span class="pk-cite">{actorView.profile ? 'profiled' : 'not profiled'}</span>
        <button type="button" class="pk-open" onclick={open}>Open the body →</button>
      </div>

    {:else if artefact && anchor.kind === 'assumption'}
      <p class="pk-kind">Assumption</p>
      <p class="pk-name">{artefact.label}</p>
      <p class="pk-what">{artefact.statement}</p>
      <div class="pk-bars">
        {#each [['importance', 'importance'], ['uncertainty', 'uncertainty'], ['consequence', 'consequence']] as [key, label] (key)}
          <div class="pk-bar">
            <span class="pk-bar-key">{label}</span>
            <span class="pk-track"><span class="pk-fill" style="width: {pct(artefact.data[key])}%"></span></span>
            <span class="pk-bar-val">{pct(artefact.data[key])}</span>
          </div>
        {/each}
      </div>
      <p class="pk-line">
        <span class="pk-line-label">Rests on it</span>
        {leverage.get(artefact.id) ?? 0}
        {(leverage.get(artefact.id) ?? 0) === 1 ? 'part of the assessment' : 'parts of the assessment'}
      </p>
      <div class="pk-foot">
        {#if ontab && (leverage.get(artefact.id) ?? 0) > 0}
          <button type="button" class="pk-open pk-ghost" onclick={() => { policyPeek.close(); ontab?.('stress'); }}>Stress it →</button>
        {/if}
        <button type="button" class="pk-open" onclick={open}>Open it →</button>
      </div>

    {:else if artefact}
      <p class="pk-kind">{artefact.kind.replaceAll('_', ' ')}</p>
      <p class="pk-name">{artefact.label}</p>
      <p class="pk-what">{artefact.statement}</p>
      <p class="pk-line">
        <span class="pk-line-label">Where it came from</span>
        {artefact.origin.replaceAll('_', ' ')}{artefact.page ? ` · page ${artefact.page}` : ''}
      </p>
      <div class="pk-foot">
        <span class="pk-cite">{artefact.refs.length} {artefact.refs.length === 1 ? 'reference' : 'references'}</span>
        <button type="button" class="pk-open" onclick={open}>Open it →</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .pk {
    position: fixed;
    z-index: 220;
    overflow-y: auto;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    padding: 13px 15px 11px;
    box-sizing: border-box;
    /* The one shadow on this page. A floating layer over an editorial document
       has to read as ABOVE it, and a hairline alone does not do that on a cream
       ground it shares a value with. */
    box-shadow: 0 8px 28px rgba(26, 16, 8, 0.18);
  }

  .pk-kind,
  .pk-line-label,
  .pk-cite,
  .pk-bar-key {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }
  .pk-name {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.1;
    letter-spacing: -0.01em;
    margin: 5px 0 0;
    overflow-wrap: anywhere;
  }
  .pk-what {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 9px 0 0;
    text-wrap: pretty;
  }
  .pk-line {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 8px 0 0;
    text-wrap: pretty;
  }
  .pk-line-label {
    margin-right: 4px;
  }
  .pk-none {
    border-left: 2px solid var(--line-strong);
    padding-left: 8px;
  }
  /* The question an assurance review never asks gets the accent rule. */
  .pk-pointed {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 9px 0 0;
    border-left: 2px solid var(--accent);
    padding-left: 8px;
  }

  .pk-band {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 6px;
    margin: 8px 0 0;
    border: 1px solid var(--line-strong);
  }
  .pk-band.on-dark {
    color: var(--bg);
  }

  .pk-bars {
    display: grid;
    gap: 4px;
    margin-top: 11px;
  }
  .pk-bar {
    display: grid;
    grid-template-columns: 5.6rem minmax(0, 1fr) 1.8rem;
    align-items: center;
    gap: 7px;
  }
  .pk-track {
    height: 6px;
    background: var(--surface-sunken);
    border: 1px solid var(--line);
  }
  .pk-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .pk-bar-val {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-align: right;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .pk-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
    margin-top: 12px;
    padding-top: 9px;
    border-top: 1px solid var(--divider);
  }
  .pk-open {
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 4px 9px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-primary);
    cursor: pointer;
    margin-left: auto;
    white-space: nowrap;
  }
  .pk-ghost {
    margin-left: 0;
    color: var(--accent-ink);
  }
  .pk-open:hover,
  .pk-open:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* A hover card cannot exist on paper. */
  @media print {
    .pk {
      display: none !important;
    }
  }
</style>
