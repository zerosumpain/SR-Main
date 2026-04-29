import type { Proposal, ProposalStatus } from './proposal';

export type ProposalStore = {
  list(): Proposal[];
  pending(): Proposal[];
  get(id: string): Proposal | undefined;
  add(p: Proposal): void;
  replace(oldId: string, next: Proposal): void;
  resolve(id: string, status: Exclude<ProposalStatus, 'pending'>): void;
  clear(): void;
};

export function createProposalStore(): ProposalStore {
  // Plain Map; the Svelte 5 binding ($state) wraps the store at the call site
  // to keep this module testable in plain Node.
  const map = new Map<string, Proposal>();
  return {
    list() { return Array.from(map.values()); },
    pending() { return Array.from(map.values()).filter((p) => p.status === 'pending'); },
    get(id) { return map.get(id); },
    add(p) { map.set(p.id, p); },
    replace(oldId, next) {
      map.delete(oldId);
      map.set(next.id, next);
    },
    resolve(id, status) {
      const cur = map.get(id);
      if (cur) map.set(id, { ...cur, status } as Proposal);
    },
    clear() { map.clear(); },
  };
}
