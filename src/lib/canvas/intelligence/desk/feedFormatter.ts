// src/lib/canvas/intelligence/desk/feedFormatter.ts
//
// Pure helpers: map artefact events and log messages to FeedEvent text + tone.
// No Svelte runes — safe to unit-test in vitest.

export type FeedTone = 'source' | 'fact' | 'challenge' | 'entity' | 'link' | 'log';

export interface FeedEvent {
  seq: number;
  kind: FeedTone;
  text: string;
  tone: FeedTone;
  ts: number;
}

/** Format an artefact event into { text, tone }. Returns null for unknown types. */
export function formatFeedEvent(
  artefactType: string,
  fields: Record<string, unknown>,
): { text: string; tone: FeedTone } | null {
  switch (artefactType) {
    case 'source': {
      const domain = (fields.domain as string | undefined) ?? '';
      const credScore = fields.credibilityScore;
      const credType = fields.credibilityType as string | undefined;
      const qualifier =
        credScore != null ? String(credScore) : (credType ?? '');
      return {
        text: `+ src ${domain || '?'}${qualifier ? ' · ' + qualifier : ''}`,
        tone: 'source',
      };
    }
    case 'fact': {
      const isCounter = Boolean(fields.isCounterfactual);
      const conf = fields.confidence != null ? String(fields.confidence) : '';
      if (isCounter) {
        return {
          text: `⚠ counter${conf ? ' · ' + conf : ''}`,
          tone: 'challenge',
        };
      }
      return {
        text: `+ fact${conf ? ' · ' + conf : ''}`,
        tone: 'fact',
      };
    }
    case 'entity': {
      const name = (fields.name as string | undefined) ?? '?';
      const type = (fields.type as string | undefined) ?? '';
      return {
        text: `✓ ${name}${type ? ' · ' + type : ''}`,
        tone: 'entity',
      };
    }
    case 'relationship': {
      const rel = (fields.relationshipType as string | undefined) ?? '?';
      return {
        text: `~ ${rel}`,
        tone: 'link',
      };
    }
    default:
      return null;
  }
}

// Leading emoji/icon prefix used by emitLog (same pattern as tickerText.ts)
const LEADING_ICON =
  /^[\p{Extended_Pictographic}\u{FE0F}\u{1F3FB}-\u{1F3FF}ℹ⚠✅]+\s*/u;

/** Format a raw log message (from DeskLog) into a FeedEvent text + tone. */
export function formatLogFeedEvent(message: string): { text: string; tone: FeedTone } {
  const stripped = message.replace(LEADING_ICON, '').replace(/\s+/g, ' ').trim();
  return {
    text: stripped || '…',
    tone: 'log',
  };
}
