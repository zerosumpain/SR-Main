// The page's half of the bridge (spec §10.9): posting to the app's
// `hometowns` handler, exposing `window.hometowns`, and checking what the
// app hands in before the page acts on it. In a plain browser there is no
// handler, so posts go to an optional local listener (harness mode and the
// tests) and the page works the same on its own.

import { BRIDGE_VERSION, HANDLER, type HometownsApi, type PageMessage, type Posted } from './protocol';
import type { Op } from '../engine';
import { LENS_IDS, type LensOrNone } from '../lenses';
import type { Tool, ToolKind } from '../plan/plan';

interface WebKitHandlers {
  webkit?: { messageHandlers?: Record<string, { postMessage(m: unknown): void } | undefined> };
}

/** True inside the app (the handler is registered before the page loads). */
export function inApp(): boolean {
  return Boolean((globalThis as unknown as WebKitHandlers).webkit?.messageHandlers?.[HANDLER]);
}

/** Where posts go when there is no app (harness mode, tests). */
let localListener: ((m: Posted) => void) | null = null;

export function listen(fn: ((m: Posted) => void) | null): void {
  localListener = fn;
}

export function post(message: PageMessage): void {
  const m: Posted = { ...message, v: BRIDGE_VERSION };
  try {
    const h = (globalThis as unknown as WebKitHandlers).webkit?.messageHandlers?.[HANDLER];
    if (h) h.postMessage(m);
  } catch {
    // No app around this page.
  }
  localListener?.(m);
}

export function expose(api: HometownsApi): void {
  Object.assign(globalThis, { hometowns: api });
}

// ---- Sanitising what the app sends (§10.9: "ids sanitised") ------------------------------------------

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const TOOL_KINDS: readonly ToolKind[] = ['none', 'road', 'upgrade', 'zone', 'dezone', 'place', 'bulldoze', 'eraser', 'parcel'];

export const cleanId = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);
const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

export function cleanTool(v: unknown): Tool | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!TOOL_KINDS.includes(o.kind as ToolKind)) return null;
  const tool: Tool = { kind: o.kind as ToolKind };
  if (o.id !== undefined) {
    const id = cleanId(o.id);
    if (!id) return null;
    tool.id = id;
  }
  if (o.variant !== undefined) {
    const variant = cleanId(o.variant);
    if (!variant) return null;
    tool.variant = variant;
  }
  if (o.rot === 0 || o.rot === 1) tool.rot = o.rot;
  return tool;
}

export function cleanLens(v: unknown): LensOrNone | null {
  return v === 'none' || (LENS_IDS as readonly unknown[]).includes(v) ? (v as LensOrNone) : null;
}

export function cleanPoint(v: unknown): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const x = int(o.x, 0, 63);
  const y = int(o.y, 0, 63);
  return x === null || y === null ? null : { x, y };
}

const rectOk = (r: unknown) => Array.isArray(r) && r.length === 4 && r.every((n) => Number.isInteger(n) && n >= 0 && n <= 64);
const pathOk = (p: unknown) => Array.isArray(p) && p.length >= 2 && p.length <= 40 && p.length % 2 === 0 && p.every((n) => Number.isInteger(n) && n >= 0 && n < 64);

/** A ghost plan from the app: well-formed ops only, at most 60 (the engine re-validates everything). */
export function cleanOps(v: unknown): Op[] | null {
  if (!Array.isArray(v) || v.length > 60) return null;
  const out: Op[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    switch (o.op) {
      case 'road':
      case 'upgrade':
        if (!cleanId(o.kind) || !pathOk(o.path)) return null;
        out.push({ op: o.op, kind: o.kind as 'lane', path: [...(o.path as number[])] });
        break;
      case 'zone':
        if (!cleanId(o.zone) || !rectOk(o.rect)) return null;
        out.push({ op: 'zone', zone: o.zone as 'homes', rect: [...(o.rect as number[])] as [number, number, number, number] });
        break;
      case 'dezone':
      case 'bulldoze':
        if (!rectOk(o.rect)) return null;
        out.push({ op: o.op, rect: [...(o.rect as number[])] as [number, number, number, number] });
        break;
      case 'place':
        if (!cleanId(o.id) || int(o.x, 0, 63) === null || int(o.y, 0, 63) === null || (o.rot !== 0 && o.rot !== 1)) return null;
        out.push({ op: 'place', id: o.id as string, x: o.x as number, y: o.y as number, rot: o.rot as 0 | 1 });
        break;
      case 'parcel':
        if (int(o.p, 0, 15) === null) return null;
        out.push({ op: 'parcel', p: o.p as number });
        break;
      default:
        return null;
    }
  }
  return out;
}

// ---- needReload debounce (A39) ------------------------------------------------------------------------

const RELOAD_KEY = 'hometowns.reload';
/** At most one reload a minute, and never back to a hash this phone has already left. */
export const RELOAD_GAP_MS = 60_000;

interface ReloadMemo {
  at: number;
  left: string[];
}

function readMemo(): ReloadMemo {
  try {
    const raw = globalThis.sessionStorage?.getItem(RELOAD_KEY);
    const m = raw ? (JSON.parse(raw) as ReloadMemo) : null;
    if (m && typeof m.at === 'number' && Array.isArray(m.left)) return m;
  } catch {
    // Storage can be missing or blocked in a WebView; the debounce then lasts this page's life only.
  }
  return { at: 0, left: [] };
}

let memoryMemo: ReloadMemo | null = null;

/** Whether the page may ask the app to load `wanted` now (and, if so, remembers that it did). */
export function requestReload(current: string, wanted: string, now: number): boolean {
  const m = memoryMemo ?? readMemo();
  if (m.left.includes(wanted) || now - m.at < RELOAD_GAP_MS) return false;
  const next: ReloadMemo = { at: now, left: [...m.left.filter((h) => h !== current), current].slice(-8) };
  memoryMemo = next;
  try {
    globalThis.sessionStorage?.setItem(RELOAD_KEY, JSON.stringify(next));
  } catch {
    // See readMemo.
  }
  return true;
}

/** Tests: forget the debounce. */
export function resetReloadMemo(): void {
  memoryMemo = null;
  try {
    globalThis.sessionStorage?.removeItem(RELOAD_KEY);
  } catch {
    // See readMemo.
  }
}
