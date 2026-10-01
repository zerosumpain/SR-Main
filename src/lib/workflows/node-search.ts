import type { NodeDefinition } from './types';

/**
 * Rank node definitions against a free-text query: exact type, then type,
 * label, description and LLM description substrings, then per-word hits.
 *
 * Pure, so it works over any list: the engine's registry and the
 * definitions-only catalogue Main keeps for the canvas and the doctor.
 */
export function searchNodeDefinitions(
  definitions: Iterable<NodeDefinition>,
  query: string,
  category?: NodeDefinition['category'],
): NodeDefinition[] {
  const q = query.toLowerCase();
  let candidates = [...definitions];
  if (category) {
    candidates = candidates.filter((d) => d.category === category);
  }

  return candidates
    .map((def) => {
      let score = 0;
      const type = def.type.toLowerCase();
      const label = def.label.toLowerCase();
      const desc = def.description.toLowerCase();
      const llmDesc = (def.llmDescription || '').toLowerCase();

      if (type === q) score += 100;
      if (type.includes(q)) score += 50;
      if (label.includes(q)) score += 40;
      if (desc.includes(q)) score += 20;
      if (llmDesc.includes(q)) score += 10;

      const words = q.split(/\s+/);
      for (const word of words) {
        if (word.length < 2) continue;
        if (type.includes(word)) score += 15;
        if (label.includes(word)) score += 12;
        if (desc.includes(word)) score += 8;
        if (llmDesc.includes(word)) score += 5;
      }

      return { def, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ def }) => def);
}
