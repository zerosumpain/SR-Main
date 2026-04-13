import type { NodeDefinition, NodeExecutor } from './types';

export class NodeRegistry {
  private definitions = new Map<string, NodeDefinition>();
  private executors = new Map<string, NodeExecutor>();

  register(definition: NodeDefinition, executor: NodeExecutor): void {
    this.definitions.set(definition.type, definition);
    this.executors.set(definition.type, executor);
  }

  getDefinition(type: string): NodeDefinition | undefined {
    return this.definitions.get(type);
  }

  getExecutor(type: string): NodeExecutor | undefined {
    return this.executors.get(type);
  }

  listDefinitions(category?: NodeDefinition['category']): NodeDefinition[] {
    const all = Array.from(this.definitions.values());
    if (category) {
      return all.filter((d) => d.category === category);
    }
    return all;
  }

  search(query: string, category?: NodeDefinition['category']): NodeDefinition[] {
    const q = query.toLowerCase();
    let candidates = Array.from(this.definitions.values());
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
}
