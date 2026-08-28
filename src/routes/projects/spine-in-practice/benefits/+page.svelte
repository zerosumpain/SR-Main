<script lang="ts">
  // Rendered from study.ts by the beat's template. There is deliberately no
  // layout here: the template decides the markup, and a change to how this
  // kind of beat looks belongs in src/lib/fieldstudy/templates/, where it
  // applies to every study at once.
  import Beat from '$lib/fieldstudy/Beat.svelte';
  import { beatBySlug } from '$lib/fieldstudy/study';
  import { app } from '../lib/appState.svelte';
  import { study } from '../study';

  const beat = beatBySlug(study, 'benefits')!;
  const depth = $derived(app.narrative === 'eli5' ? 'plain' : 'research');
</script>

<svelte:head>
  <title>{beat.name} — {study.subject ?? study.title}</title>
  <meta name="description" content={beat.question ?? study.thesis} />
</svelte:head>

<div class="fs-route">
  <Beat {study} {beat} {depth} />
</div>
