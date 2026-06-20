<script lang="ts">
  import WhatsAppChannelPanel from '$lib/components/channels/whatsapp/WhatsAppChannelPanel.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.channel.name} — Channels</title>
</svelte:head>

<PageHeader title="WHATSAPP CHANNEL" titleHref="/jkai/channels" />

<div class="p-6 sm:p-10 max-w-3xl mx-auto">
  <div class="mb-6">
    <p class="text-sm" style="color: var(--text-secondary);">WhatsApp channel configuration.</p>
  </div>

  <div
    class="p-5 rounded-[var(--radius-round)] border"
    style="background: var(--card-bg); border-color: var(--card-border);"
  >
    <WhatsAppChannelPanel channelId={data.channel.id} />
  </div>
</div>
