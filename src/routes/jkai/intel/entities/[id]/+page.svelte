<script lang="ts">
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import EvidenceList from '$lib/components/intel/EvidenceList.svelte';

  let { data } = $props();

  const entity = data.entity;
  const properties = (entity.properties ?? {}) as Record<string, unknown>;
  const propEntries = Object.entries(properties).filter(([, v]) => v != null && v !== '');

  function when(value: string | Date | null): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
</script>

<JkaiPageTitle title="ENTITY" titleHref="/jkai/intel/entities" />

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <!-- Header -->
  <div class="flex items-center gap-4 mt-4 mb-6">
    <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl border" style="background: {entity.typeColor}20; border-color: var(--line-strong);">
      {entity.typeIcon}
    </div>
    <div>
      <h2 class="text-2xl font-bold">{entity.name}</h2>
      <div class="text-sm" style="color: var(--text-secondary);">
        {entity.typeName}
        {#if entity.confirmed}
          <span class="ml-2" style="color: var(--success);">confirmed</span>
        {:else}
          <span class="ml-2" style="color: var(--warn);">unconfirmed</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-6">
    <!-- Left Column -->
    <div class="space-y-4">
      {#if entity.summary}
        <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--line-strong);">
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Summary</h2>
          <p class="text-sm leading-relaxed">{entity.summary}</p>
        </div>
      {/if}

      {#if propEntries.length > 0}
        <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--line-strong);">
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Properties</h2>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {#each propEntries as [key, value]}
              <span class="capitalize" style="color: var(--text-ghost);">{key}:</span>
              <span>{value}</span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Provenance, split in two. "Where did this come from" and "what has
           happened to it since" are different questions, and a single
           date-ordered note list answered neither: the origin sat wherever its
           ingest date happened to put it, and every row linked to the extracted
           note rather than to the email or document it was extracted from. -->
      <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--line-strong);">
        <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Origin</h2>
        {#if data.firstSource}
          <a
            href={data.firstSource.href}
            class="block -mx-2 px-2 py-1.5 rounded hover:opacity-80 transition"
          >
            <div class="text-sm" style="color: var(--accent);">{data.firstSource.title}</div>
            <div class="text-xs mt-0.5 font-mono uppercase tracking-wide" style="color: var(--text-ghost);">
              {data.firstSource.source}
              {#if when(data.firstSource.observedAt ?? data.firstSource.createdAt)}
                &middot;
                <!-- An ingest date is a weaker claim than an observation date,
                     and says so, exactly as the evidence list below does. -->
                <span
                  class:ingested={!data.firstSource.observedAt}
                  title={data.firstSource.observedAt
                    ? 'When this was observed'
                    : 'When this was ingested — no observation date recorded'}
                >{when(data.firstSource.observedAt ?? data.firstSource.createdAt)}</span>
              {/if}
              &middot; {data.firstSource.direct ? 'the source itself' : 'extracted note'}
            </div>
          </a>
          {#if data.firstSource.excerpt}
            <blockquote class="text-xs mt-1 pl-2 border-l-2" style="color: var(--text-secondary); border-color: var(--line-strong);">
              {data.firstSource.excerpt}
            </blockquote>
          {/if}
        {:else}
          <!-- `first_seen_in` is nullable and older rows predate it. Saying so
               beats implying the entity has no origin. -->
          <p class="text-sm" style="color: var(--text-ghost);">Not recorded — this entity predates first-seen tracking.</p>
        {/if}
      </div>

      <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--line-strong);">
        {#if data.laterSources.length > 0}
          <EvidenceList
            evidence={data.laterSources}
            term={entity.name}
            heading="Updated by {data.laterSources.length} later source{data.laterSources.length === 1 ? '' : 's'}"
          />
        {:else}
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Updated by</h2>
          <p class="text-sm" style="color: var(--text-ghost);">Nothing has corroborated this since.</p>
        {/if}
      </div>
    </div>

    <!-- Right Column -->
    <div class="space-y-4">
      <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--line-strong);">
        <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Relationships</h2>
        {#if data.relationships.length === 0}
          <p class="text-sm" style="color: var(--text-ghost);">No relationships yet.</p>
        {:else}
          {#each data.relationships as rel}
            <a href="/jkai/intel/entities/{rel.otherEntityId}" class="flex items-center gap-2 py-1.5 -mx-2 px-2 rounded text-sm hover:opacity-80 transition">
              <span style="color: var(--text-ghost);">{rel.direction === 'outgoing' ? '→' : '←'}</span>
              <span class="font-medium" style="color: var(--accent);">{rel.type.replace(/_/g, ' ')}</span>
              <span>{rel.otherEntityIcon} {rel.otherEntityName}</span>
            </a>
          {/each}
        {/if}
      </div>

      {#if data.timelineEvents.length > 0}
        <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--line-strong);">
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Timeline</h2>
          <div class="border-l-2 pl-3 space-y-3" style="border-color: var(--line-strong);">
            {#each data.timelineEvents as event}
              <div>
                <div class="text-xs" style="color: var(--text-ghost);">{event.date}</div>
                <div class="text-sm">{event.title}</div>
                {#if event.description}
                  <div class="text-xs mt-0.5" style="color: var(--text-ghost);">{event.description}</div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .ingested {
    font-style: italic;
    opacity: 0.75;
  }
</style>
