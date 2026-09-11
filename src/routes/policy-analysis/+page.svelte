<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { thinkingLevelsFor, type ThinkingLevel } from '$lib/models/thinking';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let busy = $state(false);
  let message = $state('');
  let depth = $state<'standard' | 'deep'>('standard');
  // Unticked by default, and deliberately so. Sealing costs the run its external
  // research, its persona memory, its cross-policy comparison and its share
  // links; making it the default would quietly take those from every ordinary
  // assessment to buy a guarantee most of them do not need.
  let sealed = $state(false);

  // Model quality decides how good the reasoning is, so the reader picks it
  // rather than inheriting whatever the research-deep workload happens to be
  // pinned to. Both fields are optional: submit without touching them and the
  // run resolves the workload default, exactly as every assessment did before.
  let modelId = $state<string>(data.defaultModelId);
  let thinkingLevel = $state<ThinkingLevel | 'auto'>('auto');
  const chosen = $derived(data.models.find((m) => m.id === modelId) ?? null);
  // `max` is per-MODEL on Codex — the older line answers it with a 400 rather
  // than with less thinking — so the ladder is re-read whenever the model changes.
  const efforts = $derived(thinkingLevelsFor('codex', modelId));
  $effect(() => {
    const offered = efforts;
    untrack(() => {
      if (thinkingLevel !== 'auto' && !offered.includes(thinkingLevel)) thinkingLevel = 'auto';
    });
  });
  // How many units of a stage's fan-out run at once. The stages that dominate a
  // run — one call per page, one per actor — are independent by construction, so
  // this buys wall-clock and changes nothing about what comes back.
  let agents = $state<number>(data.suggestedConcurrency);
  const agentsNote = $derived(
    agents === 1
      ? 'One at a time, which is how every assessment before this option ran. Slowest, and the easiest to read in the run log.'
      : agents > data.bridgeConcurrency
        ? `The Codex bridge admits ${data.bridgeConcurrency} at once and queues the rest, so this will not run faster than ${data.bridgeConcurrency} until CODEX_BRIDGE_CONCURRENCY is raised.`
        : `${agents} pages or actors assessed at once. Measured on a real white paper: six concurrent calls finish in about the same wall time as four, with no rate limiting and no loss of quality — the work each call does is identical either way.`,
  );

  const EFFORT_NOTE: Record<string, string> = {
    low: 'Fastest, and the thinnest reasoning. Fine for a short paper.',
    medium: 'The usual balance of depth against wall-clock.',
    high: 'Noticeably better at spotting an incentive nobody stated.',
    xhigh: 'Slower again. Worth it on a paper with many interacting actors.',
    max: 'The deepest this model reasons. Expect a long run and heavier quota use.',
  };

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget as HTMLFormElement;
    busy = true; message = '';
    try {
      const body = new FormData(form);
      // The server treats an absent or unknown level as "provider default", so
      // send nothing rather than the word `auto`.
      if (thinkingLevel === 'auto') body.delete('thinkingLevel');
      if (!data.codexEnabled) body.delete('model');
      const response = await fetch('/api/policy-analysis', { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) { message = result.error ?? 'Could not submit the policy.'; return; }
      await goto(`/policy-analysis/${result.id}`);
    } catch { message = 'Connection interrupted. Check recent analyses before submitting again.'; }
    finally { busy = false; }
  }

  const STATUS: Record<string, string> = {
    queued: 'waiting to start', running: 'running now', completed: 'complete',
    completed_with_gaps: 'complete, with gaps', failed: 'stopped', cancelled: 'cancelled',
  };
</script>
<svelte:head><title>Policy analysis — Strange Ramblings</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<!-- One padded container for the whole page, because `.policy-page` is now
     full-bleed: every band on the assessment page paints to the window edge
     and holds its own content to the measure, and a page that is a run of
     loose prose elements wants the container the old wrapper was. -->
<div class="pa-wrap pa-sheet">
  <div class="eyebrow">Game theory · Incentives · Red team</div>
  <h1>What happens when<br />the policy meets its actors?</h1>
  <p class="standfirst">
    Submit a policy paper and it is read as an adversary would read it: who is named in it, what their
    position actually rewards, and the concrete plays each of them can run to serve themselves at the
    policy's expense. The assessment is looking for weaknesses before the paper goes further — it is not
    an assurance review, and it will not tell you the policy is fine.
  </p>

  <ol class="how">
    <li><strong>It takes the paper apart.</strong> Objectives, mechanisms, decision rights, funding, measures and the assumptions holding them up, each quoted from the page it came from.</li>
    <li><strong>It profiles the actors.</strong> Not the org chart — who they answer to, what they are judged on, how far ahead they can afford to look, and who gains if this fails.</li>
    <li><strong>It red-teams them.</strong> Ranked plays, favouring the ones that stay inside the rules, each with what it costs the policy, the first sign of it, and the change that would close it.</li>
    <li><strong>It checks its own confidence.</strong> Targeted public research, an evidence matrix, twelve structural checks, and a plain list of what it could not establish.</li>
    <li><strong>It remembers the actors.</strong> Every body it profiles goes into a <a href="/policy-analysis/personas">persona library</a> that the next assessment reads before it starts — as context to test against, never as evidence to import.</li>
  </ol>

  <form onsubmit={submit} class="submission">
    <label for="title">Policy title</label>
    <input class="nm-text-input" id="title" name="title" required maxlength="240" placeholder="As it appears on the paper" />

    <label for="document">Upload the paper</label>
    <input class="nm-text-input" id="document" name="document" type="file" accept=".pdf,.docx,.txt" />
    <span class="muted">PDF, DOCX or plain text · up to 10 MB, 400 pages and 600,000 characters. A scanned PDF needs OCR first — paste the text instead if in doubt.</span>

    <label for="text">Or paste the text</label>
    <textarea class="nm-text-input" id="text" name="text" rows="8" maxlength="600000" placeholder="Either a file or pasted text, not both."></textarea>

    <fieldset class="depth">
      <legend>How far should it go?</legend>
      <input type="hidden" name="depth" value={depth} />
      <label class="choice" class:on={depth === 'standard'}>
        <input type="radio" bind:group={depth} value="standard" />
        <span>
          <strong>Standard</strong>
          <span class="muted">One round of research, up to eight questions. Usually finishes within the hour.</span>
        </span>
      </label>
      <label class="choice" class:on={depth === 'deep'}>
        <input type="radio" bind:group={depth} value="deep" />
        <span>
          <strong>Deep enquiry</strong>
          <span class="muted">Up to three rounds, each planned from what the last one found, more sources per question and more actors red-teamed. Takes considerably longer and costs more.</span>
        </span>
      </label>
    </fieldset>

    <fieldset class="depth seal" class:armed={sealed}>
      <legend>Is this paper for public release?</legend>
      <input type="hidden" name="sealed" value={sealed ? 'true' : 'false'} />
      <label class="choice" class:on={sealed}>
        <input type="checkbox" bind:checked={sealed} />
        <span>
          <strong>Seal this assessment</strong>
          <span class="muted">
            Every word it stores — the paper, the analysis, the run's own notes — is encrypted under a key
            held outside the database and destroyed when you purge the run. That makes every copy of it
            unreadable at once, including the ones in nightly backups that no deletion can reach.
          </span>
        </span>
      </label>
      {#if sealed}
        <div class="seal-terms">
          <p class="seal-head">What a sealed run gives up, so that it can be destroyed</p>
          <ul>
            <li><strong>No external research.</strong> A search provider's logs are not ours to erase, and a query says what a paper is about even when it quotes nothing.</li>
            <li><strong>No cross-policy comparison</strong>, in either direction. Comparing puts one assessment's words into another's stored prompt, where shredding a key could never follow.</li>
            <li><strong>Nothing remembered about the bodies it meets.</strong> The persona library outlives the runs that fed it, which is exactly the residue sealing removes.</li>
            <li><strong>No share links</strong>, and <strong>no stored prompts</strong> — so the run log shows the cost and the models but not their text, an interrupted stage re-runs its calls rather than replaying them, and a stage fault cannot be diagnosed after the fact.</li>
          </ul>
          <p class="seal-head">What it still cannot promise</p>
          <p class="muted">
            The model provider reads the document in order to assess it, and nothing here can delete its
            copy — that is a retention setting on the provider account. Sealing covers everything this site
            writes down; it does not cover what leaves it.
          </p>
        </div>
      {/if}
    </fieldset>

    <fieldset class="depth engine">
      <legend>Which model should read it?</legend>
      <p class="muted engine-strap">
        The reasoning is only as good as the model doing it. These run on the Codex subscription, so a
        deeper setting costs quota and wall-clock rather than cash.
      </p>
      {#if !data.codexEnabled}
        <p class="warning">Codex is switched off for this site, so the assessment will run on whatever the research model is set to. Turn it on under Admin → AI → Models to choose here.</p>
      {/if}

      <label for="model">Model</label>
      <select class="nm-text-input" id="model" name="model" bind:value={modelId} disabled={!data.codexEnabled}>
        {#each data.models as m (m.id)}
          <option value={m.id}>{m.name}{m.pace ? ` · ${m.pace}` : ''}{m.proOnly ? ' · Pro only' : ''}{m.retiresOn ? ` · retires ${m.retiresOn}` : ''}</option>
        {/each}
      </select>
      {#if chosen?.description}<span class="muted">{chosen.description}</span>{/if}
      <span class="muted">
        The first stage makes one timed call for every page of the document, so a slow model is not
        slow here — it stops. The notes above are measured against a real 72-page white paper, not
        guessed, and a model nobody has timed carries no note.
      </span>

      <label for="thinkingLevel">Thinking level</label>
      <select class="nm-text-input" id="thinkingLevel" name="thinkingLevel" bind:value={thinkingLevel} disabled={!data.codexEnabled}>
        <option value="auto">Provider default</option>
        {#each efforts as level (level)}
          <option value={level}>{level}</option>
        {/each}
      </select>
      <span class="muted">
        {thinkingLevel === 'auto'
          ? 'Whatever the model does without being told. Pick a level to override it.'
          : EFFORT_NOTE[thinkingLevel] ?? ''}
      </span>

      <label for="concurrency">Concurrent agents</label>
      <select class="nm-text-input" id="concurrency" name="concurrency" bind:value={agents}>
        {#each data.concurrencyOptions as n (n)}
          <option value={n}>{n === 1 ? 'One at a time' : `${n} at a time`}{n === data.bridgeConcurrency ? ' · all the bridge admits' : ''}</option>
        {/each}
      </select>
      <span class="muted">{agentsNote}</span>
      <span class="muted">
        This is wall-clock only. A stage fans out over units that never read each other's
        output, so the calls overlap but each one is asked exactly what it would have been
        asked on its own, and the results are folded back in the same order. The assessment
        is identical; it just arrives sooner.
      </span>
    </fieldset>

    <details>
      <summary>Jurisdiction, policy area and context (optional, but they sharpen the research)</summary>
      <div class="optional">
        <label for="jurisdiction">Jurisdiction</label>
        <input class="nm-text-input" id="jurisdiction" name="jurisdiction" maxlength="200" placeholder="England · Scotland · UK-wide" />
        <label for="policyArea">Policy area</label>
        <input class="nm-text-input" id="policyArea" name="policyArea" maxlength="200" placeholder="Social housing regulation" />
        <label for="context">Anything the paper assumes you already know</label>
        <textarea class="nm-text-input" id="context" name="context" maxlength="5000" rows="3"></textarea>
      </div>
    </details>

    {#if message}<p class="warning" role="alert">{message}</p>{/if}
    {#if !data.enabled}<p class="warning">New analyses are switched off at the moment.</p>{/if}
    <div><button class="nm-save-btn" disabled={busy || !data.enabled}>{busy ? 'Submitting…' : 'Start the assessment'}</button></div>
    <p class="muted">
      The document stays private to this account and never enters the site's shared intelligence graph.
      You can close the page while it runs.
    </p>
  </form>

  <div class="library-link">
    <a href="/policy-analysis/personas">The persona library →</a>
    <span class="muted">The bodies you keep meeting: what moves them, what they have been shown able to do, and what public sources say about them.</span>
  </div>

  <h2>Your assessments</h2>
  <p class="muted">
    Completed assessments are also what the cross-policy stage compares against, so weaknesses that only
    appear across two policies emerge as this list grows.
  </p>
  {#each data.analyses as analysis (analysis.id)}
    <div class="ruled row">
      <a href={`/policy-analysis/${analysis.id}`}>{analysis.title}</a>
      <span class="muted">
        {STATUS[analysis.status] ?? analysis.status.replaceAll('_', ' ')}
        {#if analysis.depth === 'deep'} · deep enquiry{/if}
        · {new Date(analysis.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
    </div>
  {:else}
    <p class="muted">Nothing yet. Completed work and interrupted runs both stay here.</p>
  {/each}
</div>

<style>
  .library-link { border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); padding: .9rem 1.1rem; margin: 2rem 0 1rem; display: grid; gap: .3rem; max-width: 70ch; }
  .library-link a { font-family: var(--font-mono); font-size: var(--fs-label); }
  .standfirst { font-size: var(--fs-body-lg); color: var(--text-secondary); max-width: 62ch; }
  .how { margin: 2rem 0 0; padding-left: 1.25rem; max-width: 70ch; }
  .how li { padding: .45rem 0; color: var(--text-secondary); }
  .how strong { color: var(--text-primary); }
  .submission { display: grid; gap: .75rem; border-top: 2px solid var(--text-primary); margin-top: 2.5rem; padding-top: 1.5rem; max-width: 900px; }
  label { font-weight: 600; margin-top: .5rem; }
  .optional { display: grid; gap: .6rem; margin-top: 1rem; }
  summary { cursor: pointer; padding: .5rem 0; }
  textarea { resize: vertical; }
  .depth { border: 1px solid var(--line-strong); padding: 1rem 1.1rem; margin: 1rem 0 0; display: grid; gap: .75rem; }
  /* ARMED IS A CHANGE OF GROUND, not a coloured border. The page's state language
     is hover = ground, selected = accent fill, and a run that cannot be undone
     should look different from one that can without shouting in a fourth colour. */
  .seal.armed { border-color: var(--text-primary); background: var(--surface-sunken); }
  .seal-terms { border-top: 1px solid var(--line-strong); padding-top: .85rem; display: grid; gap: .5rem; }
  .seal-head { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .seal-terms ul { margin: 0; padding-left: 1.15rem; display: grid; gap: .35rem; }
  .seal-terms li { font-size: var(--fs-label); line-height: 1.55; }
  .depth legend { font-weight: 600; padding: 0 .4rem; }
  .engine { gap: .4rem; }
  .engine-strap { margin: 0 0 .5rem; max-width: 68ch; }
  .engine select { max-width: 34rem; }
  .choice { display: flex; gap: .7rem; align-items: start; font-weight: 400; margin: 0; cursor: pointer; padding: .6rem .7rem; border: 1px solid transparent; }
  .choice.on { border-color: var(--accent); background: var(--accent-tint-04); }
  .choice > span { display: grid; gap: .2rem; }
  .choice strong { font-weight: 700; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
  .row { display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: baseline; justify-content: space-between; }
</style>
