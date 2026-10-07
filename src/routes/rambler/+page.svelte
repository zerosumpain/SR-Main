<script lang="ts">
  // How the landing page's pixel character works, for anyone who clicked him.
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import CombinationTable from '$lib/components/rambler/CombinationTable.svelte';
  import RamblerGallery from '$lib/components/rambler/RamblerGallery.svelte';
  import RamblerNow from '$lib/components/rambler/RamblerNow.svelte';
  import RamblerPlayground from '$lib/components/rambler/RamblerPlayground.svelte';
  import RamblerSim from '$lib/components/rambler/RamblerSim.svelte';
  import { loadRamblerPreference, rambler, toggleRambler } from '$lib/landing/ramblers/visibility.svelte';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  onMount(loadRamblerPreference);
</script>

<svelte:head>
  <title>How the rambler works — Strange Ramblings</title>
  <meta name="description" content="The little man on the home page: what he does, why he does it, and what he knows about my day." />
</svelte:head>

<PageHeader title="The rambler" />

<main class="rambler-page">
  <p class="kicker">strange ramblings · the home page's resident</p>
  <h1>How the rambler works</h1>
  <p class="lede">
    The little man wandering about the home page isn't picking things at random. He has a body clock, a few needs that build up
    and wear off, and a loose connection to my actual day, so when he puts the kettle on at eleven or falls asleep on the sofa
    after a bad night, there's a reason behind it. This page shows how that works, and what he does and doesn't know.
  </p>

  <section>
    <h2>Everything he does</h2>
    <p>
      He's drawn fresh every frame from a little skeleton, so his feet stay planted when he walks and his hands actually reach
      the ledges he climbs. He turns side on to get about and faces you when his face is the point, which is most of the
      interesting bits.
    </p>
    <RamblerGallery />
  </section>

  <section>
    <h2>What he's up to right now</h2>
    <RamblerNow day={data.day} />
  </section>

  <section>
    <h2>How he decides</h2>
    <p>
      He has eight drives, each one rising and falling on a timescale borrowed from how people actually work. Sleep pressure
      builds the longer he's been up, offset by a body clock that sags after lunch and perks up in the early evening (the
      two-process model sleep researchers have used since the eighties). Sitting about makes him restless, reading wears his
      brain out and pottering in the garden puts it back, a pulse that's up with no exercise behind it winds him up, and
      there's a meal clock with a cup of tea at eleven and half three, because of course there is.
    </p>
    <p>
      Every activity eases some of those needs and costs some energy. He picks in proportion to how much each would help rather
      than always taking the best, which is how animals spread their time too, then sticks with it until the need is mostly
      met, and goes off things he's just done for a while. When two needs are neck and neck he dithers and scratches his head.
    </p>
    <RamblerSim />
  </section>

  <section>
    <h2>How my day adds up</h2>
    <p>
      No single reading says much on its own, so he reads them together. The useful trick is a pulse that's higher than my
      movement explains, which researchers have used as a sign of mental strain since the seventies, because a racing heart
      while I'm walking up a hill is just a hill, and the same heart rate while I'm sat at a desk at three in the afternoon
      usually means something has gone sideways at work. He looks at how much I've moved in the last 45 minutes, my pulse,
      and the time of day, and if the phone hasn't synced lately he assumes nothing rather than guessing.
    </p>
    <CombinationTable />
    <p>
      These lean his needs rather than taking over, so a stressful afternoon makes stress episodes, tea and a sit-down
      breather much likelier without stopping him doing anything else. He only ever boils over once a visit, whatever set it off.
    </p>
  </section>

  <section>
    <h2>How he gets about</h2>
    <p>
      He treats parts of the home page as floors. Small gaps he jumps, the side of a box he climbs like a climbing wall, and
      anywhere else he fires a grappling hook and goes up the rope, reeling it in after him so nothing's left on the page. If
      you scroll away he comes looking for you. Here he is on a little model page.
    </p>
    <RamblerPlayground />
  </section>

  <section>
    <h2>What he knows about my day, and what he doesn't</h2>
    <ul>
      <li>The time and weather where I am, and my pulse when the reading is fresh.</li>
      <li>
        Rough bands about today, never the numbers behind them, such as whether I've exercised, whether I've been on my feet a
        lot or a little, whether I slept well and how recovered I am.
      </li>
      <li>
        Whether I've been sat still, pottering or properly moving in the last 45 minutes, again as a band, which together with my
        pulse is how he guesses I'm having a stressful afternoon. It's a guess, and he's wrong about as often as you'd expect.
      </li>
      <li>
        Nothing about where anyone is. He goes to bed by the clock rather than when I do, because a site that shows the house
        asleep is telling strangers it's empty.
      </li>
      <li>He loses his temper at most once a visit, only ever at a hook or a cloud or a car, and he never actually swears.</li>
    </ul>
    <p>
      <button type="button" class="tuck" onclick={toggleRambler}>{rambler.hidden ? 'Bring back the rambler' : 'Tuck in the rambler'}</button>
      <span class="hint">if you'd rather read the home page without him.</span>
    </p>
  </section>

  <section class="sources">
    <h2>Where the ideas come from</h2>
    <ol>
      <li>Borbély, A. A. (1982). A two process model of sleep regulation. <i>Human Neurobiology</i>, 1, 195–204.</li>
      <li>Monk, T. H. (2005). The post-lunch dip in performance. <i>Clinics in Sports Medicine</i>, 24(2).</li>
      <li>Rosekind, M. R. et al. (1995). Alertness management: strategic naps in operational settings. <i>Journal of Sleep Research</i>, 4(S2).</li>
      <li>Kaplan, S. (1995). The restorative benefits of nature. <i>Journal of Environmental Psychology</i>, 15, 169–182.</li>
      <li>Dunstan, D. W. et al. (2012). Breaking up prolonged sitting reduces postprandial glucose and insulin responses. <i>Diabetes Care</i>, 35, 976–983.</li>
      <li>Herrnstein, R. J. (1961). Relative and absolute strength of response as a function of frequency of reinforcement. <i>Journal of the Experimental Analysis of Behavior</i>, 4, 267–272.</li>
      <li>McFarland, D. J. &amp; Sibly, R. M. (1975). The behavioural final common path. <i>Philosophical Transactions of the Royal Society B</i>, 270, 265–293.</li>
      <li>Tinbergen, N. (1952). "Derived" activities. <i>Quarterly Review of Biology</i>, 27, 1–32.</li>
      <li>Dollard, J. et al. (1939). <i>Frustration and Aggression</i>. Berkowitz, L. (1989), <i>Psychological Bulletin</i>, 106, 59–73.</li>
      <li>Blix, A. S., Strømme, S. B. &amp; Ursin, H. (1974). Additional heart rate, an indicator of psychological activation. <i>Aerospace Medicine</i>, 45, 1219–1222.</li>
      <li>Myrtek, M. (2004). <i>Heart and Emotion: Ambulatory Monitoring Studies in Everyday Life</i>. Hogrefe &amp; Huber.</li>
      <li>Walker, M. (1980). <i>The Lexicon of Comicana</i>, for grawlix and emanata.</li>
      <li>Thomas, F. &amp; Johnston, O. (1981). <i>The Illusion of Life</i>. Williams, R. (2001). <i>The Animator's Survival Kit</i>.</li>
    </ol>
  </section>
</main>

<SiteFooter />

<style>
  .rambler-page {
    max-width: 68rem;
    margin: 0 auto;
    padding: 2.5rem 1rem 4rem;
    color: var(--text-primary);
  }
  @media (min-width: 640px) {
    .rambler-page {
      padding: 3.5rem 2.5rem 5rem;
    }
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
    margin: 0 0 0.75rem;
  }
  h1 {
    font-family: var(--font-display);
    font-size: clamp(2.25rem, 7vw, 3.5rem);
    line-height: 1;
    margin: 0 0 1.5rem;
    padding-bottom: 1.25rem;
    border-bottom: 2px solid var(--line-strong);
    text-wrap: balance;
  }
  .lede,
  section > p,
  section > ul {
    font-family: var(--font-body);
    font-size: 1.0625rem;
    line-height: 1.65;
    color: var(--text-secondary);
    max-width: 44rem;
  }
  section {
    display: grid;
    gap: 1rem;
    margin-top: 3rem;
  }
  h2 {
    font-family: var(--font-mono);
    font-size: var(--fs-label-sm, 0.8rem);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-primary);
    margin: 0;
    padding-top: 1rem;
    border-top: 1px solid var(--line-hair);
  }
  section > p,
  section > ul {
    margin: 0;
  }
  ul {
    padding-left: 1.25rem;
    list-style: square;
    display: grid;
    gap: 0.4rem;
  }
  .tuck {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--accent);
    border-radius: 2px;
    background: var(--bg);
    color: var(--accent);
    cursor: pointer;
  }
  .hint {
    color: var(--text-muted);
    margin-left: 0.4rem;
  }
  .sources ol {
    margin: 0;
    padding-left: 1.4rem;
    display: grid;
    gap: 0.35rem;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 52rem;
  }
</style>
