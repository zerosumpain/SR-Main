// Runtime access to the committed Voice Card.
//
// The card is built by `scripts/build-voice-card.ts` and committed to
// data/voice/. It is read from disk rather than imported, for the same reason
// data/prompts is: `ci-release.sh` rsyncs data/ to the VPS wholesale, so a
// rebuilt card reaches production with the next deploy and needs no allow-list
// entry — and reading it means a card edit does not require a rebuild to take
// effect locally.
//
// SERVER ONLY. It touches the filesystem, so importing it from a component
// would break the client build.
//
// Phase 2 (`voiceBlock`) is what turns this into prompt text. This module only
// loads and validates.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { VoiceCard, Register, Exemplar } from './types';
import { isRegister } from './types';

const VOICE_DIR = path.join(process.cwd(), 'data', 'voice');
const CARD_PATH = path.join(VOICE_DIR, 'voice-card.json');
const EXEMPLAR_DIR = path.join(VOICE_DIR, 'exemplars');

let cardCache: VoiceCard | null = null;
let exemplarCache: Exemplar[] | null = null;

/** Drop the cache. Used by tests and by the admin regenerate flow. */
export function clearVoiceCache(): void {
  cardCache = null;
  exemplarCache = null;
}

/**
 * The card, or null when it has not been built yet. Callers must handle null
 * rather than assume — a missing card should degrade a prompt to its previous
 * behaviour, never throw in the middle of someone's chat turn.
 */
export function getVoiceCard(): VoiceCard | null {
  if (cardCache) return cardCache;
  if (!existsSync(CARD_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CARD_PATH, 'utf8')) as VoiceCard;
    if (typeof parsed?.version !== 'number' || !parsed.registers) return null;
    cardCache = parsed;
    return cardCache;
  } catch {
    return null;
  }
}

export function getExemplars(register?: Register): Exemplar[] {
  if (!exemplarCache) exemplarCache = loadExemplars();
  return register ? exemplarCache.filter((e) => e.register === register) : exemplarCache;
}

/** Exemplars named by a register's card, in the order the card lists them. */
export function getRegisterExemplars(register: Register): Exemplar[] {
  const card = getVoiceCard();
  if (!card) return [];
  const wanted = card.registers[register]?.exemplarIds ?? [];
  const byId = new Map(getExemplars().map((e) => [e.id, e]));
  return wanted.map((id) => byId.get(id)).filter((e): e is Exemplar => e !== undefined);
}

function loadExemplars(): Exemplar[] {
  if (!existsSync(EXEMPLAR_DIR)) return [];
  const out: Exemplar[] = [];
  for (const file of readdirSync(EXEMPLAR_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    const parsed = parseExemplar(file, readFileSync(path.join(EXEMPLAR_DIR, file), 'utf8'));
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Exported for the build script and for tests — one parser, so a file that
 *  loads at build time cannot silently fail to load at runtime. */
export function parseExemplar(filename: string, raw: string): Exemplar | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(': ');
    if (idx < 0) continue;
    meta[line.slice(0, idx).trim()] = line
      .slice(idx + 2)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  if (!isRegister(meta.register)) return null;
  const text = m[2].trim();
  if (!text) return null;
  return {
    id: filename.replace(/\.md$/, ''),
    register: meta.register,
    shows: meta.shows ?? '',
    sourcePostId: Number(meta.sourcePostId ?? 0),
    sourceSlug: meta.sourceSlug ?? '',
    text,
  };
}
