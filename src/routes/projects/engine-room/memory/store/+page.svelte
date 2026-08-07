<script lang="ts">
  // Somewhere to put anything — Part II, leaf 5.
  //
  // The page argues that dropping the schema is the easy half. What makes a schema-free store
  // safe to hand to something that writes unattended at 3am is the access layer around it, so
  // the flagship instrument is the permission resolution rather than the storage.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import PermissionBench from './components/PermissionBench.svelte';
  import { PRECEDENCE, WILDCARDS, PER_ACTION, QUERY, QUERY_SAFETY, EXPIRY, REAPER, LEDGER, LIMITS } from '../../lib/store';

  const TONE = 'var(--accent)';
  let ttl = $state(EXPIRY[1].id);
  const chosenTtl = $derived(EXPIRY.find((e) => e.id === ttl) ?? EXPIRY[1]);
  let safety = $state(0);
  const chosenSafety = $derived(QUERY_SAFETY[safety]);
</script>

<svelte:head>
  <title>Somewhere to put anything · The Engine Room</title>
  <meta name="description" content="A schema-free store built to be written to unattended: an actor on every call, permissions resolved on the row, a query language with no concatenation in it, and an expiry date." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Somewhere to put anything"
    line="A typed table is right when the shape is known and costs more than it is worth when it is not. The long tail goes here — and everything that makes it safe to write to unattended is bolted on the outside."
    lineEli5="A place to keep anything that does not deserve its own database table, with rules about who can see each thing and when it should disappear." />

  <Instrument
    kicker="The instrument"
    title="Who may do what, and which rule decided"
    tone={TONE}
    reading="Pick a record and a principal. Each action resolves on its own."
    takeaway={PER_ACTION.body}>
    <PermissionBench />
  </Instrument>

  <Instrument
    kicker="The chain"
    title="Three places an answer can come from"
    tone={TONE}
    reading="Nearest wins, and anything absent from it falls to the next one for that action alone.">
    <ol class="chain">
      {#each PRECEDENCE as p, i (p.id)}
        <li><span class="c-n">{i + 1}</span><b>{p.label}</b><span>{p.what}</span></li>
      {/each}
    </ol>
    <div class="wilds">
      {#each WILDCARDS as w (w.k)}
        <div class="wild"><code>{w.k}</code><span>{w.why}</span></div>
      {/each}
    </div>
  </Instrument>

  <Instrument
    kicker="Asking it questions"
    title="A filter language with no string concatenation in it"
    tone={TONE}
    reading="Pick a rule."
    takeaway="One language across a workflow node, an agent toolset and the admin interface — so none of them has to learn SQL, and none of them can invent a dialect of its own.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Query safety rules">
        {#each QUERY_SAFETY as q, i (q.k)}
          <button type="button" class="chip" class:on={safety === i} aria-pressed={safety === i}
                  onclick={() => (safety = i)}>{q.k}</button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenSafety.why}</p>
    </div>
    <div class="stats">
      <Stat value={QUERY.operators.length} label="comparison operators"
            how={QUERY.operators.join(' · ')} tone={TONE} />
      <Stat value={QUERY.aggregates.length} label="aggregates, grouped or not"
            how={QUERY.aggregates.join(' · ')} tone={TONE} />
      <Stat value={QUERY.defaultLimit} label="rows per page by default"
            how="capped at {QUERY.maxLimit}; asking for everything returns a page" tone={TONE} />
      <Stat value={LEDGER.actions.length} label="kinds of event in the ledger"
            how={LEDGER.actions.join(' · ')} tone={TONE} />
    </div>
  </Instrument>

  <Instrument
    kicker="Letting go of it"
    title="Three ways a record can end"
    tone={TONE}
    reading="Pick one."
    takeaway={REAPER.body}>
    <div class="strip">
      <div class="chips" role="group" aria-label="Expiry modes">
        {#each EXPIRY as e (e.id)}
          <button type="button" class="chip" class:on={ttl === e.id} aria-pressed={ttl === e.id}
                  onclick={() => (ttl = e.id)}>{e.label}</button>
        {/each}
      </div>
      <p class="why" aria-live="polite"><b>{chosenTtl.what}</b> {chosenTtl.use}</p>
    </div>
    <ul class="limits">
      {#each LIMITS as l (l.k)}<li><b>{l.k}</b><span>{l.why}</span></li>{/each}
    </ul>
  </Instrument>

  <aside class="note">
    <span class="n-kick">{LEDGER.title}</span>
    <p>{LEDGER.body}</p>
  </aside>

  <PageFoot />
</section>

<style>
  .chain { margin: 0 0 12px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .chain li { display: grid; grid-template-columns: 20px minmax(150px, 230px) 1fr; gap: 10px;
    align-items: baseline; padding: 7px 10px; border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.55); }
  .c-n { width: 18px; height: 18px; display: grid; place-items: center; border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; color: var(--accent); }
  .chain b { font-size: 12.5px; color: var(--text-primary); }
  .chain span { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.68); }

  .wilds { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
  .wild { display: flex; flex-direction: column; gap: 3px; padding: 9px 12px;
    border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); }
  .wild code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--accent); }
  .wild span { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.65); }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .chip:hover { background: rgba(28,22,17,0.07); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .why { margin: 0; min-height: 3em; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.72); max-width: 84ch; }
  .why b { color: var(--text-primary); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; margin-top: 12px; }

  .limits { margin: 12px 0 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px; }
  .limits li { display: flex; flex-direction: column; gap: 2px; padding: 8px 11px;
    border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(255,255,255,0.5); }
  .limits b { font-size: 12.5px; color: var(--text-primary); }
  .limits span { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.65); }

  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 16px;
    padding: 10px 14px; border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent); }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }


  @media (max-width: 620px) {
    .chain li { grid-template-columns: 20px 1fr; }
    .chain span { grid-column: 2 / -1; }
    .why { min-height: 0; }
  }
</style>
