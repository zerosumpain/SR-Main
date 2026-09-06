/** Paint previously downloaded OSM tiles into Mapbox image sources offline.
 * No Mapbox imagery is bulk-downloaded; online maps keep their Mapbox style.
 */
import { OFFLINE_STYLE } from '$lib/maps/config';
import type { MapView } from '$lib/maps/loader';
import { getTile, listRegions } from './tile-store';
import { getTilesInBounds, latLngToTile, tileKey, type TileCoord } from './tile-math';

function corners({ x, y, z }: TileCoord): [[number, number], [number, number], [number, number], [number, number]] {
  const lon = (n: number) => n / 2 ** z * 360 - 180;
  const lat = (n: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * n / 2 ** z))) * 180 / Math.PI;
  return [[lon(x), lat(y)], [lon(x + 1), lat(y)], [lon(x + 1), lat(y + 1)], [lon(x), lat(y + 1)]];
}

export function attachOfflineTiles(view: MapView): () => void {
  const map = view.native;
  let generation = 0;
  let disposed = false;
  const images = new Map<string, string>();
  const label = document.createElement('p');
  label.className = 'sr-map-status';
  label.style.top = 'auto'; label.style.bottom = '28px';
  label.hidden = navigator.onLine;
  map.getContainer().appendChild(label);

  function clear() {
    for (const [id, url] of images) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
      URL.revokeObjectURL(url);
    }
    images.clear();
  }
  async function draw() {
    const version = ++generation;
    if (disposed || navigator.onLine || !view.styleReady) return;
    const bounds = map.getBounds();
    if (!bounds) return;
    try {
      const regions = await listRegions();
      if (disposed || version !== generation) return;
      const maxZoom = Math.max(0, ...regions.map((region) => region.maxZoom));
      const minZoom = Math.min(maxZoom, ...regions.map((region) => region.minZoom));
      const zoom = Math.min(maxZoom, Math.max(minZoom, Math.floor(map.getZoom() + 1)));
      const nw = latLngToTile(bounds.getNorth(), bounds.getWest(), zoom);
      const se = latLngToTile(bounds.getSouth(), bounds.getEast(), zoom);
      if ((Math.abs(se.x - nw.x) + 1) * (Math.abs(se.y - nw.y) + 1) > 128) {
        label.textContent = 'Offline · zoom in to see downloaded OpenStreetMap tiles'; return;
      }
      const coords = getTilesInBounds({ n: bounds.getNorth(), s: bounds.getSouth(), e: bounds.getEast(), w: bounds.getWest() }, zoom, zoom, 0);
      // Avoid scanning an entire country after a large zoom-out.
      if (coords.length > 128) { label.textContent = 'Offline · zoom in to see downloaded OpenStreetMap tiles'; return; }
      const cached = await Promise.all(coords.map(async (coord) => ({ coord, tile: await getTile(tileKey(coord)) })));
      if (disposed || version !== generation || navigator.onLine) return;
      clear();
      for (const { coord, tile } of cached) {
        if (!tile?.blob) continue;
        const id = `offline-tile-${tileKey(coord).replaceAll('/', '-')}`;
        const url = URL.createObjectURL(tile.blob);
        images.set(id, url);
        map.addSource(id, { type: 'image', url, coordinates: corners(coord) });
        const before = map.getStyle()?.layers.find((layer) => layer.id !== 'offline-ground' && !layer.id.startsWith('offline-tile-'))?.id;
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-fade-duration': 0 } }, before);
      }
      label.textContent = images.size ? 'Offline · downloaded © OpenStreetMap contributors' : 'Offline · no downloaded tiles here';
    } catch { if (!disposed) label.textContent = 'Offline map cache unavailable'; }
  }
  const redraw = () => { void draw(); };
  const connectionChanged = () => {
    ++generation; clear(); label.hidden = navigator.onLine;
    if (navigator.onLine) view.setTheme('warm');
    else { label.textContent = 'Offline · loading downloaded OpenStreetMap tiles…'; view.setRasterBase(OFFLINE_STYLE); }
  };
  map.on('moveend', redraw); map.on('style.load', redraw);
  window.addEventListener('online', connectionChanged); window.addEventListener('offline', connectionChanged);
  if (!navigator.onLine) connectionChanged();
  return () => {
    disposed = true; ++generation;
    map.off('moveend', redraw); map.off('style.load', redraw);
    window.removeEventListener('online', connectionChanged); window.removeEventListener('offline', connectionChanged);
    clear(); label.remove();
  };
}
