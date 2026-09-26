// What a reader of the news desk may do with a story, beyond reading and
// saving it. Each action writes into another area, so each needs that area's
// grant: keeping a story in the graph writes into their intel space, research
// starts a run, a note lands in the notebook, and "Ask JKAI" opens a chat.
// The owner may do everything; the page hides the rest, and the actions
// endpoint refuses them whatever the page shows.
import { viewerHolds, viewerOf, type Viewer } from '$lib/server/viewer';

export interface NewsCapabilities {
  graph: boolean;
  research: boolean;
  note: boolean;
  ask: boolean;
  /** Correlations, kept-in-graph marks and counts read John's own material. */
  ownerData: boolean;
}

export function newsCapabilitiesFor(viewer: Viewer): NewsCapabilities {
  // A sessionless request reached the desk through an owner-grade lane.
  const owner = viewer.kind === 'owner' || viewer.kind === 'anonymous';
  return {
    graph: owner || viewerHolds(viewer, 'jkai.intel:self'),
    research: owner || viewerHolds(viewer, 'research:self'),
    note: owner || viewerHolds(viewer, 'jkai.notes:self'),
    ask: owner || viewerHolds(viewer, 'jkai.chat:self'),
    ownerData: owner,
  };
}

export async function newsCapabilities(event: { locals: App.Locals }): Promise<NewsCapabilities> {
  return newsCapabilitiesFor(await viewerOf(event));
}
