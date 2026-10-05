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
  import FollowThrough from './FollowThrough.svelte';
  import { clock, stamp } from '$lib/daydream/format';
  import type { FeedNote } from '$lib/daydream/think/notes';
  import type { CommissionView } from '$lib/daydream/commissioning';
  import { invalidateAll } from '$app/navigation';
  import { postThought } from '$lib/daydream/feed-client';

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
    /** His ruling on the claim: wrong (with why — the lesson) or right. */
    onruling: (verdict: 'wrong' | 'right', why: string) => Promise<boolean>;
    onunmute: () => void;
  }
  let { n, commission, checksOn, focused = false, focusCommission = false, busy = null, onrate, onprepare, onsavenote, onruling, onunmute }: Props = $props();

  let expanded = $state(false);
  let changing = $state(false);
  let noting = $state(false);
  let noteText = $state('');
  // 'wrong' | 'right' while the ruling form is open.
  let ruling = $state<'wrong' | 'right' | null>(null);
  let whyText = $state('');
  let menu = $state(false);
  // "Do it for me": in flight, what it said back, and the one-time calendar choice.
  let acting = $state(false);
  let actMessage = $state<string | null>(null);
  let calendars = $state<string[] | null>(null);
  let calendarChoice = $state('');
  // Not reactive: only read inside the window handlers below.
  let moreEl: HTMLDivElement | undefined;
  function closeOutside(e: MouseEvent) {
    if (menu && moreEl && !moreEl.contains(e.target as Node)) menu = false;
  }

  const isBusy = $derived(!!busy && busy.startsWith(n.id));
  const paras = $derived(n.summary.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
  const long = $derived(paras.length > 1 || (paras[0]?.length ?? 0) > 260);
  const ownerRuled = $derived(n.review?.by === 'owner' ? n.review.verdict : null);
  const decided = $derived((!!n.verdict || !!ownerRuled || n.act?.status === 'done' || n.act?.status === 'sent') && !changing);
  const saidWrong = $derived(n.review?.verdict === 'wrong');
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
  function startRuling(v: 'wrong' | 'right') {
    menu = false;
    noting = false;
    ruling = v;
    whyText = '';
  }
  async function saveRuling() {
    if (!ruling) return;
    const why = whyText.trim();
    if (ruling === 'wrong' && why.length < 3) return;
    if (await onruling(ruling, why)) {
      ruling = null;
      whyText = '';
      changing = false;
    }
  }
  type ActOut = { ok: boolean; reason?: string; label?: string; needsCalendar?: boolean; calendars?: string[] };
  async function act(op: 'do_it' | 'undo_it' | 'send_it') {
    acting = true;
    actMessage = null;
    menu = false;
    const r = await postThought<ActOut>({ action: op, thoughtId: n.id });
    if (r.out.needsCalendar) {
      calendars = r.out.calendars ?? [];
      calendarChoice = calendars[0] ?? '';
      actMessage = calendars.length ? null : 'Your calendar could not be reached to choose one. Try again in a minute.';
    } else if (!r.ok || !r.out.ok) {
      actMessage = r.out.reason ?? r.error ?? 'That did not work.';
    } else {
      calendars = null;
      await invalidateAll();
    }
    acting = false;
  }
  async function chooseAndDo() {
    if (!calendarChoice) return;
    acting = true;
    const r = await postThought({ action: 'act_calendar', calendar: calendarChoice });
    acting = false;
    if (!r.ok) {
      actMessage = r.error ?? 'That calendar was not kept.';
      return;
    }
    calendars = null;
    await act('do_it');
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

  {#if n.replaces.length}
    <p class="replaces">
      Replaces {n.replaces.length === 1 ? 'an earlier note' : `${n.replaces.length} earlier notes`} on the same subject:
      {#each n.replaces as r, i (r.id)}{i > 0 ? '; ' : ''}<a href={`/jkai/daydreams?note=${encodeURIComponent(r.id)}`}>{r.title}</a>{/each}
    </p>
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
      {n.build.status === 'shipped' ? 'Shipped' : n.build.accepted ? 'Accepted — the builder will pick it up' : 'Proposed — draft and accept its brief below to have it built'}
      · <a href={`/jkai/develop/backlog?item=${encodeURIComponent(n.build.slug)}`}>Open in the backlog</a>
    </p>
  {/if}

  {#if n.ownerNote && !noting}<p class="said">You added: “{n.ownerNote}”</p>{/if}

  {#if n.act && (n.act.status === 'done' || n.act.status === 'undone' || n.act.status === 'sent')}
    <div class="did" class:undone={n.act.status === 'undone'} class:draft={!!n.act.draft && n.act.status === 'done'}>
      <p class="did-k">{n.act.status === 'undone' ? 'Undone' : n.act.status === 'sent' ? 'Sent' : n.act.draft ? 'Drafted' : 'Done'}</p>
      <p class="did-v">{n.act.status === 'undone' ? `Taken back: ${n.act.label.replace(/^(Add|Remind you|Move|Draft|Hold) /, (m) => m.toLowerCase())}` : n.act.label}</p>
      {#if n.act.draft && n.act.status === 'done'}
        <div class="draft-view">
          <p><span class="dk">To</span> {n.act.draft.to}</p>
          <p><span class="dk">Subject</span> {n.act.draft.subject}</p>
          <pre class="draft-body">{n.act.draft.body}</pre>
        </div>
        <div class="actions">
          <button type="button" class="cta sm" disabled={acting} onclick={() => act('send_it')}>{acting ? 'Sending…' : 'Send it'}</button>
          <a class="btn sm" href={n.act.draft.gmailUrl} target="_blank" rel="noopener noreferrer">Edit in Gmail</a>
          <button type="button" class="link-btn" disabled={acting} onclick={() => act('undo_it')}>Discard</button>
        </div>
      {:else if n.act.status === 'done' && n.act.undoable}
        <button type="button" class="link-btn" disabled={acting} onclick={() => act('undo_it')}>{acting ? 'Undoing…' : 'Undo'}</button>
      {/if}
    </div>
  {/if}

  {#if n.review}
    <div class="ruled {n.review.verdict}">
      <p class="ruled-k">
        {#if n.review.by === 'owner'}{n.review.verdict === 'wrong' ? 'You said this is wrong' : 'You said this is right'}
        {:else}{n.review.verdict === 'wrong' ? 'A double-check found this wrong' : n.review.verdict === 'holds' ? 'A double-check found this holds' : 'A double-check could not settle this'}{/if}
      </p>
      {#if n.review.reasoning && !(n.review.by === 'owner' && n.review.verdict === 'wrong')}<p class="ruled-v">{n.review.reasoning}</p>{/if}
      {#if n.review.lesson}<p class="ruled-v lesson">Lesson kept: “{n.review.lesson}”</p>{/if}
      {#if ruling === null}
        {#if saidWrong}
          <button type="button" class="link-btn" disabled={isBusy} onclick={() => startRuling('right')}>{n.review.by === 'owner' ? 'Take that back' : 'Actually, it was right'}</button>
        {:else}
          <button type="button" class="link-btn" disabled={isBusy} onclick={() => startRuling('wrong')}>It's wrong — say why</button>
        {/if}
      {/if}
    </div>
  {/if}

  {#if decided}
    <div class="verdict">
      <span class="v-chip" class:good={n.verdict === 'useful'}>{n.verdict ? (VERDICT_WORDS[n.verdict] ?? 'Answered') : ownerRuled === 'wrong' ? 'You said it is wrong' : ownerRuled ? 'You said it is right' : n.act?.status === 'sent' ? 'Sent for you' : n.act?.draft ? 'Drafted for you' : 'Done for you'}</span>
      <span class="v-sub">{n.raised ? 'It messaged you about this' : 'It kept this to the Inbox'}{n.kindMuted ? ' · this kind is muted' : ''}</span>
      <span class="spacer"></span>
      {#if n.kindMuted}<button type="button" class="link-btn" disabled={isBusy} onclick={onunmute}>Unmute this kind</button>{/if}
      {#if n.act && (n.act.status === 'ready' || n.act.status === 'open' || n.act.status === 'undone')}<button type="button" class="link-btn" disabled={isBusy || acting} onclick={() => act('do_it')}>{acting ? 'Doing it…' : 'Do it for me'}</button>{/if}
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
            <span class="c-s">Re-read its sources, then try to prove it wrong. Asks your OK first.</span>
          </button>
        {/if}
        {#if n.act && (n.act.status === 'ready' || n.act.status === 'open')}
          <button type="button" class="choice doit" disabled={isBusy || acting} onclick={() => act('do_it')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h11M12 6l6 6-6 6" /></svg>
            <span class="c-t">{acting ? 'Doing it…' : 'Do it for me'}</span>
            <span class="c-s">{n.act.label}</span>
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
              {#if !saidWrong}<button type="button" role="menuitem" onclick={() => startRuling('wrong')}>It's wrong — say why</button>{/if}
              <button type="button" role="menuitem" onclick={startNote}>{n.ownerNote ? 'Change your note' : 'Add a note in your own words'}</button>
              <button type="button" role="menuitem" class="danger" disabled={isBusy} onclick={() => rate('never_kind')}>Never show me “{n.outcomeLabel.toLowerCase()}” notes</button>
              {#if changing}<button type="button" role="menuitem" onclick={() => ((changing = false), (menu = false))}>Keep my answer</button>{/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <FollowThrough noteId={n.id} follow={n.follow} />

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

  {#if calendars && calendars.length}
    <div class="note-form">
      <label class="field-label" for="act-cal-{n.id}">Which calendar should “Do it for me” use? It asks once.</label>
      <select id="act-cal-{n.id}" class="text-input" bind:value={calendarChoice}>
        {#each calendars as c (c)}<option value={c}>{c}</option>{/each}
      </select>
      <div class="actions">
        <button type="button" class="cta sm" disabled={acting || !calendarChoice} onclick={chooseAndDo}>{acting ? 'Doing it…' : 'Use it, and do it'}</button>
        <button type="button" class="btn sm" onclick={() => (calendars = null)}>Cancel</button>
      </div>
    </div>
  {/if}
  {#if actMessage}<p class="act-msg" role="status">{actMessage}</p>{/if}

  {#if ruling}
    <div class="note-form">
      <label class="field-label" for="why-text-{n.id}">
        {ruling === 'wrong' ? 'Why is it wrong? jkai keeps this as a lesson and checks it before suggesting something like this again' : 'Why was it right? (optional) — the earlier lesson is withdrawn'}
      </label>
      <textarea id="why-text-{n.id}" class="text-input area" rows="3" maxlength="1000" bind:value={whyText}
        placeholder={ruling === 'wrong' ? 'e.g. one of those is the receipt email for the bank charge, not a second charge' : ''}></textarea>
      <div class="actions">
        <button type="button" class="cta sm" disabled={busy === `${n.id}:ruling` || (ruling === 'wrong' && whyText.trim().length < 3)} onclick={saveRuling}>
          {busy === `${n.id}:ruling` ? 'Saving…' : ruling === 'wrong' ? 'Tell it it’s wrong' : 'Tell it it was right'}
        </button>
        <button type="button" class="btn sm" onclick={() => (ruling = null)}>Cancel</button>
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
  .replaces {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .replaces a {
    color: var(--text-secondary);
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
  .did {
    margin: 12px 0 0;
    padding: 10px 12px;
    border-left: 3px solid var(--success);
    background: var(--bg-section);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
  }
  .did.undone {
    border-left-color: var(--line-strong);
  }
  .did-k {
    margin: 0;
    font-weight: 600;
    font-size: var(--fs-body-sm);
    color: var(--success);
  }
  .did.undone .did-k {
    color: var(--text-secondary);
  }
  .did.draft {
    border-left-color: var(--accent);
  }
  .did.draft .did-k {
    color: var(--accent);
  }
  .draft-view {
    flex: 1 1 100%;
    margin: 6px 0 2px;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    font-size: var(--fs-body-sm);
  }
  .draft-view p {
    margin: 0 0 4px;
  }
  .dk {
    display: inline-block;
    min-width: 5em;
    color: var(--text-secondary);
  }
  .draft-body {
    margin: 8px 0 0;
    white-space: pre-wrap;
    font-family: inherit;
    line-height: 1.5;
  }
  .did .actions {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .did-v {
    margin: 0;
    flex: 1 1 16em;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
  }
  .act-msg {
    margin: 10px 0 0;
    font-size: var(--fs-body-sm);
    color: var(--warn);
  }
  .choice.doit svg {
    color: var(--success);
  }
  .ruled {
    margin: 12px 0 0;
    padding: 10px 12px;
    border-left: 3px solid var(--line-strong);
    background: var(--bg-section);
  }
  .ruled.wrong {
    border-left-color: var(--warn);
  }
  .ruled.holds {
    border-left-color: var(--success);
  }
  .ruled-k {
    margin: 0 0 4px;
    font-weight: 600;
    font-size: var(--fs-body-sm);
  }
  .ruled.wrong .ruled-k {
    color: var(--warn);
  }
  .ruled-v {
    margin: 0 0 6px;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .ruled-v.lesson {
    color: var(--text-primary);
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
