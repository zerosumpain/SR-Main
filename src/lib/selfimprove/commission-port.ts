// The improvement backlog's half of commissioning's ports
// (`$lib/jkai/commission/ports`): file a chat or phone ask as an idea, so it
// dedupes against daydream and backlog items. Registered at boot from
// `src/hooks.server.ts`; selfimprove already depends on `$lib/jkai`, so this way
// round adds no cycle.

import { setCommissionPorts } from '$lib/jkai/commission/ports';
import { slugifyIdea } from './types';
import type { IdeaSource } from './board';

export function registerCommissionIntake(): void {
  setCommissionPorts({
    intake: async (idea) => {
      const { intakeIdeas } = await import('./backlog');
      const result = await intakeIdeas([{ ...idea, source: idea.source as IdeaSource }]);
      const slug = result.merged[0]?.into ?? result.added[0] ?? (result.outcomes[0] === 'capped' ? undefined : slugifyIdea(idea.title));
      return slug ? { slug } : {};
    },
  });
}
