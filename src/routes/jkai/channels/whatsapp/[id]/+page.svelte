<script lang="ts">
  import WhatsAppChannelPanel from '$lib/components/channels/whatsapp/WhatsAppChannelPanel.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.channel.name} — Channels</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-3xl mx-auto">
  <div class="mb-6">
    <a href="/jkai/channels" class="text-xs" style="color: var(--text-ghost);">← Channels</a>
    <h1 class="display text-[28px] sm:text-[32px] mt-1" style="color: var(--text-primary);">
      {data.channel.name}
    </h1>
    <p class="text-sm mt-1" style="color: var(--text-secondary);">WhatsApp channel configuration.</p>
  </div>

  <div
    class="p-5 rounded-xl border"
    style="background: var(--card-bg); border-color: var(--card-border);"
  >
    <WhatsAppChannelPanel channelId={data.channel.id} />
  </div>
</div>
