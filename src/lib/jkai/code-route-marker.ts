// src/lib/jkai/code-route-marker.ts
// Parse and strip [[code-route: "<what to build>"]] markers emitted by the LLM
// when a coding request could reasonably go either way — a real app built by
// the autonomous builder, or a snippet written straight into the reply.
//
// Same contract as promote-marker.ts: the marker is an opt-in. No marker means
// the model judged the ask unambiguous and just answered, which is what should
// happen for "how do I reverse a list in python".

export type CodeRouteMarker = {
  /** The build prompt to hand the builder, verbatim, if the user picks Build. */
  brief: string;
};

const MARKER_RE = /\[\[code-route:\s*"([^"]+)"\s*\]\]/g;

export function parseCodeRouteMarkers(text: string): CodeRouteMarker[] {
  const out: CodeRouteMarker[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const brief = m[1].trim();
    if (brief) out.push({ brief });
  }
  // One decision per reply. A model that emits several has misunderstood the
  // marker, and stacking cards would ask the same question three times.
  return out.slice(0, 1);
}

export function stripCodeRouteMarkers(text: string): string {
  return text.replace(MARKER_RE, '');
}
