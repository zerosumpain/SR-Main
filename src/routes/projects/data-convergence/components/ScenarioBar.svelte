<script lang="ts">
  import type { Scenario, ID } from '../lib/types';

  interface Props {
    scenarios: Scenario[];
    activeId: ID;
    onSwitch: (id: ID) => void;
    onCreate: () => void;
    onDuplicate: () => void;
    onRename: (name: string) => void;
    onDescribe: (description: string) => void;
    onDelete: () => void;
    onResetActive: () => void;
  }
  let { scenarios, activeId, onSwitch, onCreate, onDuplicate, onRename, onDescribe, onDelete, onResetActive }: Props = $props();

  let active = $derived(scenarios.find((s) => s.id === activeId));
  let editingName = $state(false);
  let editingDesc = $state(false);
  let nameInput = $state('');
  let descInput = $state('');
  let menuOpen = $state(false);

  function startNameEdit() {
    nameInput = active?.name ?? '';
    editingName = true;
  }
  function commitName() {
    onRename(nameInput.trim() || 'Untitled scenario');
    editingName = false;
  }

  function startDescEdit() {
    descInput = active?.description ?? '';
    editingDesc = true;
  }
  function commitDesc() {
    onDescribe(descInput);
    editingDesc = false;
  }
</script>

<div class="bar">
  <div class="left">
    <span class="lab">Scenario</span>
    <div class="select-wrap">
      <button class="select" type="button" onclick={() => (menuOpen = !menuOpen)}>
        {active?.name ?? '—'} <span class="caret">▾</span>
      </button>
      {#if menuOpen}
        <!-- Items handle their own clicks; menu wrapper just contains them. -->
        <div class="menu" role="menu" tabindex="-1">
          {#each scenarios as s (s.id)}
            <button
              type="button"
              class="menu-item"
              class:active={s.id === activeId}
              onclick={() => { onSwitch(s.id); menuOpen = false; }}
            >
              <span class="dot"></span>
              <span class="name">{s.name}</span>
              <span class="count">{s.strands.length} sources</span>
            </button>
          {/each}
          <div class="menu-sep"></div>
          <button type="button" class="menu-item" onclick={() => { onCreate(); menuOpen = false; }}>+ New scenario</button>
          <button type="button" class="menu-item" onclick={() => { onDuplicate(); menuOpen = false; }}>Duplicate this scenario</button>
          <button type="button" class="menu-item" onclick={() => { onResetActive(); menuOpen = false; }}>Reset this scenario to baseline</button>
          {#if scenarios.length > 1}
            <button type="button" class="menu-item danger" onclick={() => { onDelete(); menuOpen = false; }}>Delete this scenario</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="middle">
    {#if editingName}
      <input
        class="name-input"
        type="text"
        bind:value={nameInput}
        onblur={commitName}
        onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') editingName = false; }}
        autofocus
      />
    {:else}
      <button type="button" class="name-display" onclick={startNameEdit} title="Rename scenario">
        {active?.name ?? '—'}
      </button>
    {/if}
    {#if editingDesc}
      <input
        class="desc-input"
        type="text"
        bind:value={descInput}
        placeholder="Add a one-line description…"
        onblur={commitDesc}
        onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') editingDesc = false; }}
        autofocus
      />
    {:else}
      <button type="button" class="desc-display" onclick={startDescEdit} title="Edit description">
        {active?.description || 'Add a one-line description…'}
      </button>
    {/if}
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 6px 18px 8px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.08);
    background: rgba(28, 22, 17, 0.03);
    font-family: 'DM Sans', system-ui, sans-serif;
    color: var(--ink);
    flex-wrap: wrap;
  }
  .left { display: inline-flex; align-items: center; gap: 8px; }
  .lab {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
  }
  .select-wrap { position: relative; }
  .select {
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(28, 22, 17, 0.18);
    padding: 6px 12px;
    border-radius: var(--radius-round);
    font-size: 12.5px;
    cursor: pointer;
    color: var(--ink);
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .select:hover { background: rgba(255, 255, 255, 0.85); }
  .caret { font-size: 10px; opacity: 0.5; }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--paper);
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-round);
    min-width: 240px;
    z-index: 60;
    padding: 4px;
  }
  .menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    background: transparent;
    color: var(--ink);
    border-radius: var(--radius-round);
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .menu-item:hover { background: rgba(28, 22, 17, 0.07); }
  .menu-item.active { background: rgba(28, 22, 17, 0.1); font-weight: 500; }
  .menu-item.danger { color: var(--error); }
  .menu-item .name { flex: 1; }
  .menu-item .count {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
    color: rgba(28, 22, 17, 0.55);
  }
  .menu-item .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill);
    background: rgba(28, 22, 17, 0.3);
  }
  .menu-item.active .dot { background: var(--ink); }
  .menu-sep {
    height: 1px;
    background: rgba(28, 22, 17, 0.1);
    margin: 4px 6px;
  }

  .middle {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    flex: 1;
    min-width: 0;
  }
  .name-display, .name-input {
    font-family: 'Fraunces', serif;
    font-weight: 500;
    font-size: 18px;
    line-height: 1;
    background: transparent;
    border: none;
    color: var(--ink);
    cursor: text;
    padding: 2px 4px;
    border-radius: var(--radius-round);
    border-bottom: 1px dashed transparent;
  }
  .name-display:hover { border-bottom-color: rgba(28, 22, 17, 0.3); }
  .name-input {
    border: 1px solid rgba(28, 22, 17, 0.25);
    background: rgba(255, 255, 255, 0.6);
  }

  .desc-display, .desc-input {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: rgba(28, 22, 17, 0.65);
    background: transparent;
    border: none;
    text-align: left;
    padding: 2px 4px;
    border-radius: var(--radius-round);
    cursor: text;
    font-family: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .desc-display:hover { background: rgba(28, 22, 17, 0.04); }
  .desc-input {
    border: 1px solid rgba(28, 22, 17, 0.25);
    background: rgba(255, 255, 255, 0.6);
  }

  @media (max-width: 720px) {
    .bar { padding: 6px 12px; gap: 8px; }
    .middle { flex-direction: column; align-items: flex-start; gap: 4px; }
    .name-display, .name-input { font-size: 16px; }
  }
</style>
