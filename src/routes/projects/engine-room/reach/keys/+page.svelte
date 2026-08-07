<script lang="ts">
  // Keys it can use and cannot read — Part III, leaf 3.
  //
  // The claim the page has to earn is that "the agent cannot leak the credential" is a
  // property of the shape rather than of the agent's behaviour. So the instrument is the
  // enforcement, run live: pick a credential, aim it somewhere it should not go, and read the
  // refusal it would actually produce.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import BindingBench from './components/BindingBench.svelte';
  import { CHECKS, NEVER_READ, STORE_ONLY, EVERY_HOP, REQUEST_FLOW, NO_PARAMETER } from '../../lib/keys';

  const TONE = 'var(--success)';
  let fact = $state(0);
  const chosen = $derived(NEVER_READ[fact]);

</script>

<svelte:head>
  <title>Keys it can use and cannot read · The Engine Room</title>
  <meta name="description" content="Credentials an autonomous agent can authenticate with but never see: owner-set host binding enforced on every request and every redirect hop, optional path and method narrowing, and a request flow with no dangerous parameter." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="Keys it can use and cannot read"
    line="The assistant authenticates as itself to a dozen services and has never seen a single one of their credentials. Where a key may go is a property of the key, set by hand, checked on every request."
    lineEli5="It can log in to other services on my behalf, but it is never shown the passwords — and each one only works on the exact address it was set up for." />

  <Instrument
    kicker="The instrument"
    title="Aim a credential somewhere and see what happens"
    tone={TONE}
    reading="Four gates, in the order the resolver applies them. Every refusal names its own list."
    takeaway="The binding is the boundary, not the tool that uses it. An entry saying “use the gateway key against my server” is a perfectly well-formed request that simply fails to authenticate, because the attacker’s host is not on the owner’s list and only the owner can put it there.">
    <BindingBench />
  </Instrument>

  <div class="pair">
    <aside class="note">
      <span class="n-kick">{EVERY_HOP.title}</span>
      <p>{EVERY_HOP.body}</p>
    </aside>
    <aside class="note">
      <span class="n-kick">{STORE_ONLY.title}</span>
      <p>{STORE_ONLY.body}</p>
    </aside>
  </div>

  <Instrument
    kicker="Why it cannot be read back"
    title="Four rules that keep a value out of every transcript"
    tone={TONE}
    reading="Pick one.">
    <div class="strip">
      <div class="chips" role="group" aria-label="How values are kept out of reach">
        {#each NEVER_READ as f, i (f.k)}
          <button type="button" class="chip" class:on={fact === i} aria-pressed={fact === i}
                  onclick={() => (fact = i)}>{f.k}</button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosen.why}</p>
    </div>
  </Instrument>

  <Instrument
    kicker="Asking for one that does not exist yet"
    title="The model names a provider, and supplies nothing else"
    tone={TONE}
    reading="Who contributes what, when a capability needs a credential nobody has set up."
    takeaway={NO_PARAMETER.body}>
    <ol class="flow">
      {#each REQUEST_FLOW as step, i (step.id)}
        <li><span class="f-n">{i + 1}</span><b>{step.actor}</b><span class="f-w">{step.what}</span></li>
      {/each}
    </ol>
  </Instrument>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: 0 0 16px;
    padding: 10px 14px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 8%, transparent); }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--success); }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; margin-top: -6px; }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .chip:hover { background: rgba(28,22,17,0.07); }
  .chip.on { background: var(--success); border-color: var(--success); color: #fff; }
  .why { margin: 0; min-height: 3em; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.72); max-width: 84ch; }

  .flow { margin: 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
  .flow li { display: grid; grid-template-columns: 20px 1fr; gap: 4px 9px; align-items: baseline;
    padding: 9px 12px; border: 1px solid rgba(28,22,17,0.14); border-top: 3px solid var(--success);
    border-radius: var(--radius-round); background: rgba(255,255,255,0.5); }
  .f-n { width: 18px; height: 18px; display: grid; place-items: center; border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--success) 20%, transparent);
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; color: var(--success); }
  .flow b { font-size: 12.5px; color: var(--text-primary); }
  .f-w { grid-column: 2; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.65); }

  @media (max-width: 560px) { .why { min-height: 0; } }
</style>
