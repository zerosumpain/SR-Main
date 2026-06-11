<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import type { Story } from '../lib/stories';
  import ThemeRail from './ThemeRail.svelte';

  let { story }: { story: Story } = $props();
  const eli = $derived(app.narrative === 'eli5');
</script>

<header class="sm">
  <span class="sm-kicker">Field Study №{story.no} · {story.theme}</span>
  <h1 class="pe-h1">{story.question}</h1>
  <p class="pe-lede sm-thesis">{eli ? story.thesisEli5 : story.thesis}</p>
  <div class="sm-ask">
    <span class="sm-ask-lab">▸ To monitor this, the department would need</span>
    <ul>
      {#each story.dataAsk as ask}<li>{ask}</li>{/each}
    </ul>
    {#if story.no !== 4}
      <a class="sm-ask-link" href="/projects/policy-engine/monitor">→ The data spine</a>
    {/if}
  </div>
  <ThemeRail route={story.route} />
</header>

<style>
  .sm { margin: 0 0 18px; }
  .sm-kicker { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--ink-soft, rgba(28,22,17,0.62)); margin-bottom: 7px; }
  .sm-thesis { margin: 0 0 14px; max-width: 78ch; }
  .sm-ask { border-left: 3px solid #4a7c7c; background: rgba(74,124,124,0.07); border-radius: 7px;
    padding: 10px 14px; max-width: 78ch; }
  .sm-ask-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em;
    text-transform: uppercase; color: #3a5f5f; margin-bottom: 6px; }
  .sm-ask ul { margin: 0; padding-left: 18px; }
  .sm-ask li { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); margin-bottom: 3px; }
  .sm-ask-link { display: inline-block; margin-top: 6px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px;
    color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
