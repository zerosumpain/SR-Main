<script lang="ts">
  type Milestone = { id: string; title: string; done: boolean; iter?: number };
  let { milestones }: { milestones: Milestone[] } = $props();
</script>

<section class="nm-sec">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Milestones</span>
  </header>
  {#if !milestones || milestones.length === 0}
    <p class="dim">Approve a plan to populate milestones.</p>
  {:else}
    <ul>
      {#each milestones as m (m.id)}
        <li>
          <span class="status-dot" data-status={m.done ? 'completed' : 'pending'}></span>
          <span class="title" class:done={m.done}>{m.title}</span>
          {#if m.iter !== undefined}
            <span class="dim">iter {m.iter}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-body);
    font-size: var(--fs-label);
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .title {
    color: var(--text-primary);
  }
  .done {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    margin-left: auto;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
</style>
