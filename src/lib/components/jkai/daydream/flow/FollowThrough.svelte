<script lang="ts">
  // "Take it further": what jkai can do with a note beyond rating it — the
  // follow-ups `act/follow.ts` offers this note, each with what it will use
  // written under it, because the cost is subscription quota and he should
  // see it before the tap, not on a bill.
  //
  // Guided offers open a panel first (the brief to read, the watch to word,
  // the prototype to confirm, the devices to pick); one-tap offers just go.
  import { invalidateAll } from '$app/navigation';
  import { postThought } from '$lib/daydream/feed-client';
  import type { NoteFollow, FollowOffer, FollowKind } from '$lib/daydream/act/follow';

  interface Props {
    noteId: string;
    follow: NoteFollow;
  }
  let { noteId, follow }: Props = $props();

  let busy = $state<string | null>(null);
  let message = $state<{ text: string; href?: string; bad: boolean } | null>(null);
  // Which guided panel is open before its tap.
  let open = $state<FollowKind | null>(null);
  // `$state` from a prop is a deliberate snapshot: his edits must survive a
  // reload of the note, so the draft is copied once when the panel opens.
  let watchText = $state('');
  let picked = $state<string[]>([]);
  let copied = $state(false);

  const ORDER: FollowKind[] = ['research', 'promote', 'build', 'prototype', 'watch', 'message', 'home'];
  const offers = $derived([...follow.offers].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)));
  const pending = $derived(offers.filter((o) => o.state === 'offer'));
  const settled = $derived(offers.filter((o) => o.state === 'done' || o.state === 'stopped'));
  const show = $derived(offers.length > 0 || !!follow.bookingUrl);

  type Out = { ok: boolean; reason?: string; message?: string; href?: string };
  async function run(op: string, extra: Record<string, unknown> = {}) {
    busy = op;
    message = null;
    const r = await postThought<Out>({ action: 'follow', op, thoughtId: noteId, ...extra });
    busy = null;
    if (!r.ok || !r.out.ok) {
      message = { text: r.out.reason ?? r.error ?? 'That did not work.', bad: true };
      return false;
    }
    message = { text: r.out.message ?? 'Done.', href: r.out.href, bad: false };
    open = null;
    await invalidateAll();
    return true;
  }

  /** What a tap on an offer does: go now, or open its panel first. */
  function tap(o: FollowOffer) {
    if (o.kind === 'research') return run('research');
    if (o.kind === 'promote') return run('promote');
    if (o.kind === 'build') return o.state === 'drafted' ? (open = 'build') : run('draft_brief').then((ok) => ok && (open = 'build'));
    if (o.kind === 'message') return run('message');
    if (o.kind === 'home') return run('home_check').then((ok) => ok && (open = 'home'));
    if (o.kind === 'watch') watchText = follow.watchDraft ?? '';
    open = o.kind;
  }

  function hostOf(u: string): string {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  }

  function togglePick(id: string) {
    picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id].slice(0, 5);
  }

  async function copyMessage() {
    if (!follow.message) return;
    try {
      await navigator.clipboard.writeText(follow.message.text);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      copied = false;
    }
  }

  const BUTTON: Record<FollowKind, string> = {
    research: 'Dig deeper',
    promote: 'Put it on the build backlog',
    build: 'Draft the build brief',
    prototype: 'Sketch a quick prototype',
    watch: 'Watch for this instead',
    message: 'Draft a message',
    home: 'Check what has dropped out',
  };
  const WORKING: Partial<Record<string, string>> = {
    research: 'Starting…', promote: 'Adding…', draft_brief: 'Drafting the brief…', accept_build: 'Accepting…',
    prototype: 'Starting…', watch: 'Setting it up — about a minute…', unwatch: 'Stopping…', message: 'Drafting…',
    gmail_draft: 'Drafting in Gmail…', gmail_send: 'Sending…', gmail_discard: 'Discarding…', home_check: 'Looking…', home_refresh: 'Refreshing…',
  };
</script>

{#if show}
  <section class="further" aria-label="Take it further">
    <p class="further-k">Take it further</p>

    {#if follow.bookingUrl}
      <a class="sign" href={follow.bookingUrl} target="_blank" rel="noopener noreferrer">
        Open the booking page<span class="sign-host">{' · '}{hostOf(follow.bookingUrl)}</span>
      </a>
    {/if}

    {#if pending.length}
      <ul class="offers">
        {#each pending as o (o.kind)}
          <li>
            <button type="button" class="offer" disabled={!!busy} aria-expanded={open === o.kind} onclick={() => tap(o)}>
              {busy && (busy === o.kind || (o.kind === 'build' && busy === 'draft_brief') || (o.kind === 'home' && busy === 'home_check')) ? (WORKING[busy] ?? 'Working…') : (o.label || BUTTON[o.kind])}
            </button>
            <span class="cost">{o.cost}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if settled.length}
      <ul class="settled">
        {#each settled as o (o.kind)}
          <li>
            <span class="tick" class:stopped={o.state === 'stopped'}>{o.label}</span>
            {#if o.href}<a href={o.href}>Open</a>{/if}
            {#if o.kind === 'watch' && o.state === 'done'}
              <button type="button" class="link-btn" disabled={!!busy} onclick={() => run('unwatch')}>{busy === 'unwatch' ? 'Stopping…' : 'Stop watching'}</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <!-- The build brief: read it, then accept. -->
    {#if follow.brief && !follow.brief.acceptedAt && (open === 'build' || offers.some((o) => o.kind === 'build' && o.state === 'drafted'))}
      <div class="panel">
        <p class="panel-k">The brief it would build from</p>
        {#if follow.brief.outcome}<p class="panel-v"><strong>Outcome.</strong> {follow.brief.outcome}</p>{/if}
        {#if follow.brief.acceptance.length}
          <p class="panel-v"><strong>Done when:</strong></p>
          <ul class="crit">{#each follow.brief.acceptance as c, i (i)}<li>{c}</li>{/each}</ul>
        {/if}
        <p class="meta">
          {[follow.brief.effort && `Effort ${follow.brief.effort}`, follow.brief.risk && `risk ${follow.brief.risk}`, follow.brief.readiness].filter(Boolean).join(' · ')}
        </p>
        <p class="cost">Accepting queues it for the overnight builder — one a night, about 3.4M tokens of the subscription.</p>
        <div class="actions">
          <button type="button" class="cta sm" disabled={!!busy} onclick={() => run('accept_build')}>{busy === 'accept_build' ? 'Accepting…' : 'Accept for build'}</button>
          <button type="button" class="btn sm" disabled={!!busy} onclick={() => run('draft_brief')}>{busy === 'draft_brief' ? 'Redrafting…' : 'Redraft'}</button>
          <button type="button" class="link-btn" onclick={() => (open = null)}>Not now</button>
        </div>
      </div>
    {/if}

    <!-- A prototype starts a build now: say so, then start it. -->
    {#if open === 'prototype'}
      <div class="panel">
        <p class="panel-k">Start a prototype now?</p>
        <p class="panel-v">A one-page sketch, built in the sandbox — no site code, no pull request. It stops at 45 minutes or 1.5M tokens, whichever comes first, and you get a preview link.</p>
        <div class="actions">
          <button type="button" class="cta sm" disabled={!!busy} onclick={() => run('prototype')}>{busy === 'prototype' ? 'Starting…' : 'Start the prototype'}</button>
          <button type="button" class="btn sm" onclick={() => (open = null)}>Cancel</button>
        </div>
      </div>
    {/if}

    <!-- A watch: his words, then a schedule. -->
    {#if open === 'watch'}
      <div class="panel">
        <label class="panel-k" for="watch-{noteId}">What should it watch for? It checks every 6 hours unless you say otherwise.</label>
        <textarea id="watch-{noteId}" class="text-input area" rows="3" maxlength="400" bind:value={watchText}></textarea>
        <div class="actions">
          <button type="button" class="cta sm" disabled={!!busy || watchText.trim().length < 12} onclick={() => run('watch', { description: watchText })}>{busy === 'watch' ? WORKING.watch : 'Start watching'}</button>
          <button type="button" class="btn sm" onclick={() => (open = null)}>Cancel</button>
        </div>
      </div>
    {/if}

    <!-- A message he sends himself. -->
    {#if follow.message}
      <div class="panel">
        <p class="panel-k">Message — you send it</p>
        <pre class="msg">{follow.message.text}</pre>
        {#if follow.message.draft}
          <p class="meta">
            {follow.message.draft.status === 'sent' ? `Sent to ${follow.message.draft.to}` : follow.message.draft.status === 'discarded' ? 'Gmail draft discarded' : `In your Gmail drafts, to ${follow.message.draft.to}`}
          </p>
        {/if}
        <div class="actions">
          <a class="btn sm" href={follow.message.whatsapp} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
          {#if follow.message.mailto}<a class="btn sm" href={follow.message.mailto}>Open in Mail</a>{/if}
          {#if follow.message.email && (!follow.message.draft || follow.message.draft.status === 'discarded')}
            <button type="button" class="btn sm" disabled={!!busy} onclick={() => run('gmail_draft')}>{busy === 'gmail_draft' ? WORKING.gmail_draft : 'Draft it in Gmail'}</button>
          {/if}
          {#if follow.message.draft?.status === 'drafted'}
            <button type="button" class="cta sm" disabled={!!busy} onclick={() => run('gmail_send')}>{busy === 'gmail_send' ? 'Sending…' : 'Send it'}</button>
            <a class="btn sm" href={follow.message.draft.gmailUrl} target="_blank" rel="noopener noreferrer">Edit in Gmail</a>
            <button type="button" class="link-btn" disabled={!!busy} onclick={() => run('gmail_discard')}>Discard</button>
          {/if}
          <button type="button" class="link-btn" onclick={copyMessage}>{copied ? 'Copied' : 'Copy the text'}</button>
          <button type="button" class="link-btn" disabled={!!busy} onclick={() => run('message')}>{busy === 'message' ? 'Redrafting…' : 'Redraft'}</button>
        </div>
        {#if !follow.message.email && !follow.message.whatsapp.includes('wa.me/4')}
          <p class="meta">None of its sources gives a number or address, so WhatsApp asks you who it is for.</p>
        {/if}
      </div>
    {/if}

    <!-- Home Assistant: pick what to refresh. -->
    {#if follow.home && !follow.home.refreshedAt}
      <div class="panel">
        {#if follow.home.found.length}
          <p class="panel-k">Unavailable now — pick up to five to refresh</p>
          <ul class="picks">
            {#each follow.home.found as e (e.id)}
              <li>
                <label><input type="checkbox" checked={picked.includes(e.id)} onchange={() => togglePick(e.id)} /> {e.name}</label>
              </li>
            {/each}
          </ul>
          <p class="cost">Asks Home Assistant to update each one and reload its integration. Nothing is switched on, off or unlocked.</p>
          <div class="actions">
            <button type="button" class="cta sm" disabled={!!busy || picked.length === 0} onclick={() => run('home_refresh', { entities: picked })}>{busy === 'home_refresh' ? 'Refreshing…' : `Refresh ${picked.length || ''}`.trim()}</button>
            <button type="button" class="link-btn" disabled={!!busy} onclick={() => run('home_check')}>Look again</button>
          </div>
        {:else}
          <p class="panel-v">Nothing is unavailable right now.</p>
        {/if}
      </div>
    {:else if follow.home?.refreshedAt}
      <p class="meta">Refreshed {follow.home.refreshed.length} device{follow.home.refreshed.length === 1 ? '' : 's'}. <button type="button" class="link-btn" disabled={!!busy} onclick={() => run('home_check')}>Look again</button></p>
    {/if}

    {#if message}
      <p class="said" class:bad={message.bad} role="status">{message.text}{#if message.href}{' '}<a href={message.href}>Open</a>{/if}</p>
    {/if}
  </section>
{/if}

<style>
  .further {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line-hair);
  }
  .further-k,
  .panel-k {
    display: block;
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .sign {
    display: inline-block;
    margin: 0 0 10px;
    padding: 8px 12px;
    border: 1px solid var(--accent-ink);
    border-radius: 2px;
    color: var(--accent-ink);
    font-weight: 600;
    font-size: var(--fs-body-sm);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .sign:hover {
    background: var(--accent-ink-tint-06);
  }
  .sign-host {
    font-weight: 400;
    color: var(--text-secondary);
  }
  .offers,
  .settled,
  .picks,
  .crit {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .offers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
    gap: 8px;
  }
  .offers li {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .offer {
    text-align: left;
    padding: 9px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--bg);
    color: var(--text-primary);
    font: inherit;
    font-weight: 700;
    font-size: var(--fs-body-sm);
    cursor: pointer;
    min-height: 44px;
  }
  .offer:hover:not(:disabled) {
    border-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .offer:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .offer:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .cost,
  .meta {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-muted);
  }
  .settled {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 10px;
  }
  .settled li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--fs-body-sm);
  }
  .tick {
    color: var(--success);
    font-weight: 600;
  }
  .tick.stopped {
    color: var(--text-secondary);
  }
  .settled a,
  .said a {
    color: var(--accent-ink);
  }
  .panel {
    margin-top: 12px;
    padding: 12px 14px;
    border-left: 3px solid var(--accent-ink);
    background: var(--bg-section);
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 78ch;
  }
  .panel-k {
    margin: 0;
  }
  .panel-v {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .crit li {
    position: relative;
    padding-left: 16px;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
  }
  .crit li::before {
    content: '–';
    position: absolute;
    left: 2px;
    color: var(--text-muted);
  }
  .msg {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    white-space: pre-wrap;
    font-family: inherit;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .picks li {
    font-size: var(--fs-body-sm);
    padding: 4px 0;
  }
  .picks label {
    display: flex;
    gap: 8px;
    align-items: baseline;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
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
  .said {
    margin: 10px 0 0;
    font-size: var(--fs-body-sm);
    color: var(--success);
  }
  .said.bad {
    color: var(--warn);
  }
</style>
