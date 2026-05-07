import type { IntegrationAdapter } from './types';

const adapters = new Map<string, IntegrationAdapter>();

export function registerIntegrationAdapter(adapter: IntegrationAdapter): void {
  if (adapters.has(adapter.integrationType)) {
    throw new Error(
      `Integration adapter already registered: ${adapter.integrationType}`,
    );
  }
  adapters.set(adapter.integrationType, adapter);
}

export function getIntegrationAdapter(integrationType: string): IntegrationAdapter | undefined {
  return adapters.get(integrationType);
}

export function listIntegrationAdapters(): IntegrationAdapter[] {
  return Array.from(adapters.values());
}

/** Test-only: clears the registry so test files can register fresh adapters. */
export function __clearIntegrationAdapters(): void {
  adapters.clear();
}
