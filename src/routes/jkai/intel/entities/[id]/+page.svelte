<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();

  const entity = data.entity;
  const properties = (entity.properties ?? {}) as Record<string, unknown>;
  const propEntries = Object.entries(properties).filter(([, v]) => v != null && v !== '');
</script>

<PageHeader title="ENTITY" titleHref="/jkai/intel/entities" />

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <!-- Header -->
  <div class="flex items-center gap-4 mt-4 mb-6">
    <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl border" style="background: {entity.typeColor}20; border-color: var(--card-border);">
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
        <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Summary</h2>
          <p class="text-sm leading-relaxed">{entity.summary}</p>
        </div>
      {/if}

      {#if propEntries.length > 0}
        <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Properties</h2>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {#each propEntries as [key, value]}
              <span class="capitalize" style="color: var(--text-ghost);">{key}:</span>
              <span>{value}</span>
            {/each}
          </div>
        </div>
      {/if}

      <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Appears in {data.notes.length} notes</h2>
        {#each data.notes as note}
          <a href="/jkai/intel/notes/{note.noteId}" class="block py-2 border-b last:border-0 -mx-2 px-2 rounded hover:opacity-80 transition" style="border-color: var(--card-border);">
            <div class="text-sm" style="color: var(--accent);">{note.noteTitle ?? 'Untitled'}</div>
            <div class="text-xs mt-0.5" style="color: var(--text-ghost);">{new Date(note.noteCreatedAt).toLocaleDateString()} &middot; {note.relevance}</div>
            {#if note.excerpt}
              <div class="text-xs mt-1 line-clamp-2" style="color: var(--text-ghost);">{note.excerpt}</div>
            {/if}
          </a>
        {/each}
      </div>
    </div>

    <!-- Right Column -->
    <div class="space-y-4">
      <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
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
        <div class="rounded-[var(--radius-round)] p-4 border" style="background: var(--card-bg); border-color: var(--card-border);">
          <h2 class="text-xs uppercase mb-2" style="color: var(--text-ghost);">Timeline</h2>
          <div class="border-l-2 pl-3 space-y-3" style="border-color: var(--card-border);">
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
