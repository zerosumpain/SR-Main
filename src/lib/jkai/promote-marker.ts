// src/lib/jkai/promote-marker.ts
// Parse and strip [[suggest-promote: <toolCallId> as "<name>"]] markers
// emitted by the LLM in assistant replies. The marker opts the user into
// a one-click promote action; absence of the marker means no suggestion.

export type PromoteMarker = { toolCallId: string; proposedName: string };

const MARKER_RE = /\[\[suggest-promote:\s*([^\s\]]+)\s+as\s+"([^"]+)"\s*\]\]/g;

export function parsePromoteMarkers(text: string): PromoteMarker[] {
  const out: PromoteMarker[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    out.push({ toolCallId: m[1], proposedName: m[2] });
  }
  return out;
}

export function stripPromoteMarkers(text: string): string {
  return text.replace(MARKER_RE, '');
}
