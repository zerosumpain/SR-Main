// appState.svelte.ts — shared reactive state for The Engine Room field study.
// Mirrors the data-spine/policy-engine pattern: a narrative register the whole study
// reads, persisted by the layout. DOM-free, self-contained to this route folder.

class AppState {
  /** 'research' = the full engineering explanation; 'eli5' = the same thing in plain English. */
  narrative = $state<'research' | 'eli5'>('research');
  mounted = $state(false);
}

export const app = new AppState();
