<svelte:head><title>Hero — Admin</title></svelte:head>

<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import HeroBackgroundControls from '$lib/components/admin/HeroBackgroundControls.svelte';
  import HeroActivityRules from '$lib/components/admin/HeroActivityRules.svelte';
  import HeroTaglineControls from '$lib/components/admin/HeroTaglineControls.svelte';
  import type { HeroSlot } from '$lib/constants/hero-slots';
  import HeroSourcePicker from '$lib/components/admin/HeroSourcePicker.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let previewSlot = $state<HeroSlot>('default');
  let previewAsset = $derived(data.backgroundSlots.find(slot => slot.id === previewSlot)?.asset ?? data.backgroundAsset);
</script>

<!-- The generated hero headlines ("Idling. But here.") were retired with the
     2026-10-03 landing overhaul; this page now holds the masthead's tagline
     and the background animation settings. -->
<PageWrap width="wide">
  <PageHeader kicker="Landing page" title="hero" sub="The tagline under the title, the background animation and the activity rules that pick it." />

  <HeroTaglineControls tagline={data.tagline} result={form} />
  <HeroSourcePicker sources={data.backgroundSources} slots={data.backgroundSlots} activity={data.activity} initialJob={data.backgroundJob} onselect={slot => previewSlot = slot} />
  <HeroActivityRules rules={data.activityRules} result={form} />
  <HeroBackgroundControls settings={data.backgroundSettings} asset={previewAsset} result={form} />
</PageWrap>
