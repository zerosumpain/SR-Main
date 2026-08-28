<script lang="ts">
  const B = '/projects/bathroom';
</script>

<svelte:head>
  <title>Bathroom Planner — Strange Ramblings</title>
  <meta
    name="description"
    content="Plan a bathroom refit in a period terrace: a to-scale floor plan planner, a two-way cost model at 2026 rates, who does what, the order of works, and the snag list."
  />
</svelte:head>

<div class="bth-wrap bth-stack g56">
  <header class="bth-stack g16">
    <span class="bth-eyebrow">01 · Start here</span>
    <h1 class="bth-h1">A bathroom, from nothing to signed off</h1>
    <div class="bth-prose">
      <p>
        A hundred-year-old terrace, a bathroom that's had its day, and no idea where to start.
        That's completely normal. A bathroom is the fiddliest room in the house per square metre:
        five trades, forty decisions, and about nine days of your only bathroom being a building
        site.
      </p>
      <p>
        The good news is it's a well-trodden path. There's a standard order of works, a standard set
        of trades, and a fairly predictable price. What separates a smooth job from a miserable one
        isn't luck — it's deciding things <em>before</em> anyone picks up a hammer, and writing them
        down.
      </p>
      <p>
        This is that writing-down. Work through the sections in order the first time. After that,
        the <a href="{B}/planner">Planner</a>, <a href="{B}/money">Money</a> and
        <a href="{B}/signoff">Signing off</a> pages are the ones you'll keep coming back to.
      </p>
    </div>
  </header>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">The short version</span>
      <h2 class="bth-h2">Five things that actually matter</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <div class="bth-card">
        <span class="bth-pill accent">One</span>
        <h3 class="bth-h3">Moving the toilet is the expensive decision</h3>
        <p class="bth-small bth-muted">
          Everything else — taps, tiles, the shape of the bath — is shopping. Moving the WC away
          from the soil stack means new falls, boxing, sometimes a macerator. Decide this first,
          because it sets your layout and about a grand of your budget.
        </p>
      </div>
      <div class="bth-card">
        <span class="bth-pill accent">Two</span>
        <h3 class="bth-h3">Labour is roughly half the bill</h3>
        <p class="bth-small bth-muted">
          People shop for a bath for three weeks and pick a fitter in an afternoon. It should be the
          other way round. Tiling alone can cost more than the suite.
        </p>
      </div>
      <div class="bth-card">
        <span class="bth-pill accent">Three</span>
        <h3 class="bth-h3">Buy everything before day one</h3>
        <p class="bth-small bth-muted">
          Not "most of it". Everything, in the house, boxes opened and checked. A missing shower
          valve on day four stops five trades and costs you a fortnight.
        </p>
      </div>
      <div class="bth-card">
        <span class="bth-pill accent">Four</span>
        <h3 class="bth-h3">A hundred-year-old house will surprise you</h3>
        <p class="bth-small bth-muted">
          Lath and plaster, a rotten board under the bath, lead pipe, an artex ceiling. Hold back
          12–15% for it and you'll shrug. Don't, and every surprise is an argument.
        </p>
      </div>
      <div class="bth-card">
        <span class="bth-pill accent">Five</span>
        <h3 class="bth-h3">Never pay the last chunk before you've snagged it</h3>
        <p class="bth-small bth-muted">
          Hold 5% back for a fortnight. It is the single most effective bit of project management
          available to you and it costs nothing.
        </p>
      </div>
      <div class="bth-card accent">
        <span class="bth-pill">And a bonus</span>
        <h3 class="bth-h3">Photograph the walls before they're boarded</h3>
        <p class="bth-small bth-muted">
          Every pipe, every cable, tape measure in shot. In five years when you want to hang a
          heated mirror, those photos are worth more than the warranty.
        </p>
      </div>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Before anything else</span>
      <h2 class="bth-h2">What you're actually deciding</h2>
      <hr class="bth-rule" />
    </div>
    <p class="bth-body" style="max-width:68ch">
      Six decisions. Settle these and everything downstream gets easier — a fitter can quote
      properly, a showroom can design properly, and you stop going round in circles at nine o'clock
      on a Tuesday.
    </p>
    <div class="bth-tablewrap">
      <table>
        <thead>
          <tr><th>Decision</th><th>The real question</th><th>What it changes</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Bath or no bath?</strong></td>
            <td>Does anyone actually lie in a bath, and is there another bath in the house?</td>
            <td>
              The whole layout. Losing the bath in a small room is transformative. Losing the only
              bath in a three-bed terrace can knock a bit off resale — family buyers look for one.
            </td>
          </tr>
          <tr>
            <td><strong>Same layout or move things?</strong></td>
            <td>Is the current arrangement annoying, or just tired?</td>
            <td>
              £500–£1,500 and two extra days. Like-for-like also keeps you out of building control
              on the drainage side.
            </td>
          </tr>
          <tr>
            <td><strong>Who runs it?</strong></td>
            <td>Do you want one number to ring, or are you happy chasing five trades?</td>
            <td>
              10–30% of the total, and roughly ten hours a week of your life. See
              <a href="{B}/trades">Who does what</a>.
            </td>
          </tr>
          <tr>
            <td><strong>What's the number?</strong></td>
            <td>Not "what could we spend" — what's the number above which you'd wince?</td>
            <td>
              Everything. Tell the fitter the number. A good one designs to it; a bad one is a bad
              one either way.
            </td>
          </tr>
          <tr>
            <td><strong>When?</strong></td>
            <td>Any dates you genuinely can't be without a bathroom — visitors, Christmas, work?</td>
            <td>
              Decent fitters are booked 6–12 weeks out. Tiles and furniture add 2–6 weeks on top.
              Work backwards from a date you'd like it finished.
            </td>
          </tr>
          <tr>
            <td><strong>How do you wash meanwhile?</strong></td>
            <td>Nine days, one bathroom. What's the plan?</td>
            <td>
              Nothing structural — but it's the thing that decides whether the job feels fine or
              feels endless. There's a plan for it in <a href="{B}/programme">Order of play</a>.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Do this first · 10 minutes, one tape</span>
      <h2 class="bth-h2">Measure it properly</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <div class="bth-stack g16">
        <p class="bth-body">
          The planner needs real numbers, and so does every quote you'll get. Take these in
          millimetres — everyone in the trade works in mm, and it stops the decimal-point mistakes
          that turn 1.7 m into 17 cm.
        </p>
        <ul class="bth-ticks">
          <li>
            <strong>Wall to wall, twice.</strong> Measure each direction at floor level and again at
            about waist height. Old terraces bow. Use the smaller number.
          </li>
          <li>
            <strong>Floor to ceiling.</strong> Matters for tall units, shower screens and whether a
            ceiling extractor is even possible.
          </li>
          <li>
            <strong>The door.</strong> Width of the opening, which side the hinges are on, and which
            way it swings. A door that opens inward eats about a square metre.
          </li>
          <li>
            <strong>The window.</strong> Width, height, and how far the sill is off the floor. If
            the bath sits under it, sill height decides whether a shower screen will fit.
          </li>
          <li>
            <strong>The soil stack.</strong> Find the fat pipe (usually 110 mm) the toilet joins.
            Measure from the nearest corner. This is the single most useful number for a fitter.
          </li>
          <li>
            <strong>Anything sticking out.</strong> Chimney breast, boxed pipework, a stair
            bulkhead, the airing cupboard. Width and how far it projects.
          </li>
          <li>
            <strong>Radiator position</strong> and pipe entry points, plus where the light switch,
            pull cord and any sockets are.
          </li>
        </ul>
        <div class="bth-note">
          <span class="bth-eyebrow">While you're in there</span>
          <p class="bth-small">
            Take fifteen photos. Each wall square-on, the ceiling, the floor with the bath panel off
            if it comes off, under the basin, and the outside wall from the garden showing where the
            stack and any vents come out. Every quote will go faster and you'll get more accurate
            numbers over email.
          </p>
        </div>
      </div>
      <div class="bth-stack g16">
        <div class="bth-card">
          <h3 class="bth-h3">What the planner assumes until you change it</h3>
          <p class="bth-small bth-muted">
            The starting numbers are a typical Victorian or Edwardian terrace bathroom — the room
            over the back addition, or one carved out of the rear bedroom:
          </p>
          <div class="bth-tiles">
            <div><div class="k">Width</div><div class="v">2100</div><div class="s">mm</div></div>
            <div><div class="k">Depth</div><div class="v">2400</div><div class="s">mm</div></div>
            <div><div class="k">Floor area</div><div class="v">5.0</div><div class="s">m²</div></div>
          </div>
          <p class="bth-small bth-muted">
            Change them in about four seconds. Everything — layout warnings, tiling area, the cost
            model, the brief — recalculates off your numbers.
          </p>
          <div class="bth-row">
            <a class="bth-btn primary" href="{B}/planner">Open the planner →</a>
          </div>
        </div>
        <div class="bth-card">
          <h3 class="bth-h3">Terrace things to look out for</h3>
          <dl class="bth-defs">
            <dt>Solid walls, no cavity</dt>
            <dd>
              External walls will be cold and prone to condensation. Insulated backer board behind
              the tiles is the cheap fix, and it's worth doing.
            </dd>
            <dt>The floor</dt>
            <dd>
              Original boards flex, and flexing floors crack tiles. A ply or backer-board overlay is
              not optional if you're tiling the floor.
            </dd>
            <dt>Lath and plaster ceiling</dt>
            <dd>
              Sometimes survives a refit, sometimes comes down in a cloud. Ask the fitter to price a
              plasterboard overboard as an option, not a surprise.
            </dd>
            <dt>Artex</dt>
            <dd>
              If the ceiling's textured and the house hasn't been redecorated since the 90s, get it
              tested before anyone sands it. A sample test is about £60–£150.
            </dd>
          </dl>
        </div>
      </div>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Rough order of magnitude</span>
      <h2 class="bth-h2">What it'll cost</h2>
      <hr class="bth-rule" />
    </div>
    <p class="bth-body" style="max-width:68ch">
      Darlington quotes for a full supply-and-fit bathroom cluster around
      <strong>£4,400–£11,700</strong>, with the middle of the pack near <strong>£6,800</strong>.
      Prices run higher the further south you go. Here's what those numbers buy in a 5 m² room. The
      <a href="{B}/money">Money page</a> builds it up line by line.
    </p>
    <div class="bth-grid three">
      <div class="bth-card">
        <div class="bth-row" style="justify-content:space-between">
          <h3 class="bth-h3">Tidy and honest</h3>
          <span class="bth-pill">£4.5k–£6k</span>
        </div>
        <p class="bth-small bth-muted">
          Same layout, white suite from a decent mid-range brand, shower over the bath, tiles to
          half height with paint above, vinyl or LVT floor, new fan, new towel rail. Nothing to
          apologise for and nothing flashy.
        </p>
        <p class="bth-small bth-muted"><strong>6–8 days</strong> · fitter + electrician</p>
      </div>
      <div class="bth-card accent">
        <div class="bth-row" style="justify-content:space-between">
          <h3 class="bth-h3">The sensible middle</h3>
          <span class="bth-pill accent">£6.5k–£9.5k</span>
        </div>
        <p class="bth-small bth-muted">
          Layout tweaked, proper thermostatic shower, quality porcelain floor-to-ceiling on the wet
          walls, vanity unit with storage, electric underfloor heating, better lighting. This is
          where most people land and where most of the value is.
        </p>
        <p class="bth-small bth-muted"><strong>8–12 days</strong> · four trades</p>
      </div>
      <div class="bth-card">
        <div class="bth-row" style="justify-content:space-between">
          <h3 class="bth-h3">Doing it once</h3>
          <span class="bth-pill">£10k–£16k</span>
        </div>
        <p class="bth-small bth-muted">
          Moved services, wet-room floor or frameless glass, fitted furniture, brassware you can
          feel the weight of, feature tiling, the lot. In a 5 m² terrace bathroom you hit
          diminishing returns above about £14k.
        </p>
        <p class="bth-small bth-muted"><strong>12–20 days</strong> · five or six trades</p>
      </div>
    </div>
    <div class="bth-grid two">
      <div class="bth-note warn">
        <span class="bth-eyebrow">What pushes it up</span>
        <ul class="bth-ticks">
          <li>Moving the WC more than a metre and a half from the stack</li>
          <li>Floor-to-ceiling tiling on all four walls instead of the wet walls only</li>
          <li>Large-format or patterned tiles — slower to lay, more cuts, more waste</li>
          <li>A wet-room floor former and full tanking instead of a tray</li>
          <li>Discovering the boiler can't run a decent shower</li>
        </ul>
      </div>
      <div class="bth-note good">
        <span class="bth-eyebrow">What quietly saves you money</span>
        <ul class="bth-ticks">
          <li>Keeping the toilet and basin where they are, even if the bath moves</li>
          <li>Half-height tiling on the dry walls with good moisture-resistant paint above</li>
          <li>Plain large tiles laid straight rather than a pattern that needs setting out</li>
          <li>Buying the suite yourself in a sale while the fitter supplies the boring stuff</li>
          <li>Being flexible on start date — good fitters discount gap weeks</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">This week</span>
      <h2 class="bth-h2">Three moves, then stop</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid three">
      <div class="bth-card">
        <span class="bth-eyebrow">Move one</span>
        <h3 class="bth-h3">Measure and photograph</h3>
        <p class="bth-small bth-muted">
          Twenty minutes with a tape and a phone. Then put the numbers into the planner and drag
          things around for half an hour. You'll learn more about what will and won't fit than any
          showroom visit.
        </p>
      </div>
      <div class="bth-card">
        <span class="bth-eyebrow">Move two</span>
        <h3 class="bth-h3">Agree the number and the bath question</h3>
        <p class="bth-small bth-muted">
          Two conversations, both short. Write the answers down. Everything else is detail, and
          detail is much easier once these are settled.
        </p>
      </div>
      <div class="bth-card">
        <span class="bth-eyebrow">Move three</span>
        <h3 class="bth-h3">Line up three quotes</h3>
        <p class="bth-small bth-muted">
          Not one, not five. Three, all pricing the same written brief — the
          <a href="{B}/brief">brief page</a> writes one for you. Mixed sources work best: one
          showroom, one recommended local fitter, one from a vetted directory.
        </p>
      </div>
    </div>
    <div class="bth-note">
      <span class="bth-eyebrow">Deliberately not this week</span>
      <p class="bth-small">
        Choosing tiles. It's the fun bit and it's the bit that changes six times. Pick tiles once
        the layout is fixed and you know how many square metres you're buying — otherwise you'll
        order the wrong quantity of something you've gone off.
      </p>
    </div>
  </section>
</div>
