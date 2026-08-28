// appState.svelte.ts — shared reactive state for The Spine in Practice: the
// narrative register (research/ELI5), persisted by the layout. DOM-free and
// self-contained to this route folder, exactly as the reference study does it.
class AppState {
  narrative = $state<'research' | 'eli5'>('research');
  mounted = $state(false);
}

export const app = new AppState();
