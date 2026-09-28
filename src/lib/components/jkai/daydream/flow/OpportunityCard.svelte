<script lang="ts">
  // One daydream note, as an opportunity with a decision attached.
  //
  // Reading order is the argument: where it came from and where it is (area,
  // kind, stage), what it found, the one thing it suggests, how it knows — and
  // then the question, "what do you want to do?", as three labelled choices
  // with what each one does written under it. The rare answers (never this
  // kind, a note in your own words) sit behind "More". Once answered the card
  // says what you said and folds the choices away; "Change" brings them back.
  //
  // A double-check this note started renders INSIDE the card (`SignOff`), so
  // an idea and the work it caused are never two places on the page.
  import AreaGlyph from './AreaGlyph.svelte';
  import StageTrack from './StageTrack.svelte';
  import SignOff from './SignOff.svelte';
  import { clock, stamp } from '$lib/daydream/format';
  import type { FeedNote } from '$lib/daydream/think/notes';
  import type { CommissionView } from '$lib/daydream/commissioning';

  type Verdict = 'useful' | 'not_useful' | 'never_kind';
  interface Props {
    n: FeedNote;
    commission: CommissionView | null;
    checksOn: boolean;
    focused?: boolean;
    focusCommission?: boolean;
    busy?: string | null;
    onrate: (v: Verdict) => void;
    onprepare: () => void;
    onsavenote: (text: string) => Promise<boolean>;
    onunmute: () => void;
  }
  let { n, commission, checksOn, focused = false, focusCommission = false, busy = null, onrate, onprepare, onsavenote, onunmute }: Props = $props();

  let expanded = $state(false);
  let changing = $state(false);
  let noting = $state(false);
  let noteText = $state('');
  let menu = $state(false);
  // Not reactive: only read inside the window handlers below.
  let moreEl: HTMLDivElement | undefined;
  function closeOutside(e: MouseEvent) {
    if (menu && moreEl && !moreEl.contains(e.target as Node)) menu = false;
  }

  const isBusy = $derived(!!busy && busy.startsWith(n.id));
  const paras = $derived(n.summary.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
  const long = $derived(paras.length > 1 || (paras[0]?.length ?? 0) > 260);
  const decided = $derived(!!n.verdict && !changing);
  const canCheck = $derived(checksOn && n.checkable && !commission);

  const VERDICT_WORDS: Record<string, string> = {
    useful: 'Worth knowing',
    not_useful: 'Not for me',
    never_kind: 'Never this kind',
  };

  function rate(v: Verdict) {
    changing = false;
    menu = false;
    onrate(v);
  }
  function startNote() {
    menu = false;
    noting = true;
    noteText = n.ownerNote ?? '';
  }
  async function saveNote() {
    const text = noteText.trim();
    if (!text) return;
    if (await onsavenote(text)) {
      noting = false;
      noteText = '';
    }
  }
</script>

<svelte:window onclick={closeOutside} onkeydown={(e) => e.key === 'Escape' && (menu = false)} />

<article class="opp" class:focused class:decided class:urgent={n.bucket === 'decide'} id="note-{n.id}">
  <header class="opp-top">
    <span class="area"><AreaGlyph area={n.channel} size={16} />{n.channelLabel}</span>
    {#if n.outcomeLabel !== n.channelLabel}<span class="kind">{n.outcomeLabel}</span>{/if}
    <span class="spacer"></span>
    <StageTrack stage={n.stage} />
    <span class="time" title={stamp(n.createdAt)}>{clock(n.createdAt)}</span>
  </header>

  <h3 class="opp-title">{n.title}</h3>

  <div class="found" class:clamped={long && !expanded}>
    {#each expanded ? paras : paras.slice(0, 1) as p, i (i)}<p>{p}</p>{/each}
  </div>
  {#if long}
    <button type="button" class="more-link" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
      {expanded ? 'Show less' : 'Read all of it'}
    </button>
  {/if}

  {#if n.next}
    <div class="next">
      <p class="next-k">Suggested next step</p>
      <p class="next-v">{n.next}</p>
    </div>
  {/if}

  {#if n.sources.length}
    <div class="how">
      <span class="how-k">How it knows</span>
      <ul class="chips">
        {#each n.sources as s, i (i)}
          <li>
            {#if s.href}<a href={s.href} target="_blank" rel="noopener noreferrer">{s.label}{s.detail ? ` · ${s.detail}` : ''}</a>
            {:else}{s.label}{#if s.detail}<span class="chip-d"> · {s.detail}</span>{/if}{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if n.build}
    <p class="build">
      <span class="build-k">Build queue</span>
      {n.build.status === 'shipped' ? 'Shipped' : n.build.accepted ? 'Accepted — the builder will pick it up' : 'Proposed — accept it in the backlog to have it built'}
      · <a href={`/jkai/develop/backlog?item=${encodeURIComponent(n.build.slug)}`}>Open in the backlog</a>
    </p>
  {/if}

  {#if n.ownerNote && !noting}<p class="said">You added: “{n.ownerNote}”</p>{/if}

  {#if decided}
    <div class="verdict">
      <span class="v-chip" class:good={n.verdict === 'useful'}>{VERDICT_WORDS[n.verdict ?? ''] ?? 'Answered'}</span>
      <span class="v-sub">{n.raised ? 'It messaged you about this' : 'It kept this to the Inbox'}{n.kindMuted ? ' · this kind is muted' : ''}</span>
      <span class="spacer"></span>
      {#if n.kindMuted}<button type="button" class="link-btn" disabled={isBusy} onclick={onunmute}>Unmute this kind</button>{/if}
      {#if canCheck}<button type="button" class="link-btn" disabled={isBusy} onclick={onprepare}>Double-check it</button>{/if}
      <button type="button" class="link-btn" onclick={() => (changing = true)}>Change</button>
    </div>
  {:else}
    <div class="decide">
      <p class="decide-k">What do you want to do?</p>
      <div class="choices">
        <button type="button" class="choice good" disabled={isBusy} onclick={() => rate('useful')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          <span class="c-t">Worth knowing</span>
          <span class="c-s">Keep it. More like this.</span>
        </button>
        {#if canCheck}
          <button type="button" class="choice check" disabled={isBusy} onclick={onprepare}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2-4.9M19 4v4h-4" /></svg>
            <span class="c-t">Double-check it</span>
            <span class="c-s">Re-read its sources and report back. Asks your OK first.</span>
          </button>
        {/if}
        <button type="button" class="choice no" disabled={isBusy} onclick={() => rate('not_useful')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
          <span class="c-t">Not for me</span>
          <span class="c-s">Fewer like this.</span>
        </button>
        <div class="more-wrap" bind:this={moreEl}>
          <button type="button" class="choice-more" aria-expanded={menu} onclick={() => (menu = !menu)}>More</button>
          {#if menu}
            <div class="menu" role="menu">
              <button type="button" role="menuitem" onclick={startNote}>{n.ownerNote ? 'Change your note' : 'Add a note in your own words'}</button>
              <button type="button" role="menuitem" class="danger" disabled={isBusy} onclick={() => rate('never_kind')}>Never show me “{n.outcomeLabel.toLowerCase()}” notes</button>
              {#if changing}<button type="button" role="menuitem" onclick={() => ((changing = false), (menu = false))}>Keep my answer</button>{/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if noting}
    <div class="note-form">
      <label class="field-label" for="note-text-{n.id}">In your own words — jkai keeps it as a memory</label>
      <textarea id="note-text-{n.id}" class="text-input area" rows="3" maxlength="1000" bind:value={noteText}
        placeholder="e.g. right about the heating, but the spare room is always cold"></textarea>
      <div class="actions">
        <button type="button" class="cta sm" disabled={busy === `${n.id}:note` || !noteText.trim()} onclick={saveNote}>
          {busy === `${n.id}:note` ? 'Saving…' : 'Save the note'}
        </button>
        <button type="button" class="btn sm" onclick={() => (noting = false)}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if commission}
    <SignOff c={commission} focused={focusCommission} />
  {/if}
</article>

<style>
  .opp {
    position: relative;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    padding: 18px clamp(16px, 2.2vw, 26px) 18px;
    scroll-margin-top: 90px;
  }
  .opp.urgent {
    border-left: 3px solid var(--accent);
  }
  .opp.decided {
    background: transparent;
  }
  .opp.focused {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .opp-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .area {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-primary);
  }
  .kind {
    padding: 2px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
  }
  .spacer {
    flex: 1 1 auto;
  }
  .time {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .opp-title {
    margin: 12px 0 8px;
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--fs-display-xs);
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .found p {
    margin: 0 0 8px;
    line-height: 1.6;
    max-width: 78ch;
    overflow-wrap: anywhere;
  }
  .found.clamped p {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .more-link,
  .link-btn {
    background: none;
    border: 0;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-ink);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .link-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .next {
    margin: 12px 0 0;
    padding: 10px 14px;
    background: var(--accent-ink-tint-06);
    border-left: 3px solid var(--accent-ink);
    max-width: 78ch;
  }
  .next-k,
  .decide-k,
  .how-k,
  .build-k {
    margin: 0 0 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .next-v {
    margin: 0;
    font-weight: 600;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .how {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 10px;
    margin-top: 12px;
  }
  .how-k {
    margin: 0;
    color: var(--text-muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .chips li {
    font-size: var(--fs-label);
    padding: 3px 10px;
    border: 1px solid var(--line-hair);
    border-radius: 100px;
    background: var(--surface-sunken);
    overflow-wrap: anywhere;
  }
  .chip-d {
    color: var(--text-muted);
  }
  .chips a {
    color: var(--accent-ink);
  }
  .build {
    margin: 12px 0 0;
    font-size: var(--fs-body-sm);
  }
  .build-k {
    display: inline;
    margin-right: 8px;
  }
  .build a {
    color: var(--accent-ink);
  }
  .said {
    margin: 12px 0 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    font-style: italic;
    overflow-wrap: anywhere;
  }
  .decide {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--line-hair);
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
    align-items: stretch;
  }
  .choices > .choice {
    flex: 1 1 190px;
    max-width: 320px;
  }
  .choice {
    display: grid;
    grid-template-columns: 22px 1fr;
    grid-template-rows: auto auto;
    column-gap: 8px;
    row-gap: 2px;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
    font: inherit;
    transition: border-color var(--t-fast, 0.12s), background var(--t-fast, 0.12s);
  }
  .choice svg {
    grid-row: 1 / span 2;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    margin-top: 1px;
  }
  .choice.good svg {
    color: var(--success);
  }
  .choice.check svg {
    color: var(--accent-ink);
  }
  .choice.no svg {
    color: var(--text-muted);
  }
  .c-t {
    font-weight: 700;
    font-size: var(--fs-body-sm);
  }
  .c-s {
    font-size: var(--fs-label);
    color: var(--text-secondary);
    line-height: 1.35;
  }
  .choice:hover:not(:disabled) {
    border-color: var(--text-primary);
    background: var(--accent-tint-04);
  }
  .choice.good:hover:not(:disabled) {
    border-color: var(--success);
  }
  .choice.check:hover:not(:disabled) {
    border-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .choice:focus-visible,
  .choice-more:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .choice:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .more-wrap {
    position: relative;
    display: flex;
  }
  .choice-more {
    padding: 0 14px;
    border: 1px solid var(--line-hair);
    border-radius: 2px;
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
    cursor: pointer;
    min-height: 44px;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    min-width: 260px;
    display: flex;
    flex-direction: column;
    background: var(--surface-elevated);
    border: 1px solid var(--text-primary);
  }
  .menu button {
    text-align: left;
    padding: 10px 14px;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--line-hair);
    font: inherit;
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    cursor: pointer;
  }
  .menu button:last-child {
    border-bottom: 0;
  }
  .menu button:hover {
    background: var(--accent-tint-08);
  }
  .menu .danger {
    color: var(--error);
  }
  .verdict {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line-hair);
  }
  .v-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 10px;
    border-radius: 100px;
    border: 1px solid var(--text-muted);
    color: var(--text-secondary);
  }
  .v-chip.good {
    border-color: var(--success);
    color: var(--success);
  }
  .v-sub {
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .note-form {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  @media (max-width: 640px) {
    .choices > .choice {
      flex-basis: 100%;
      max-width: none;
    }
    .more-wrap {
      justify-content: flex-start;
    }
    .choice-more {
      min-height: 40px;
    }
    .menu {
      left: 0;
      right: auto;
    }
  }
</style>
