<script lang="ts">
  const DIRECTIONS = [
    {
      n: '01',
      t: 'Plain and properly done',
      price: '£4.5k–£6.5k',
      body: 'White suite, chrome, big plain porcelain tiles floor-to-ceiling on the bath wall and half-height elsewhere, matt paint above, LVT or large-format floor tile. No pattern, no feature wall, nothing to date. The money goes into the shower valve, the floor build-up and the fitting.',
      needs: 'Nothing special. Works in any layout.',
      catch: "It's quiet. If you want the room to be a thing, this isn't it.",
      suits: 'Doing it once, doing it right, spending the rest on the kitchen.',
    },
    {
      n: '02',
      t: 'Shower first, bath gone',
      price: '£6.5k–£10k',
      body: 'Lose the bath, put in a 1400–1600 mm walk-in with a single glass panel, and suddenly a 5 m² room feels like 7. Space for a proper double vanity, a tall cupboard, somewhere to put a towel down. The showering experience is night and day.',
      needs: 'A wet-room former or a low-profile tray, and decent water pressure — check the boiler first.',
      catch: 'No bath in a three-bed family terrace. Some buyers care; if there is a second bathroom or you are staying put, they do not.',
      suits: 'Two adults who shower and never bathe.',
    },
    {
      n: '03',
      t: 'Bath under the window',
      price: '£4.5k–£7k',
      body: 'The layout the house was built for: bath along the window wall, shower over it behind a hinged screen, basin and WC on the opposite run. Cheapest to fit because nothing moves, and it leaves the middle of the floor clear, which is what makes a small room feel usable.',
      needs: 'A sill high enough to clear a screen — measure before you commit. A 1700 bath needs 1700 of clear wall.',
      catch: 'Showering under a window means a cold draught and a wet sill. Worth a secondary-glazed or obscured unit, and a decent extractor.',
      suits: 'Keeping the bath, keeping the budget, keeping the peace.',
    },
    {
      n: '04',
      t: 'Period-sympathetic',
      price: '£8k–£13k',
      body: 'Tongue-and-groove or moulded panelling to dado height painted a proper colour, a patterned encaustic-look porcelain floor, brushed brass or nickel brassware, a high-level or traditional close-coupled WC, and a big mirror in a frame. It reads as though the house always had it.',
      needs: 'Careful setting-out. Panelling in a wet room must be moisture-resistant MDF and properly sealed, and it cannot go behind a shower.',
      catch: 'Brassware finishes vary hugely in quality. Cheap brushed brass goes patchy in a year in a steamy room.',
      suits: 'A house with plaster roses and arches you would like to keep in character.',
    },
    {
      n: '05',
      t: 'Small and clever',
      price: '£7k–£11k',
      body: 'Everything wall-hung — WC on a concealed frame, basin on a floating vanity — so you can see floor under all of it. A single run of fitted furniture along one wall hides the cistern, the pipework and about six months of shampoo. Big mirror, recessed niche in the shower instead of a hanging caddy.',
      needs: 'A 200 mm-deep frame behind the WC, and a wall that can take it. Adds about 200 mm to that run.',
      catch: 'Concealed cisterns are brilliant until something leaks. Buy a brand your fitter can get parts for — Geberit, Grohe, Roca.',
      suits: 'A genuinely tight room where storage is the problem.',
    },
    {
      n: '06',
      t: 'The warm one',
      price: '+£1.2k–£2.5k on any of the above',
      body: 'Not a look — an upgrade you bolt onto whichever direction you pick. Electric underfloor heating mat under the tiles, insulated backer board on the two external walls, a big vertical towel rail on a timer, and a humidity-sensing extractor that runs on properly. In a solid-walled terrace this is the single biggest quality-of-life change.',
      needs: 'Underfloor heating wants its own fused spur and a thermostat outside the bathroom zones — the electrician will sort it.',
      catch: 'Underfloor heating is a heater, not a heating system. You still want the towel rail for actual warmth.',
      suits: 'Anyone who has ever stood on a cold terrace bathroom floor in January.',
    },
  ];
</script>

<svelte:head>
  <title>Ideas — Bathroom Planner</title>
</svelte:head>

<div class="bth-wrap bth-stack g40">
  <header class="bth-stack g12">
    <span class="bth-eyebrow">02 · Ideas</span>
    <h1 class="bth-h1">Six directions that work in a terrace bathroom</h1>
    <p class="bth-lead">
      A small period bathroom has a personality whether you like it or not: solid cold walls, a
      bouncy floor, a soil stack on the back wall, and about five square metres to play with. These
      six directions all take that seriously. Costs are the full job, fitted, at North East rates.
    </p>
  </header>

  <div class="bth-grid two">
    {#each DIRECTIONS as d (d.n)}
      <article class="bth-card">
        <div class="bth-row" style="justify-content:space-between; align-items:flex-start">
          <div class="bth-stack g8">
            <span class="bth-eyebrow" style="color:var(--accent)">Direction {d.n}</span>
            <h2 class="bth-h3">{d.t}</h2>
          </div>
          <span class="bth-pill">{d.price}</span>
        </div>
        <p class="bth-small">{d.body}</p>
        <dl class="bth-defs">
          <dt>Needs</dt>
          <dd>{d.needs}</dd>
          <dt>The catch</dt>
          <dd>{d.catch}</dd>
          <dt>Suits</dt>
          <dd>{d.suits}</dd>
        </dl>
      </article>
    {/each}
  </div>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Cheap tricks that genuinely work</span>
      <h2 class="bth-h2">Making five square metres feel like seven</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <ul class="bth-ticks">
        <li><strong>Keep the floor visible.</strong> Wall-hung WC and basin do more for the sense of space than any paint colour.</li>
        <li><strong>Run the same floor tile up to the walls</strong> with no threshold or border. Breaks in the floor make a room read smaller.</li>
        <li><strong>Fewer, bigger tiles.</strong> Fewer grout lines, less visual noise. 600×300 or larger on walls; 600×600 on floors if the room will take the cuts.</li>
        <li><strong>One big mirror, not a cabinet.</strong> Or a mirrored cabinet that's flush and the full width of the vanity.</li>
      </ul>
      <ul class="bth-ticks">
        <li><strong>Recessed niche in the shower wall.</strong> About £150 extra at first fix, and it removes every bottle from every surface.</li>
        <li><strong>Sliding or outward-opening door</strong> if the swing is eating your floor. Check the landing first.</li>
        <li><strong>A single continuous run</strong> of vanity plus WC unit along one wall reads as one object rather than three.</li>
        <li><strong>Light it properly.</strong> Three or four IP-rated downlights on a dimmer plus a mirror light beats one sad ceiling pendant, and costs about £250 more.</li>
      </ul>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Where to spend, where not to</span>
      <h2 class="bth-h2">Worth it / not worth it</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <div class="bth-card">
        <h3 class="bth-h3" style="color:var(--success)">Worth the money</h3>
        <ul class="bth-ticks">
          <li><strong>The shower valve.</strong> A good thermostatic valve is the difference between a shower you enjoy and one you tolerate. £250–£400 well spent.</li>
          <li><strong>The floor build-up.</strong> Ply or backer board, properly screwed. Invisible, and the reason your tiles don't crack in year two.</li>
          <li><strong>Backer board on external walls.</strong> Insulated tile backer costs a couple of hundred quid and stops the cold-wall condensation that eventually blackens the grout.</li>
          <li><strong>A proper extractor.</strong> Humidity-sensing, ducted outside, 15 l/s or better. Every mould problem in a British bathroom starts with a bad fan.</li>
          <li><strong>Tiling labour.</strong> Cheap tiling is visible from the door for the next fifteen years.</li>
          <li><strong>Silicone.</strong> Sounds daft. A good anti-mould sanitary silicone, cut and tooled well, is what makes the job look finished.</li>
        </ul>
      </div>
      <div class="bth-card">
        <h3 class="bth-h3" style="color:var(--error)">Not worth the money</h3>
        <ul class="bth-ticks">
          <li><strong>An expensive bath.</strong> Above about £400 you're paying for a brand. A good reinforced acrylic bath with proper feet and a solid front panel is fine.</li>
          <li><strong>Whirlpool jets.</strong> Used twice, cleaned never, breaks eventually.</li>
          <li><strong>Natural stone in a family bathroom.</strong> Beautiful, porous, needs sealing, marks with everything. Porcelain that looks like stone is better in every practical way.</li>
          <li><strong>Very cheap brassware.</strong> The one place where the bottom of the market genuinely fails — cartridges go, chrome pits. Mid-market is fine; bargain-basement isn't.</li>
          <li><strong>A designer radiator that doesn't heat the room.</strong> Check the output in watts against the room, not just the looks.</li>
          <li><strong>Tiling behind the fitted furniture.</strong> You'll never see it. Tell the tiler.</li>
        </ul>
      </div>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Straight answers</span>
      <h2 class="bth-h2">The material decisions, briefly</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-tablewrap">
      <table>
        <thead><tr><th>Decision</th><th>Options</th><th>The plain answer</th></tr></thead>
        <tbody>
          <tr><td><strong>Walls</strong></td><td>Tile / PVC panels / paint</td><td>Tile the wet zones. Panels are cheaper and faster and look like panels. Good moisture-resistant paint above dado height is completely fine and easy to change later.</td></tr>
          <tr><td><strong>Floor</strong></td><td>Porcelain tile / LVT / vinyl sheet</td><td>Porcelain if you're having underfloor heating — it conducts. LVT is warmer underfoot, quieter, forgiving of a slightly imperfect floor and half the price fitted.</td></tr>
          <tr><td><strong>Shower</strong></td><td>Tray / wet-room former</td><td>A low-profile tray is cheaper, faster and easier to get right. A former with full tanking looks better and is a genuine leak risk if it's badly done. Only worth it with a fitter who does them often.</td></tr>
          <tr><td><strong>Heat</strong></td><td>Towel rail / radiator / underfloor</td><td>Towel rail plus electric underfloor is the terrace answer. Size the rail properly — a slim ladder rail often can't heat the room on its own in a solid-walled house.</td></tr>
          <tr><td><strong>Ventilation</strong></td><td>Basic fan / timer / humidity-sensing</td><td>Humidity-sensing, ducted to outside in rigid pipe with the shortest run possible. Regulations want 15 l/s minimum; buy more.</td></tr>
          <tr><td><strong>Lighting</strong></td><td>Pendant / downlights / layered</td><td>IP-rated downlights on a dimmer, plus something at the mirror. One bright ceiling light in a small tiled room is unflattering and hard to shave by.</td></tr>
          <tr><td><strong>Storage</strong></td><td>Freestanding / fitted / niche</td><td>Fitted costs more and pays for itself in a small room by hiding the cistern and the pipework as well as the stuff.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="bth-note">
      <span class="bth-eyebrow">One thing to check before you fall in love with a shower</span>
      <p class="bth-small">
        Find out what heats your water. A combi boiler gives you mains-pressure hot water and is
        generally fine with a decent mixer, but a big rain head can outrun a small combi. A vented
        cylinder with a tank in the loft gives you gravity pressure and probably needs a pump. An
        unvented cylinder is the best of both. Ask a plumber to tell you which you've got and what
        shower it will actually support — before you buy the shower, not after.
      </p>
    </div>
  </section>
</div>
