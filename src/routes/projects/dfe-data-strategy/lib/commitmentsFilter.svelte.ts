// commitmentsFilter.svelte.ts — shared reactive state for the commitments ledger
// (/commitments): the active lens, the filter row (applies across every lens), the
// selected commitment (detail drawer) and the flow-map focus. One rune store, like
// appState, so the lenses stay in sync and the URL can encode a deep link.
// Documents and themes are MULTI-select (empty selection = everything).

import { COMMITMENTS } from './commitments';
import type { Commitment, CommitmentStatus, CommitmentTheme, DfeRole } from './types';

export type Lens = 'shelf' | 'timeline' | 'flow' | 'demand';

class LedgerState {
  lens = $state<Lens>('shelf');
  q = $state('');
  themes = $state<CommitmentTheme[]>([]);
  status = $state<CommitmentStatus | 'all'>('all');
  role = $state<DfeRole | 'all'>('all');
  docIds = $state<string[]>([]);
  /** Commitment open in the detail drawer. */
  selectedId = $state<string | null>(null);
  /** Flow-map focus: an org, or a specific from→to flow. */
  orgFocus = $state<string | null>(null);
  flowFocus = $state<{ from: string; to: string } | null>(null);

  filtered: Commitment[] = $derived.by(() => {
    const q = this.q.trim().toLowerCase();
    return COMMITMENTS.filter((c) => {
      if (this.themes.length && !this.themes.includes(c.theme)) return false;
      if (this.status !== 'all' && c.status !== this.status) return false;
      if (this.role !== 'all' && c.dfeRole !== this.role) return false;
      if (this.docIds.length && !this.docIds.includes(c.docId)) return false;
      if (q) {
        const hay = `${c.title} ${c.what} ${c.strategyImplication} ${c.aliases.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  activeFilters = $derived(
    (this.themes.length ? 1 : 0) +
      (this.status !== 'all' ? 1 : 0) +
      (this.role !== 'all' ? 1 : 0) +
      (this.docIds.length ? 1 : 0) +
      (this.q.trim() ? 1 : 0),
  );

  clearFilters() {
    this.q = '';
    this.themes = [];
    this.status = 'all';
    this.role = 'all';
    this.docIds = [];
  }
  toggleDoc(id: string) {
    this.docIds = this.docIds.includes(id) ? this.docIds.filter((d) => d !== id) : [...this.docIds, id];
  }
  toggleTheme(t: CommitmentTheme) {
    this.themes = this.themes.includes(t) ? this.themes.filter((x) => x !== t) : [...this.themes, t];
  }
  select(id: string | null) {
    this.selectedId = id;
  }
  focusFlow(from: string, to: string) {
    this.flowFocus = { from, to };
    this.orgFocus = null;
  }
  focusOrg(id: string | null) {
    this.orgFocus = id;
    this.flowFocus = null;
  }
}

export const ledger = new LedgerState();
