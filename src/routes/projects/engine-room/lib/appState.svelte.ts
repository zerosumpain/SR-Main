// appState.svelte.ts — shared reactive state for The Engine Room field study.
// Mirrors the data-spine/policy-engine pattern: a narrative register the whole study
// reads, persisted by the layout. DOM-free, self-contained to this route folder.

class AppState {
  /**
   * 'eli5' = plain English, the default — the study should read for someone who has never
   * heard of any of this; 'research' = the full engineering explanation for those who ask.
   */
  narrative = $state<'research' | 'eli5'>('eli5');
  mounted = $state(false);
}

export const app = new AppState();
