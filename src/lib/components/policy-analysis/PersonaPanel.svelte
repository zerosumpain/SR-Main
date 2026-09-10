<script lang="ts">
  // A PERSONA IS A BODY YOU KEEP MEETING — so this panel answers three questions
  // the report could not previously separate.
  //
  // 1. WHAT DID THIS ASSESSMENT FIND, versus what does the library already hold?
  //    The same word covered both, in one table, with no boundary. `here` is this
  //    run; `records` is the standing dossier.
  // 2. IS THE LIBRARY SPLITTING A BODY IT SHOULD KEEP TOGETHER? It is — four
  //    Education Endowment Foundation records, three Employers, every one seen
  //    exactly once. Four blocks with the same name and the same context is what
  //    made this unreadable, so a split body is shown ONCE with the split named.
  // 3. WHAT DOES THIS PERSONA ACTUALLY AFFECT? A persona in a column, divorced
  //    from the plays it enables, is a wall of narrative you cannot refer to or
  //    from. Every group carries its plays and links straight into them.
  //
  // Traits are collapsed by default: twelve of them per body, unfolded, is the
  // scrolling problem this panel exists to end.
  import { TRAIT_LABELS } from '$lib/policy-analysis/contracts';
  import type { PersonaGroup } from '$lib/policy-analysis/view';

  interface Props {
    groups: PersonaGroup[];
    inspect: (id: string) => void;
    /** Jump to the playbook — a persona is only meaningful next to what it can do. */
    onplay: () => void;
  }
  let { groups, inspect, onplay }: Props = $props();

  const band = (worst: number) => (worst >= 0.7 ? 'severe' : worst >= 0.5 ? 'significant' : worst > 0 ? 'limited' : 'none');

  /** A profile field is `{ value, origin, confidence, refs }`; anything else is not a trait. */
  function traits(profile: Record<string, unknown> | null) {
    if (!profile) return [];
    return Object.entries(profile)
      .filter(([, v]) => typeof v === 'object' && v !== null && 'value' in (v as object))
      .map(([key, v]) => ({ key, label: TRAIT_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').toLowerCase(), ...(v as { value: string; origin: string }) }));
  }
</script>

{#if !groups.length}
  <p class="muted">No body in this assessment matches a persona in the library yet.</p>
{:else}
  <ul class="groups">
    {#each groups as g (g.name)}
      <li class="group">
        <div class="head">
          <strong class="name">{g.name}</strong>
          <span class="band {band(g.worst)}">{band(g.worst)}</span>
          {#if g.plays.length}
            <button class="link plays" onclick={onplay}>{g.plays.length} play{g.plays.length === 1 ? '' : 's'}</button>
          {:else}
            <span class="muted small">no plays</span>
          {/if}
        </div>

        <p class="lines">
          <span class="src here">This run</span>
          {g.here.length} actor row{g.here.length === 1 ? '' : 's'}, {g.here.filter((h) => h.profile).length} profiled
        </p>
        <p class="lines">
          <span class="src lib">Library</span>
          {#if g.records.length > 1}
            <strong>{g.records.length} separate records</strong> under this name — the library has split one body,
            so its history is spread across {g.records.length} dossiers rather than accumulating in one.
          {:else}
            1 record, seen {g.records[0].sightings} time{g.records[0].sightings === 1 ? '' : 's'}
          {/if}
          {#each g.records as r (r.personaId)}
            <a class="link" href="/policy-analysis/personas/{r.personaId}">dossier</a>
          {/each}
        </p>

        {#each g.here as view (view.actor.id)}
          {@const list = traits(view.profile?.data as Record<string, unknown> | null)}
          {#if list.length}
            <details>
              <summary>{list.length} traits this assessment established for {view.actor.label}</summary>
              <dl class="traits">
                {#each list as t (t.key)}
                  <dt>{t.label}</dt>
                  <dd>
                    {t.value}
                    <span class="origin" class:prior={t.origin === 'prior_assessment'}>{t.origin.replaceAll('_', ' ')}</span>
                  </dd>
                {/each}
              </dl>
              <button class="link" onclick={() => inspect(view.actor.id)}>Inspect provenance</button>
            </details>
          {/if}
        {/each}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .groups { list-style: none; margin: 1rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; background: var(--line); border: 1px solid var(--line); }
  .group { background: var(--bg); padding: .85rem 1rem; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; }
  .name { font-size: var(--fs-body); }
  .band { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; padding: .1rem .4rem; border-radius: 2px; background: var(--surface-sunken); color: var(--text-secondary); }
  .band.severe { background: var(--accent); color: var(--bg); }
  .band.significant { background: var(--accent-ink); color: var(--bg); }
  .plays { margin-left: auto; }
  .lines { margin: .45rem 0 0; font-size: var(--fs-body-sm); color: var(--text-secondary); }
  .src { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; margin-right: .5rem; padding: .1rem .35rem; border-radius: 2px; }
  .src.here { background: var(--accent-ink); color: var(--bg); }
  .src.lib { background: var(--surface-sunken); color: var(--text-secondary); }
  .small { font-size: var(--fs-label); }
  details { margin: .5rem 0 0; }
  summary { cursor: pointer; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-secondary); }
  .traits { margin: .6rem 0 .4rem; display: grid; grid-template-columns: minmax(8rem, 12rem) 1fr; gap: .3rem .9rem; font-size: var(--fs-body-sm); }
  .traits dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .traits dd { margin: 0; }
  .origin { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-ghost); margin-left: .4rem; }
  /* A trait carried from a prior assessment is CONTEXT, never evidence — it must look different. */
  .origin.prior { color: var(--warn); }
  @media (max-width: 40rem) { .traits { grid-template-columns: 1fr; gap: .1rem; } .traits dd { margin-bottom: .4rem; } }
</style>
