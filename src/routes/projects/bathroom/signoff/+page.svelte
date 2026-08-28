<script lang="ts">
  import { HANDOVER, SNAGS, snagKey } from '../lib/content';
  import { persist, s } from '../lib/state.svelte';

  const totalSnags = SNAGS.reduce((a, g) => a + g[1].length, 0);
  const doneSnags = $derived(
    SNAGS.reduce(
      (a, g, gi) => a + g[1].filter((_, i) => s.snags[snagKey(gi, i)]).length,
      0,
    ),
  );
  const pct = $derived(totalSnags ? (doneSnags / totalSnags) * 100 : 0);

  let copied = $state('');

  function clearTicks() {
    s.snags = {};
    persist();
  }

  async function copyOutstanding() {
    const out: string[] = [];
    SNAGS.forEach((g, gi) => {
      const rem = g[1].filter((_, i) => !s.snags[snagKey(gi, i)]);
      if (rem.length) out.push(g[0].toUpperCase(), ...rem.map((r) => '- ' + r), '');
    });
    const text = out.length ? out.join('\n') : 'Everything ticked off.';
    try {
      await navigator.clipboard.writeText(text);
      copied = 'Outstanding snags copied.';
    } catch {
      copied = 'Copy failed — select the list and copy it by hand.';
    }
    setTimeout(() => (copied = ''), 2600);
  }
</script>

<svelte:head>
  <title>Signing off — Bathroom Planner</title>
</svelte:head>

<div class="bth-wrap bth-stack g40">
  <header class="bth-stack g12">
    <span class="bth-eyebrow">07 · Signing off</span>
    <h1 class="bth-h1">Paperwork, payments and the snag list</h1>
    <p class="bth-lead">
      This is the part people skip and the part that decides whether a disagreement is a ten-minute
      conversation or a six-month grievance. None of it is difficult. It's about a page of writing
      and one deliberate decision: don't pay the last chunk until you've walked the room properly.
    </p>
  </header>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Before a deposit leaves your account</span>
      <h2 class="bth-h2">What has to be on the paper</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <div class="bth-stack g16">
        <p class="bth-body">
          You don't need a formal building contract for a bathroom. A detailed written quotation
          that both of you sign does the same job. For anything larger, the JCT Home Owner contract
          is the standard consumer version and is worth knowing exists.
        </p>
        <ul class="bth-ticks">
          <li><strong>Scope.</strong> Job by job, including the boring bits: making good, decorating, waste removal, dust protection.</li>
          <li><strong>The spec list.</strong> Every item with make and model number. "Chrome mixer tap" is not a specification; a product code is.</li>
          <li><strong>Who supplies what.</strong> Line by line. This is the most common source of "I thought you were doing that".</li>
          <li><strong>A fixed total,</strong> with VAT stated separately or explicitly included.</li>
          <li><strong>Start date and expected finish date,</strong> and what happens if it overruns because of them rather than because of you.</li>
          <li><strong>Payment stages</strong> tied to work completed, not to dates.</li>
          <li><strong>How variations are priced</strong> — in writing, before the work happens.</li>
          <li><strong>Working hours,</strong> access arrangements and where the van goes.</li>
          <li><strong>The guarantee:</strong> how long, what it covers, and whether it's insurance-backed or personal.</li>
          <li><strong>Insurance:</strong> their public liability, with the certificate attached.</li>
        </ul>
        <div class="bth-note">
          <span class="bth-eyebrow">Your statutory backstop</span>
          <p class="bth-small">
            Under the Consumer Rights Act 2015, work must be done with reasonable care and skill, in
            a reasonable time, for a reasonable price where none was agreed. If it isn't, you're
            entitled to have it put right, and if that fails, to a price reduction. That's true
            whether or not it's written down — but proving what was agreed is enormously easier when
            it is.
          </p>
        </div>
      </div>
      <div class="bth-stack g16">
        <div class="bth-card">
          <h3 class="bth-h3">A payment schedule that protects you</h3>
          <div class="bth-tablewrap">
            <table>
              <thead><tr><th>Stage</th><th>Trigger</th><th>%</th></tr></thead>
              <tbody>
                <tr><td>Deposit</td><td>On signing, to book the slot</td><td class="n">10%</td></tr>
                <tr><td>Stage 1</td><td>Strip-out and first fix complete</td><td class="n">25%</td></tr>
                <tr><td>Stage 2</td><td>Boarding, plastering and tiling complete</td><td class="n">30%</td></tr>
                <tr><td>Stage 3</td><td>Second fix complete, everything working</td><td class="n">30%</td></tr>
                <tr><td><strong>Retention</strong></td><td><strong>Snag list cleared, certificates handed over</strong></td><td class="n"><strong>5%</strong></td></tr>
              </tbody>
            </table>
          </div>
          <ul class="bth-ticks">
            <li><strong>Deposit:</strong> 5–10% is normal to hold a date. Up to 25% is defensible if they're buying your materials. More than that, or cash, is a red flag.</li>
            <li><strong>Never pay ahead of the work.</strong> Each stage is paid when you can see it's done.</li>
            <li><strong>Retention:</strong> 2.5–5% held for two to four weeks after they finish. Say it out loud at quote stage — a professional will shrug; the reaction tells you a lot.</li>
            <li><strong>Pay by card or bank transfer,</strong> never cash. Over £100 on a credit card gives you Section 75 protection, which makes the card company jointly liable.</li>
          </ul>
        </div>
        <div class="bth-note warn">
          <span class="bth-eyebrow">Variations — the thing that causes the arguments</span>
          <p class="bth-small">
            Any change to the agreed scope, whether it's your idea or something they found behind
            the bath, gets a short written note before the work happens: what it is, what it costs,
            how many days it adds. A text message counts. What doesn't count is "we'll sort it at
            the end", because at the end you'll each remember a different number.
          </p>
        </div>
      </div>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">The rules, briefly</span>
      <h2 class="bth-h2">What the regulations actually want</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <div class="bth-card">
        <h3 class="bth-h3">Do you need building control?</h3>
        <p class="bth-small">
          For a straight bathroom refit — new fittings in roughly the same places — generally no.
          You <em>do</em> need to think about it if:
        </p>
        <ul class="bth-ticks">
          <li>You're putting a bathroom where there wasn't one before.</li>
          <li>You're changing the drainage — moving the WC, adding a new soil connection.</li>
          <li>You're fitting or replacing an unvented hot water cylinder (notifiable in its own right, and the installer must be G3 qualified).</li>
          <li>Anything structural — taking out a wall, altering joists for a wet room floor.</li>
        </ul>
        <p class="bth-small bth-muted">
          Most competent installers self-certify their own part through a scheme, which is the easy
          route. Your local council handles the rest.
        </p>
      </div>
      <div class="bth-card">
        <h3 class="bth-h3">Electrics — Part P</h3>
        <p class="bth-small">
          Electrical work in a bathroom is notifiable. In practice your electrician must either be
          registered with a competent-person scheme (NICEIC, NAPIT, ELECSA) and self-certify, or the
          work must be signed off by building control.
        </p>
        <ul class="bth-ticks">
          <li>Every circuit serving the bathroom needs 30 mA RCD protection.</li>
          <li>Fittings are rated by zone: inside the bath or shower is Zone 0, above it to 2.25 m is Zone 1, and 0.6 m beyond that is Zone 2. IP65 in a shower, IP44 minimum elsewhere.</li>
          <li>No ordinary socket outlets in a bathroom. A shaver supply unit to the right standard is allowed, but it has to sit outside the zones around the bath and shower.</li>
          <li><strong>You must end up holding a certificate.</strong> Electrical Installation Certificate for new circuits, Minor Works Certificate for alterations. No certificate, no final payment.</li>
        </ul>
      </div>
      <div class="bth-card">
        <h3 class="bth-h3">Ventilation — Part F</h3>
        <p class="bth-small">
          A bathroom with a bath or shower needs mechanical extract of at least
          <strong>15 litres per second</strong> on intermittent operation. An openable window doesn't
          replace it.
        </p>
        <ul class="bth-ticks">
          <li>Duct it to outside, in rigid pipe, by the shortest route. Flexible duct sagging in a loft is how you get condensation dripping back down.</li>
          <li>Humidity-sensing with an overrun is worth the extra £60.</li>
          <li>If the fan is above the bath or shower it needs an appropriate IP rating and to be on a safe voltage.</li>
        </ul>
      </div>
      <div class="bth-card">
        <h3 class="bth-h3">Water and safety — Part G</h3>
        <ul class="bth-ticks">
          <li>Hot water to a bath must be limited to <strong>48°C</strong> by a thermostatic mixing valve in new work — scald protection.</li>
          <li>Fittings must be WRAS-approved or equivalent, and there are rules about backflow protection on showers and bidets.</li>
          <li>Unvented cylinders need a G3-qualified installer, a discharge route, and annual servicing.</li>
        </ul>
        <p class="bth-small bth-muted">
          You don't need to police any of this. You need to ask "who's certifying the electrics, and
          will the ventilation meet Part F?" at quote stage, and then check the paper arrives at the
          end.
        </p>
      </div>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">The last 5%</span>
      <h2 class="bth-h2">Snag list</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <div class="bth-stack g16">
        <p class="bth-body">
          Walk the room twice: once on the day they say they've finished, and once about a week
          later after you've actually used it. Do it in daylight, with a torch, on your own,
          unhurried. Twenty to thirty snags on a bathroom is completely normal and not an insult —
          what matters is how quickly they're put right.
        </p>
        <ul class="bth-ticks">
          <li>Take a photo of every snag with something for scale.</li>
          <li>Send the whole list in one message, numbered, not as it occurs to you over four days.</li>
          <li>Agree a date for them to come back before you pay the balance.</li>
          <li>The 5% retention stays put until the list is clear. That's what it's for.</li>
        </ul>
      </div>
      <div class="bth-card">
        <div class="bth-row" style="justify-content:space-between">
          <h3 class="bth-h3">Progress</h3>
          <span class="bth-num"><strong>{doneSnags} / {totalSnags}</strong></span>
        </div>
        <div class="meter"><i style="width:{pct}%"></i></div>
        <p class="bth-small bth-muted">Tick things off as you check them. Saves in this browser.</p>
        <div class="bth-row">
          <button class="bth-btn" type="button" onclick={clearTicks}>Clear all ticks</button>
          <button class="bth-btn" type="button" onclick={copyOutstanding}>Copy the unticked ones</button>
          {#if copied}<span class="bth-small bth-muted">{copied}</span>{/if}
        </div>
      </div>
    </div>

    <div class="bth-stack g12">
      {#each SNAGS as [group, items], gi (group)}
        {@const done = items.filter((_, i) => s.snags[snagKey(gi, i)]).length}
        <details class="snaggroup" open={gi === 0}>
          <summary>
            {group}<span class="cnt">{done}/{items.length}</span>
          </summary>
          <div class="snagitems">
            {#each items as text, i (text)}
              {@const k = snagKey(gi, i)}
              <label class="snagitem" class:done={s.snags[k]}>
                <input
                  type="checkbox"
                  checked={!!s.snags[k]}
                  onchange={(e) => { s.snags[k] = e.currentTarget.checked; persist(); }}
                />
                <span>{text}</span>
              </label>
            {/each}
          </div>
        </details>
      {/each}
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Don't let them leave without it</span>
      <h2 class="bth-h2">The handover pack</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <div class="snaggroup">
        <div class="snagitems">
          {#each HANDOVER as text, i (text)}
            {@const k = 'h' + i}
            <label class="snagitem" class:done={s.hand[k]}>
              <input
                type="checkbox"
                checked={!!s.hand[k]}
                onchange={(e) => { s.hand[k] = e.currentTarget.checked; persist(); }}
              />
              <span>{text}</span>
            </label>
          {/each}
        </div>
      </div>
      <div class="bth-stack g16">
        <div class="bth-note crit">
          <span class="bth-eyebrow">The one that catches people out</span>
          <p class="bth-small">
            The electrical certificate. It's the document a solicitor asks for when you sell, the
            one an insurer wants after a fire, and the one that's hardest to get six months later
            when the electrician has moved on. Ask for it on the day. Some schemes post it out
            within a few weeks — fine, but get the notification reference before you pay the
            balance.
          </p>
        </div>
        <div class="bth-note">
          <span class="bth-eyebrow">If it goes wrong</span>
          <ol class="bth-ol">
            <li>Raise it in writing, politely, with photos, and give a reasonable chance to fix it. Most things end here.</li>
            <li>If they won't engage: a formal letter setting out the defect, the Consumer Rights Act 2015, and a deadline.</li>
            <li>If they're members of a scheme — TrustMark, Checkatrade, a trade association — use the scheme's dispute process. It works surprisingly often.</li>
            <li>Section 75 if you paid any of it on a credit card. Chargeback if it was a debit card.</li>
            <li>Citizens Advice consumer helpline, then the small claims track if it comes to it. Under £10,000 it's designed to be used without a solicitor.</li>
          </ol>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .meter {
    height: 6px;
    background: var(--bg-section);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--success);
    border-radius: var(--radius-pill);
    transition: width var(--t-base) var(--ease-out);
  }
  .snaggroup {
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    background: var(--surface-card);
    overflow: hidden;
  }
  .snaggroup > summary {
    cursor: pointer;
    padding: 0.6rem 0.8rem;
    font-family: var(--font-mono);
    font-size: var(--fs-nav);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--bg-section);
    list-style: none;
    color: var(--text-primary);
  }
  .snaggroup > summary::-webkit-details-marker { display: none; }
  .snaggroup > summary::before { content: '+'; color: var(--accent); }
  .snaggroup[open] > summary::before { content: '−'; }
  .snaggroup > summary .cnt {
    margin-left: auto;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .snagitems { display: flex; flex-direction: column; padding: 0.25rem 0; }
  .snagitem {
    display: flex;
    gap: 0.65rem;
    align-items: flex-start;
    padding: 0.45rem 0.8rem;
    border-top: 1px solid var(--line-hair);
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .snagitem:first-child { border-top: 0; }
  .snagitem input { margin-top: 3px; flex: none; }
  .snagitem.done span {
    color: var(--text-ghost);
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }
  @media (prefers-reduced-motion: reduce) {
    .meter i { transition: none; }
  }
</style>
