/** Shared Mapbox renderer. The site's stored geometry remains [latitude, longitude].
 * This small drawing API converts it at the renderer boundary, so saved artifacts,
 * routes and family history keep their existing coordinate contracts.
 */
import mapboxgl from 'mapbox-gl';
import type { GeoJSONSource, Map as GLMap, StyleSpecification } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './maps.css';
import { isMapboxPublicToken, MAPBOX_SETUP_MESSAGE, OFFLINE_STYLE } from './config';

export type LatLng = [number, number];
type Options = Record<string, any>;
type Handler = (event: any) => void;
const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat];
let serial = 0;

export class MapBounds {
  points: LatLng[];
  constructor(points: LatLng[]) { this.points = [...points]; }
  extend(point: LatLng) { this.points.push(point); return this; }
  native() {
    const bounds = new mapboxgl.LngLatBounds();
    for (const point of this.points) bounds.extend(lngLat(point));
    return bounds;
  }
  pad(ratio: number) {
    const b = this.native();
    const dy = (b.getNorth() - b.getSouth()) * ratio;
    const dx = (b.getEast() - b.getWest()) * ratio;
    return new MapBounds([[b.getSouth() - dy, b.getWest() - dx], [b.getNorth() + dy, b.getEast() + dx]]);
  }
}

export class MapView {
  native: GLMap;
  layers = new Set<MapLayer>();
  removed = false;
  styleReady = false;
  private resizeObserver: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private notice: HTMLElement;
  private navigation = new mapboxgl.NavigationControl({ showCompass: false });
  scrollWheelZoom;
  dragging;
  doubleClickZoom;
  boxZoom;
  keyboard;
  touchZoom;
  zoomControl;

  constructor(container: HTMLElement, token: string, style: string | StyleSpecification, opts: Options = {}) {
    this.native = new mapboxgl.Map({
      container, accessToken: token, style, center: opts.center ? lngLat(opts.center) : [-2, 54],
      zoom: opts.zoom ?? 7, maxZoom: 19, attributionControl: false,
      scrollZoom: opts.scrollWheelZoom !== false, dragPan: opts.dragging !== false,
      doubleClickZoom: opts.doubleClickZoom !== false, touchZoomRotate: opts.touchZoom !== false,
    });
    this.native.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    this.scrollWheelZoom = this.native.scrollZoom;
    this.dragging = this.native.dragPan;
    this.doubleClickZoom = this.native.doubleClickZoom;
    this.boxZoom = this.native.boxZoom;
    this.keyboard = this.native.keyboard;
    this.touchZoom = this.native.touchZoomRotate;
    this.zoomControl = { setPosition: (position: string) => {
      if (this.native.hasControl(this.navigation)) this.native.removeControl(this.navigation);
      this.native.addControl(this.navigation, position.replace('left', '-left').replace('right', '-right') as 'top-left');
    } };
    if (opts.zoomControl !== false) this.native.addControl(this.navigation, 'top-left');
    this.notice = document.createElement('p');
    this.notice.className = 'sr-map-status';
    this.notice.setAttribute('role', 'status');
    this.notice.textContent = 'Loading map…';
    container.appendChild(this.notice);
    this.native.on('load', () => { this.notice.hidden = true; });
    this.native.on('error', () => {
      // Never echo provider URLs: those contain the access token.
      this.notice.hidden = false;
      this.notice.textContent = 'Map imagery unavailable. Check the Mapbox token, allowed site URLs and connection.';
    });
    this.native.on('style.load', () => {
      this.styleReady = true;
      for (const layer of this.layers) layer.draw();
    });
    this.resizeObserver = new ResizeObserver(() => this.invalidateSize());
    this.resizeObserver.observe(container);
  }
  on(event: string, fn: Handler) {
    if (event === 'focus' || event === 'blur') {
      const canvas = this.native.getCanvas();
      canvas.addEventListener(event, fn);
      this.cleanups.push(() => canvas.removeEventListener(event, fn));
    } else this.native.on(event as 'click', (e: any) => fn({ ...e, latlng: e.lngLat }));
    return this;
  }
  setView(point: LatLng, zoom: number) { this.native.jumpTo({ center: lngLat(point), zoom }); return this; }
  getZoom() { return this.native.getZoom(); }
  panTo(point: LatLng, opts: Options = {}) { this.native.easeTo({ center: lngLat(point), duration: (opts.duration ?? 0.3) * 1000 }); return this; }
  flyTo(point: LatLng, zoom: number) { this.native.flyTo({ center: lngLat(point), zoom }); return this; }
  fitBounds(points: MapBounds | LatLng[], opts: Options = {}) {
    const bounds = points instanceof MapBounds ? points : new MapBounds(points);
    if (!bounds.points.length) return this;
    const padding = opts.padding ?? [20, 20];
    this.native.fitBounds(bounds.native(), { padding: { top: padding[1], bottom: padding[1], left: padding[0], right: padding[0] }, maxZoom: opts.maxZoom ?? 16, duration: 0 });
    return this;
  }
  invalidateSize() { if (!this.removed) this.native.resize(); }
  hasLayer(layer: MapLayer) { return this.layers.has(layer); }
  removeLayer(layer: MapLayer) { layer.remove(); return this; }
  setTheme(theme: string) {
    const style = theme === 'schematic' ? 'light-v11' : theme === 'nautical' ? 'streets-v12' : 'outdoors-v12';
    this.styleReady = false;
    this.native.setStyle(`mapbox://styles/mapbox/${style}`, { diff: false, localFontFamily: undefined, localIdeographFontFamily: undefined });
  }
  setRasterBase(style: StyleSpecification) { this.styleReady = false; this.native.setStyle(style, { diff: false, localFontFamily: undefined, localIdeographFontFamily: undefined }); }
  remove() {
    if (this.removed) return;
    this.removed = true;
    this.resizeObserver.disconnect();
    for (const cleanup of this.cleanups) cleanup();
    for (const layer of [...this.layers]) layer.remove();
    this.notice.remove();
    this.native.remove();
  }
}

export class MapLayer {
  id = `sr-map-${++serial}`;
  map: MapView | null = null;
  children = new Set<MapLayer>();
  private parent: MapLayer | null = null;
  private marker: mapboxgl.Marker | null = null;
  private popup: mapboxgl.Popup | null = null;
  private tooltip: { text: string; options: Options } | null = null;
  private events: [string, Handler][] = [];
  private unbind: (() => void)[] = [];
  private layerIds: string[] = [];
  constructor(private kind: 'group' | 'marker' | 'circleMarker' | 'line' | 'multiLine' | 'polygon' | 'raster', private coords: any = [], private opts: Options = {}) {}
  addTo(target: MapView | MapLayer) {
    if (target instanceof MapLayer) {
      this.parent = target;
      target.children.add(this);
      if (target.map) this.attach(target.map);
    } else this.attach(target);
    return this;
  }
  private attach(map: MapView) {
    this.map = map;
    map.layers.add(this);
    if (this.kind === 'group') { for (const child of this.children) child.attach(map); }
    else if (this.kind === 'marker' || this.kind === 'circleMarker' || map.styleReady) this.draw();
  }
  private geometry(): GeoJSON.Geometry {
    if (this.kind === 'multiLine') return { type: 'MultiLineString', coordinates: this.coords.map((line: LatLng[]) => line.map(lngLat)) };
    if (this.kind === 'line') return { type: 'LineString', coordinates: this.coords.map(lngLat) };
    let rings: LatLng[][] = typeof this.coords[0]?.[0] === 'number' ? [this.coords] : this.coords;
    rings = rings.map((ring) => ring.length && (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ? [...ring, ring[0]] : ring);
    return { type: 'Polygon', coordinates: rings.map((ring) => ring.map(lngLat)) };
  }
  draw() {
    const map = this.map?.native;
    if (!map || this.map?.removed || this.kind === 'group') return;
    if (this.kind === 'marker' || this.kind === 'circleMarker') {
      if (this.marker) return;
      const el = document.createElement('div');
      const icon = this.opts.icon;
      if (icon) {
        el.className = icon.className ?? '';
        el.innerHTML = icon.html ?? ''; // Only authored icon markup; labels use textContent below.
        if (icon.iconSize) { el.style.width = `${icon.iconSize[0]}px`; el.style.height = `${icon.iconSize[1]}px`; }
      } else {
        const radius = this.opts.radius ?? (this.kind === 'marker' ? 7 : 5);
        el.style.cssText = `width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;background:${this.opts.fillColor ?? '#c4570a'};border:${this.opts.weight ?? 2}px solid ${this.opts.color ?? '#faf7f1'};`;
      }
      el.style.opacity = String(this.opts.fillOpacity ?? this.opts.opacity ?? 1);
      if (this.opts.zIndexOffset) el.style.zIndex = String(this.opts.zIndexOffset);
      if (this.opts.interactive === false) el.style.pointerEvents = 'none';
      const size = icon?.iconSize ?? [0, 0];
      const anchor = icon?.iconAnchor ?? [size[0] / 2, size[1] / 2];
      this.marker = new mapboxgl.Marker({ element: el, offset: [size[0] / 2 - anchor[0], size[1] / 2 - anchor[1]] })
        .setLngLat(lngLat(this.coords)).addTo(map);
      this.bindInteractions();
      return;
    }
    if (!this.map?.styleReady || map.getSource(this.id)) return;
    this.layerIds = [];
    if (this.kind === 'raster') {
      map.addSource(this.id, { type: 'raster', tiles: [this.opts.url], tileSize: 256, maxzoom: 18, attribution: this.opts.attribution });
      map.addLayer({ id: this.id, type: 'raster', source: this.id, paint: { 'raster-opacity': this.opts.opacity ?? 1 } });
      this.layerIds = [this.id];
      return;
    }
    map.addSource(this.id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: this.geometry() } });
    const colour = this.opts.color?.startsWith('var(') ? getComputedStyle(map.getContainer()).getPropertyValue('--accent').trim() || '#c4570a' : this.opts.color ?? '#c4570a';
    if (this.kind === 'polygon' && this.opts.fill !== false) {
      const paint: any = { 'fill-color': this.opts.fillColor ?? colour, 'fill-opacity': this.opts.fillOpacity ?? 0.2 };
      if (this.opts.hatch) {
        const pattern = `${this.id}-hatch`;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 18;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = this.opts.fillColor ?? colour; ctx.globalAlpha = 0.16; ctx.fillRect(0, 0, 18, 18);
        ctx.globalAlpha = 0.65; ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 3;
        const line = (a: number, b: number, c: number, d: number) => { ctx.moveTo(a, b); ctx.lineTo(c, d); };
        ctx.beginPath();
        switch (this.opts.hatch) {
          case 'diag': line(0, 18, 18, 0); break;
          case 'back': line(0, 0, 18, 18); break;
          case 'vert': line(9, 0, 9, 18); break;
          case 'horiz': line(0, 9, 18, 9); break;
          case 'grid': line(9, 0, 9, 18); line(0, 9, 18, 9); break;
          default: ctx.arc(9, 9, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.stroke();
        if (!map.hasImage(pattern)) map.addImage(pattern, ctx.getImageData(0, 0, 18, 18), { pixelRatio: 2 });
        paint['fill-pattern'] = pattern; paint['fill-opacity'] = 1;
      }
      map.addLayer({ id: this.id, type: 'fill', source: this.id, paint });
      this.layerIds.push(this.id);
    }
    const lineId = `${this.id}-line`;
    map.addLayer({ id: lineId, type: 'line', source: this.id,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': colour, 'line-width': this.opts.weight ?? 3, 'line-opacity': this.opts.opacity ?? 1,
        ...(this.opts.dashArray ? { 'line-dasharray': String(this.opts.dashArray).split(/[ ,]+/).map((v) => Number(v) / (this.opts.weight ?? 3)) } : {}) } });
    this.layerIds.push(lineId);
    this.bindInteractions();
  }
  private bindInteractions() {
    const map = this.map?.native;
    if (!map) return;
    for (const remove of this.unbind) remove();
    this.unbind = [];
    this.popup?.remove(); this.popup = null;
    const el = this.marker?.getElement();
    const listen = (event: string, handler: Handler) => {
      if (el) {
        el.addEventListener(event, handler);
        this.unbind.push(() => el.removeEventListener(event, handler));
      } else for (const id of this.layerIds.slice(0, 1)) {
        map.on(event as 'click', id, handler);
        this.unbind.push(() => map.off(event as 'click', id, handler));
      }
    };
    for (const [event, handler] of this.events) listen(event, (e) => handler({ ...e, originalEvent: e.originalEvent ?? e, latlng: e.lngLat }));
    if (!this.tooltip) return;
    const { text, options } = this.tooltip;
    const content = document.createElement('span'); content.textContent = text;
    this.popup = new mapboxgl.Popup({ closeButton: !!options.popup, closeOnClick: !!options.popup,
      className: options.className, offset: options.offset ?? 12, anchor: options.direction === 'top' ? 'bottom' : undefined }).setDOMContent(content);
    const show = (e?: any) => {
      const pos = this.marker?.getLngLat() ?? e?.lngLat;
      if (pos) this.popup?.setLngLat(pos).addTo(map);
    };
    if (options.permanent && this.marker) show();
    else if (options.popup) listen('click', show);
    else {
      listen('mouseenter', show);
      listen('mousemove', show);
      listen('mouseleave', () => this.popup?.remove());
      if (el) {
        el.tabIndex = 0; el.setAttribute('aria-label', text);
        listen('focus', show); listen('blur', () => this.popup?.remove());
      }
    }
  }
  bindTooltip(text: string, options: Options = {}) { this.tooltip = { text, options }; this.bindInteractions(); return this; }
  bindPopup(text: string) { return this.bindTooltip(text, { popup: true }); }
  on(event: string, fn: Handler) { this.events.push([event, fn]); this.bindInteractions(); return this; }
  setLatLng(point: LatLng) { this.coords = point; this.marker?.setLngLat(lngLat(point)); if (this.tooltip?.options.permanent) this.popup?.setLngLat(lngLat(point)); return this; }
  setLatLngs(points: LatLng[] | LatLng[][]) {
    this.coords = points;
    const source = this.map?.native.getSource(this.id) as GeoJSONSource | undefined;
    source?.setData({ type: 'Feature', properties: {}, geometry: this.geometry() });
    return this;
  }
  setOpacity(opacity: number) { this.opts.opacity = opacity; if (this.marker) this.marker.getElement().style.opacity = String(opacity); return this; }
  setStyle(options: Options) {
    Object.assign(this.opts, options);
    if (this.marker) { this.marker.remove(); this.marker = null; this.draw(); }
    return this;
  }
  getBounds() { return new MapBounds(this.coords); }
  bringToFront() { for (const id of this.layerIds) if (this.map?.native.getLayer(id)) this.map.native.moveLayer(id); return this; }
  clearLayers() { for (const child of [...this.children]) child.remove(); return this; }
  remove() {
    this.clearLayers();
    for (const remove of this.unbind) remove(); this.unbind = [];
    this.marker?.remove(); this.marker = null;
    this.popup?.remove(); this.popup = null;
    const map = this.map?.native;
    for (const id of this.layerIds.reverse()) if (map?.getLayer(id)) map.removeLayer(id);
    this.layerIds = [];
    if (map?.getSource(this.id)) map.removeSource(this.id);
    if (map?.hasImage(`${this.id}-hatch`)) map.removeImage(`${this.id}-hatch`);
    this.map?.layers.delete(this); this.map = null;
    this.parent?.children.delete(this); this.parent = null;
    return this;
  }
}

/** Metre radius converted to a geodesic ring, rather than a screen-size dot. */
export function circleRing([lat, lng]: LatLng, metres: number): LatLng[] {
  const r = metres / 6371008.8, phi = lat * Math.PI / 180, lambda = lng * Math.PI / 180;
  return Array.from({ length: 65 }, (_, i) => {
    const bearing = i * 2 * Math.PI / 64;
    const p = Math.asin(Math.sin(phi) * Math.cos(r) + Math.cos(phi) * Math.sin(r) * Math.cos(bearing));
    const l = lambda + Math.atan2(Math.sin(bearing) * Math.sin(r) * Math.cos(phi), Math.cos(r) - Math.sin(phi) * Math.sin(p));
    return [p * 180 / Math.PI, l * 180 / Math.PI];
  });
}

export async function createMapTools(options: { offline?: boolean } = {}) {
  let config: { accessToken: string; style: string };
  const storageKey = 'sr-mapbox-public-config';
  if (options.offline && !navigator.onLine) {
    try { config = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); }
    catch { throw new Error('Open a trail map online once before using downloaded maps.'); }
    if (!config) throw new Error('Open a trail map online once before using downloaded maps.');
  } else {
    const response = await fetch('/api/maps/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(response.status === 503 ? MAPBOX_SETUP_MESSAGE : 'Map configuration unavailable. Sign in and reload.');
    config = await response.json();
    if (options.offline && isMapboxPublicToken(config.accessToken)) {
      // This is explicitly a public browser token, retained only for field maps.
      try { localStorage.setItem(storageKey, JSON.stringify(config)); } catch { /* storage may be disabled */ }
    }
  }
  if (!isMapboxPublicToken(config.accessToken)) throw new Error(MAPBOX_SETUP_MESSAGE);
  if (!mapboxgl.supported()) throw new Error('This browser cannot render Mapbox maps. Enable WebGL or try another browser.');
  const style = options.offline && !navigator.onLine
    ? OFFLINE_STYLE : config.style;
  return {
    map: (el: HTMLElement, opts?: Options) => new MapView(el, config.accessToken, style, opts),
    marker: (point: LatLng, opts?: Options) => new MapLayer('marker', point, opts),
    circleMarker: (point: LatLng, opts?: Options) => new MapLayer('circleMarker', point, opts),
    circle: (point: LatLng, opts: Options = {}) => new MapLayer('polygon', circleRing(point, opts.radius ?? 200), opts),
    polyline: (points: LatLng[], opts?: Options) => new MapLayer('line', points, opts),
    multiPolyline: (lines: LatLng[][], opts?: Options) => new MapLayer('multiLine', lines, opts),
    polygon: (rings: LatLng[] | LatLng[][], opts?: Options) => new MapLayer('polygon', rings, opts),
    rectangle: ([a, b]: LatLng[], opts?: Options) => new MapLayer('polygon', [a, [a[0], b[1]], b, [b[0], a[1]]], opts),
    layerGroup: () => new MapLayer('group'),
    divIcon: (opts: Options) => opts,
    raster: (url: string, opts?: Options) => new MapLayer('raster', [], { ...opts, url }),
    latLngBounds: (points: LatLng[] | LatLng, b?: LatLng) => new MapBounds(b ? [points as LatLng, b] : points as LatLng[]),
  };
}
export type MapTools = Awaited<ReturnType<typeof createMapTools>>;
