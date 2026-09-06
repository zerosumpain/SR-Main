// Vite compiles these imports with the same Svelte runtime as the components.
import { mount } from 'svelte';
import MapArtifact from '../../jkai/artifacts/MapArtifact.svelte';
import PlaceMap from '../../jkai/PlaceMap.svelte';
export { loadMapbox } from '$lib/maps/loader';
export function mountArtifact(target: HTMLElement) {
  return mount(MapArtifact, { target, props: { artifact: {
    type: 'map', caption: 'Synthetic map preview', layers: [{ kind: 'points', points: [{ lat: 52.63, lng: 1.3, label: 'Sample place' }] }],
  } } });
}
export function mountPlace(target: HTMLElement) {
  return mount(PlaceMap, { target, props: { lat: 52.63, lon: 1.3 } });
}

import { loadMapbox } from '$lib/maps/loader';
import { attachOfflineTiles } from '$lib/trails/field/offline-layer';
import { putTile } from '$lib/trails/field/tile-store';
import { latLngToTile, tileKey } from '$lib/trails/field/tile-math';
import { openDB } from 'idb';
export async function mountOffline(target: HTMLElement) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#0e5b66'; ctx.fillRect(0, 0, 256, 256);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
  const tile = latLngToTile(52.63, 1.3, 13);
  await putTile({ key: tileKey(tile), blob, routeId: 'synthetic', cachedAt: Date.now(), size: blob.size });
  const db = await openDB('sr-trails-tiles');
  await db.put('regions', { routeId: 'synthetic', name: 'Synthetic offline test', minZoom: 13, maxZoom: 13, tileCount: 1, bytes: blob.size, status: 'complete', updatedAt: Date.now() });
  db.close();
  const M = await loadMapbox({ offline: true });
  const view = M.map(target).setView([52.63, 1.3], 12);
  const detach = attachOfflineTiles(view);
  M.polyline([[52.63, 1.3], [52.64, 1.31]], { color: '#c4570a' }).addTo(view);
  return { view, remove: () => { detach(); view.remove(); } };
}
