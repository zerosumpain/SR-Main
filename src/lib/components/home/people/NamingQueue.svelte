<script lang="ts">
  /**
   * Name the places that matter, most-lived-in first. Each row offers the
   * map's suggestion as one tap, a kind, a different name, or "not a place" —
   * posted to the places page's own actions (`?/name`, `?/remove`), which
   * check the owner, validate and write jkai's memory. Nothing here writes.
   * A named place joins routes, forecasts and alerts on the next read.
   */
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  /** One unnamed place, as `loadNamingQueue` returns it. */
  interface NamingCandidate {
    id: string;
    suggestedLabel: string | null;
    suggestedKind: string | null;
    suggestedAddress: string | null;
    minutes: number;
    subjects: string[];
  }
  import { cap, hours } from './format';

  let {
    queue,
    unnamed,
    names,
  }: { queue: NamingCandidate[]; unnamed: number; names: Map<string, string> } = $props();

  const KINDS = ['home', 'school', 'work', 'shop', 'cafe', 'gym', 'other'] as const;
  /** Per-row choices and state. Keyed by place id; nothing else reads them. */
  let kinds = $state<Record<string, string>>({});
  let labels = $state<Record<string, string>>({});
  let editing = $state<Record<string, boolean>>({});
  let done = $state<Record<string, 'named' | 'removed'>>({});
  let errors = $state<Record<string, string>>({});

  const guessKind = (p: NamingCandidate) => (p.suggestedKind && (KINDS as readonly string[]).includes(p.suggestedKind) ? p.suggestedKind : 'other');
  const kindOf = (p: NamingCandidate) => kinds[p.id] ?? guessKind(p);
  const labelOf = (p: NamingCandidate) => labels[p.id] ?? p.suggestedLabel ?? '';
  /** The street and town, not the house number: enough to recognise it. */
  const where = (p: NamingCandidate) => {
    const parts = (p.suggestedAddress ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return parts.slice(1, 3).filter((s) => !/^[A-Z]{1,2}\d/.test(s)).join(', ');
  };
  const who = (p: NamingCandidate) => (p.subjects.length >= 4 ? 'everyone' : p.subjects.map((s) => names.get(s) ?? cap(s)).join(', '));
  const maxMin = $derived(Math.max(1, ...queue.map((q) => q.minutes)));
  const left = $derived(queue.filter((q) => !done[q.id]));

  function submitter(id: string) {
    return () =>
      async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        if (result.type === 'success') {
          done[id] = result.data?.removed ? 'removed' : 'named';
          delete errors[id];
          await invalidateAll();
        } else {
          errors[id] = String(result.data?.error ?? 'That did not save. Try again.');
        }
      };
  }
</script>

{#if !queue.length}
  <p class="nq-quiet">Every place with real time spent in it has a name. {unnamed ? `${unnamed} passing stops stay unnamed; nobody stayed long enough to matter.` : ''}</p>
{:else}
  <p class="nq-lede">{unnamed} places have no name. These {queue.length} hold the most time in this window.</p>
  <ul class="nq">
    {#each queue as p (p.id)}
      <li class:done={!!done[p.id]}>
        <div class="nq-head">
          <div class="nq-name">
            <strong>{p.suggestedLabel ?? 'Unnamed stop'}</strong>
            <small>{[where(p), `${hours(p.minutes)}`, who(p)].filter(Boolean).join(' · ')}</small>
            <span class="nq-bar" aria-hidden="true"><i style:width={`${(p.minutes / maxMin) * 100}%`}></i></span>
          </div>
          {#if done[p.id]}
            <span class="nq-done">{done[p.id] === 'named' ? 'Named' : 'Removed'}</span>
          {/if}
        </div>
        {#if !done[p.id]}
          <form method="POST" action="/home/people/places?/name" use:enhance={submitter(p.id)} class="nq-form">
            <input type="hidden" name="placeId" value={p.id} />
            <input type="hidden" name="kind" value={kindOf(p)} />
            <div class="nq-kinds" role="radiogroup" aria-label={`What is ${p.suggestedLabel ?? 'this place'}?`}>
              {#each KINDS as k (k)}
                <button type="button" role="radio" aria-checked={kindOf(p) === k} onclick={() => (kinds[p.id] = k)}>{k}</button>
              {/each}
            </div>
            {#if editing[p.id] || !p.suggestedLabel}
              <label class="nq-label">
                <span>Name</span>
                <input name="label" value={labelOf(p)} oninput={(e) => (labels[p.id] = e.currentTarget.value)} maxlength="60" required />
              </label>
              <button class="nq-primary" type="submit">Save name</button>
            {:else}
              <input type="hidden" name="label" value={p.suggestedLabel} />
              <button class="nq-primary" type="submit">Use “{p.suggestedLabel}”</button>
              <button class="nq-secondary" type="button" onclick={() => (editing[p.id] = true)}>Rename</button>
            {/if}
            <button class="nq-secondary" type="submit" formaction="/home/people/places?/remove" formnovalidate>Not a place</button>
          </form>
          {#if errors[p.id]}<p class="nq-error" role="alert">{errors[p.id]}</p>{/if}
        {/if}
      </li>
    {/each}
  </ul>
  {#if !left.length}<p class="nq-quiet">All done for this window. Routes through these places are re-learned on the next read.</p>{/if}
{/if}

<style>
  .nq-lede,
  .nq-quiet {
    color: var(--text-muted);
    font-size: var(--fs-body-sm);
  }
  .nq {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    padding: 12px 0;
    border-top: 1px solid var(--line);
    display: grid;
    gap: 8px;
  }
  li.done {
    opacity: 0.6;
  }
  .nq-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .nq-name {
    min-width: 0;
    flex: 1;
  }
  .nq-name strong {
    font-size: var(--fs-nav);
  }
  small {
    display: block;
    margin-top: 2px;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .nq-bar {
    display: block;
    height: 4px;
    margin-top: 6px;
    background: var(--surface-rail);
  }
  .nq-bar i {
    display: block;
    height: 100%;
    background: var(--accent-ink);
  }
  .nq-done {
    font: 600 var(--fs-label-xs) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--good);
  }
  .nq-form {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .nq-kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-right: 8px;
  }
  @media (max-width: 720px) {
    .nq-kinds {
      width: 100%;
      margin-right: 0;
    }
  }
  .nq-kinds button {
    font: 500 var(--fs-label) var(--font-body);
    padding: 3px 9px;
    border-radius: 100px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .nq-kinds button[aria-checked='true'] {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
    background: rgb(from var(--accent-ink) r g b / 8%);
  }
  .nq-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--fs-label) var(--font-mono);
    flex: 1 1 220px;
  }
  .nq-label input {
    flex: 1;
    min-width: 0;
    font: var(--fs-body) var(--font-body);
    padding: 5px 8px;
    border: 1px solid var(--line-strong);
    background: var(--surface-card);
    color: var(--text-primary);
    border-radius: 2px;
  }
  .nq-primary,
  .nq-secondary {
    font: 600 var(--fs-label) var(--font-mono);
    padding: 6px 10px;
    border-radius: 2px;
    cursor: pointer;
    white-space: nowrap;
  }
  .nq-primary {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--bg);
  }
  .nq-secondary {
    background: transparent;
    border: 1px solid var(--line-strong);
    color: var(--text-primary);
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .nq-error {
    margin: 0;
    color: var(--error, #c44);
    font-size: var(--fs-label);
  }
</style>
