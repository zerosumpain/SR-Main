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

// mountOffline lived here and tested that downloaded OSM tiles still render
// when the connection drops. It moved to SR-Health with $lib/trails/field —
// offline-layer and tile-store are the trails field kit, and the behaviour is
// only reachable from a route page that application now owns. The two fixtures
// above are jkai's own maps and stay.
