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
}
