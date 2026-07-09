// appState.svelte.ts — shared reactive state for The Data Spine field study: the
// narrative register (research/ELI5) and the selected persona lens, persisted by the
// layout. DOM-free; self-contained to this route folder.
import type { PersonaId } from './types';

class AppState {
  narrative = $state<'research' | 'eli5'>('research');
  persona = $state<PersonaId | null>(null); // null = all lenses
  mounted = $state(false);
}

export const app = new AppState();
