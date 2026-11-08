<svelte:options css="injected" />

<script lang="ts">
  // The end of the walk: a wayfinding totem on the pavement, its blade signs
  // pointing on to the rest of the site (schedules, the assistant, the
  // family), each a real link with its live line under the name.
  import { starfield } from '$lib/landing/place';
  import type { Arm } from '$lib/landing/showcase-place-words';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let { arms }: { arms: Arm[] } = $props();
  // A few stars over the street after dark, the same scatter every load.
  const stars = starfield(44);
</script>

<section class="fp" aria-labelledby="sp-rest-h">
  <svg class="fp-sky" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    {#each stars as [x, y, r], i (i)}<circle cx={x} cy={y} {r} />{/each}
  </svg>
  <div class="fp-in">
    <div class="fp-head" use:scenery>
      <p class="fp-k">Further on</p>
      <h2 id="sp-rest-h">And the rest</h2>
    </div>
    <div class="fp-sign">
      <!-- The totem itself, standing on the pavement: a slim pylon with a you-are-here mark at its head. -->
      <span class="fp-post" aria-hidden="true">
        <span class="fp-here"></span>
      </span>
      <ul class="fp-arms">
        {#each arms as a, i (a.id)}
          <li data-way={i % 2 ? 'l' : 'r'}>
            <a class="fp-arm" href={a.href}>
              <span class="fp-name">{a.name}</span>
              <span class="fp-st">{a.status}</span>
              <svg class="fp-go" viewBox="0 0 16 12" aria-hidden="true" focusable="false"><path d="M1,6 H14 M9,1 L14,6 L9,11" /></svg>
            </a>
          </li>
        {/each}
      </ul>
    </div>
    <!-- The pavement under the totem: the rambler's floor. -->
    <span class="fp-ground" aria-hidden="true" use:scenery={{ at: 0.3 }}></span>
  </div>
</section>

<style>
  .fp {
    --verge: clamp(40px, 5vw, 64px);
    position: relative;
    overflow: clip;
    padding: clamp(84px, 9vw, 128px) 0 var(--verge);
    color: #ede4d4;
  }
  .fp-sky {
    position: absolute;
    inset: 0 0 auto 0;
    width: 100%;
    /* Over the heading, never among the words. */
    height: clamp(64px, 7.5vw, 108px);
    fill: #efe6d6;
    opacity: calc(0.5 * var(--stars, 1));
    pointer-events: none;
  }
  .fp-in {
    position: relative;
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut, clamp(16px, 4vw, 64px));
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    align-items: start;
    gap: 24px 48px;
  }
  .fp-k {
    margin: 0 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-ink-on-dark);
  }
  .fp-head {
    padding-top: 16px;
  }
  h2 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(30px, 3vw, 44px);
    line-height: 1.02;
    letter-spacing: -0.025em;
  }
  .fp-sign {
    position: relative;
    display: flex;
    justify-content: center;
  }
  /* The totem: a slim pylon from a little above the first blade down to the
     pavement, square-cut, with an orange you-are-here mark at its head. */
  .fp-post {
    position: absolute;
    left: 50%;
    top: -44px;
    bottom: 0;
    width: 14px;
    margin-left: -7px;
    box-sizing: border-box;
    background: var(--city-body, #0c1018);
    border: 1px solid rgba(237, 228, 212, 0.36);
    border-bottom: 0;
  }
  .fp-here {
    position: absolute;
    left: 2px;
    right: 2px;
    top: 6px;
    aspect-ratio: 1;
    border-radius: 100px;
    background: var(--accent-on-dark);
  }
  .fp-arms {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    margin: 0;
    padding: 0 0 40px;
    list-style: none;
  }
  .fp-arms li {
    display: flex;
  }
  /* A blade points away from the totem: right-hand blades start at it and
     carry their arrow at the far end; left-hand ones the other way about. */
  .fp-arms li[data-way='r'] {
    justify-content: flex-start;
    padding-left: calc(50% + 7px);
  }
  .fp-arms li[data-way='l'] {
    justify-content: flex-end;
    padding-right: calc(50% + 7px);
  }
  .fp-arm {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-height: 56px;
    width: min(100%, 300px);
    padding: 8px 44px 8px 18px;
    box-sizing: border-box;
    color: #ede4d4;
    text-decoration: none;
    background: var(--city-body, #0c1018);
    border: 1px solid rgba(237, 228, 212, 0.34);
    border-left: 3px solid var(--accent-on-dark);
  }
  .fp-arms li[data-way='l'] .fp-arm {
    padding: 8px 18px 8px 44px;
    text-align: right;
    border-left: 1px solid rgba(237, 228, 212, 0.34);
    border-right: 3px solid var(--accent-on-dark);
  }
  .fp-arm:hover {
    background: var(--city-deck, #15171b);
  }
  .fp-arm:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  .fp-go {
    position: absolute;
    top: 50%;
    right: 14px;
    width: 16px;
    height: 12px;
    margin-top: -6px;
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 1.6;
  }
  .fp-arms li[data-way='l'] .fp-go {
    right: auto;
    left: 14px;
    transform: scaleX(-1);
  }
  .fp-name {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .fp-st {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    line-height: 1.4;
    color: var(--accent-on-dark);
  }
  .fp-arm:hover .fp-name {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  /* The pavement, full bleed under the totem, its kerb down to the footer. */
  .fp-ground {
    position: absolute;
    left: 50%;
    top: 100%;
    width: 100vw;
    height: var(--verge);
    margin-left: -50vw;
    background: var(--city-ground, #0c0d10);
    border-top: 1px solid rgba(237, 228, 212, 0.22);
  }

  @media (max-width: 899px) {
    .fp-in {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  /* A phone: the totem stands at the left and every blade points on. It
     starts under the heading, a little above the first blade, never among
     the heading's words. */
  @media (max-width: 559px) {
    .fp-post {
      left: 16px;
      top: -14px;
    }
    .fp-arms li[data-way] {
      justify-content: flex-start;
      padding: 0 0 0 30px;
    }
    .fp-arms li[data-way='l'] .fp-arm {
      padding: 8px 44px 8px 18px;
      text-align: left;
      border-right: 1px solid rgba(237, 228, 212, 0.34);
      border-left: 3px solid var(--accent-on-dark);
    }
    .fp-arms li[data-way='l'] .fp-go {
      left: auto;
      right: 14px;
      transform: none;
    }
  }
  @media print {
    .fp {
      padding: 16px 0;
      color: #1a1008;
    }
    .fp-post,
    .fp-sky,
    .fp-ground,
    .fp-go {
      display: none;
    }
    .fp-arm {
      background: none;
      border: 0;
    }
    .fp-arm,
    .fp-st,
    .fp-k {
      color: #1a1008;
    }
    .fp-in {
      display: block;
    }
    .fp-arms {
      padding: 8px 0 0;
    }
    .fp-arms li[data-way],
    .fp-arms li[data-way] .fp-arm {
      justify-content: flex-start;
      padding: 0;
      min-height: 0;
      text-align: left;
      border: 0;
      background: none;
    }
  }
</style>
