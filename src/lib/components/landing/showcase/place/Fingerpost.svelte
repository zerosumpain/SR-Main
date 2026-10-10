<svelte:options css="injected" />

<script lang="ts">
  // The end of the walk: a fingerpost at the foot of the hill, its arms
  // pointing on to the rest of the site (schedules, the assistant, the
  // family), each a real link with its live line under the name.
  import { starfield } from '$lib/landing/place';
  import type { Arm } from '$lib/landing/showcase-place';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let { arms }: { arms: Arm[] } = $props();
  // A few stars over the foot of the hill, the same scatter every load.
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
      <!-- The post itself, standing in the ground, and its cap. -->
      <span class="fp-post" aria-hidden="true">
        <svg class="fp-cap" viewBox="0 0 16 10" aria-hidden="true" focusable="false"><path d="M1,9.5 L8,1 L15,9.5 Z" /></svg>
      </span>
      <ul class="fp-arms">
        {#each arms as a, i (a.id)}
          <li data-way={i % 2 ? 'l' : 'r'}>
            <a class="fp-arm" href={a.href}>
              <span class="fp-name">{a.name}</span>
              <span class="fp-st">{a.status}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
    <!-- The ground at the foot of the hill: the rambler's floor. -->
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
    opacity: 0.5;
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
  /* The post: a plain board from just above the first arm into the ground,
     with an unstretched cap on top. */
  .fp-post {
    position: absolute;
    left: 50%;
    top: -12px;
    bottom: 0;
    width: 8px;
    margin-left: -4px;
    box-sizing: border-box;
    background: #2c2119;
    border: 1px solid rgba(237, 228, 212, 0.4);
    border-bottom: 0;
  }
  .fp-cap {
    position: absolute;
    left: 50%;
    bottom: 100%;
    width: 14px;
    height: 9px;
    margin-left: -7px;
    overflow: visible;
  }
  .fp-cap path {
    fill: #2c2119;
    stroke: rgba(237, 228, 212, 0.4);
    stroke-width: 1;
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
  /* An arm points away from the post: right-hand arms start at the post and
     end in a point; left-hand ones the other way about. */
  .fp-arms li[data-way='r'] {
    justify-content: flex-start;
    padding-left: calc(50% - 6px);
  }
  .fp-arms li[data-way='l'] {
    justify-content: flex-end;
    padding-right: calc(50% - 6px);
  }
  .fp-arm {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-height: 56px;
    width: min(100%, 300px);
    padding: 8px 40px 8px 18px;
    box-sizing: border-box;
    color: #ede4d4;
    text-decoration: none;
  }
  .fp-arms li[data-way='l'] .fp-arm {
    padding: 8px 18px 8px 40px;
    text-align: right;
  }
  /* The board: a shape behind the link, so the focus ring is never clipped. */
  .fp-arm::before,
  .fp-arm::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 50%, calc(100% - 24px) 100%, 0 100%);
  }
  .fp-arm::before {
    background: rgba(237, 228, 212, 0.38);
  }
  .fp-arm::after {
    inset: 1px;
    background: #241a12;
    clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 50%, calc(100% - 24px) 100%, 0 100%);
  }
  .fp-arms li[data-way='l'] .fp-arm::before,
  .fp-arms li[data-way='l'] .fp-arm::after {
    clip-path: polygon(24px 0, 100% 0, 100% 100%, 24px 100%, 0 50%);
  }
  .fp-arm:hover::after {
    background: #35261a;
  }
  .fp-arm:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
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
  /* The ground, full bleed under the post, its verge down to the footer. */
  .fp-ground {
    position: absolute;
    left: 50%;
    top: 100%;
    width: 100vw;
    height: var(--verge);
    margin-left: -50vw;
    background: #120e0c;
    border-top: 1px solid rgba(237, 228, 212, 0.22);
  }

  @media (max-width: 899px) {
    .fp-in {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  /* A phone: the post stands at the left and every arm points on. */
  @media (max-width: 559px) {
    .fp-post {
      left: 16px;
    }
    .fp-arms li[data-way] {
      justify-content: flex-start;
      padding: 0 0 0 18px;
    }
    .fp-arms li[data-way='l'] .fp-arm {
      padding: 8px 40px 8px 18px;
      text-align: left;
    }
    .fp-arms li[data-way='l'] .fp-arm::before,
    .fp-arms li[data-way='l'] .fp-arm::after {
      clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 50%, calc(100% - 24px) 100%, 0 100%);
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
    .fp-arm::before,
    .fp-arm::after {
      display: none;
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
    }
  }
</style>
