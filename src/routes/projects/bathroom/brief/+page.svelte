<script lang="ts">
  import { onMount } from 'svelte';
  import { stats } from '../lib/checks';
  import { briefText } from '../lib/brief';
  import { persist, s } from '../lib/state.svelte';

  let copied = $state('');

  function rebuild() {
    s.brief = briefText({
      plan: s.plan,
      stats: stats(s.plan),
      cost: s.cost,
      address: s.address,
      start: s.prog.start,
    });
    persist();
  }

  // First visit with nothing edited yet: write one from the current choices.
  // Deliberately onMount, not $effect — an effect that reads s.brief and then
  // writes it is a read-own-write cycle.
  onMount(() => {
    if (!s.brief) rebuild();
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(s.brief);
      copied = 'Copied — paste it into an email.';
    } catch {
      copied = 'Copy failed — select the text and copy it by hand.';
    }
    setTimeout(() => (copied = ''), 2600);
  }
</script>

<svelte:head>
  <title>Your brief — Bathroom Planner</title>
</svelte:head>

<div class="bth-wrap bth-stack g40">
  <header class="bth-stack g12">
    <span class="bth-eyebrow">08 · Your brief</span>
    <h1 class="bth-h1">The thing you send to three fitters</h1>
    <p class="bth-lead">
      Built from your layout and your spec. Send the same text to everyone you ask, and their quotes
      become genuinely comparable — which is the whole point, and the thing almost nobody does.
    </p>
  </header>

  <div class="bth-stack g16">
    <div class="bth-row" style="align-items:flex-end; gap:1rem">
      <div class="bth-field" style="flex:1 1 320px; max-width:420px">
        <label for="addr">Your address (goes at the top of the brief)</label>
        <input
          class="bth-input"
          id="addr"
          type="text"
          placeholder="e.g. 12 Example Street, Town, POSTCODE"
          bind:value={s.address}
          oninput={persist}
        />
      </div>
      <button class="bth-btn primary" type="button" onclick={copy}>Copy the brief</button>
      <button class="bth-btn" type="button" onclick={rebuild}>Rebuild from my choices</button>
      {#if copied}<span class="bth-small bth-muted">{copied}</span>{/if}
    </div>
    <p class="bth-small bth-muted">
      Your address is only ever stored in this browser, and only appears in the text below. Edit the
      brief freely before you send it — add anything a fitter should know.
    </p>
    <textarea
      class="bth-input"
      rows="30"
      spellcheck="false"
      aria-label="Project brief"
      bind:value={s.brief}
      oninput={persist}
    ></textarea>
  </div>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">When the quotes come back</span>
      <h2 class="bth-h2">Comparing three quotes without a headache</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-tablewrap">
      <table>
        <thead><tr><th>Line them up on</th><th>Why it matters</th></tr></thead>
        <tbody>
          <tr><td><strong>Total including VAT</strong></td><td>One of them may not be VAT registered. That's a 20% difference that has nothing to do with quality.</td></tr>
          <tr><td><strong>What's supplied by whom</strong></td><td>The cheapest quote is often cheapest because it excludes £1,800 of materials.</td></tr>
          <tr><td><strong>Days on site</strong></td><td>Five days for a full refit means corners. Fifteen means it might not be their priority job.</td></tr>
          <tr><td><strong>Tiling area and finish</strong></td><td>Half-height versus floor-to-ceiling on four walls is easily £1,200 of difference.</td></tr>
          <tr><td><strong>Electrical certificate</strong></td><td>In the price, or an extra?</td></tr>
          <tr><td><strong>Waste and making good</strong></td><td>Skip, dust protection, decorating, and who leaves the landing carpet clean.</td></tr>
          <tr><td><strong>Guarantee</strong></td><td>Length, what it covers, insurance-backed or not.</td></tr>
          <tr><td><strong>How they were to deal with</strong></td><td>Did they turn up when they said, answer the questions, and put it in writing without being chased? That's the best single predictor of the job.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="bth-note">
      <span class="bth-eyebrow">A word on the cheapest quote</span>
      <p class="bth-small">
        If one quote is 30% below the other two, it isn't a bargain, it's a different job. Either
        something's excluded or someone's underestimated — and an underestimated job goes wrong
        halfway through when they realise. Ring them and ask what they've allowed for tiling and for
        making good. The answer usually explains it in a minute.
      </p>
    </div>
  </section>
</div>
