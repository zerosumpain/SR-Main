// estateSel.svelte.ts — a tiny shared selection signal so other exhibits on the NEET
// page (the opportunity ladder's "data it needs" chips) can focus a node on the
// DataEstateMap and scroll it into view. Cleared by the map once consumed.

export const estateSel = $state<{ id: string | null }>({ id: null });

export function selectEstateNode(id: string): void {
  estateSel.id = id;
  // the map owns the scroll (it knows its own DOM); this just raises the signal
  document.getElementById('estate-map')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
