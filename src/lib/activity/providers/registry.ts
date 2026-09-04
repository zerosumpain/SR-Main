import type { ActivityProviderAdapter, ProviderManifest } from '../contracts';

const providers = new Map<string, ActivityProviderAdapter>();

export function registerActivityProvider(adapter: ActivityProviderAdapter): void {
  const id = adapter.manifest.id;
  if (providers.has(id)) throw new Error(`Activity provider already registered: ${id}`);
  providers.set(id, adapter);
}

export function getActivityProvider(id: string): ActivityProviderAdapter | null {
  return providers.get(id) ?? null;
}

export function listActivityProviders(options: { includeHidden?: boolean } = {}): ProviderManifest[] {
  return [...providers.values()]
    .map((provider) => provider.manifest)
    .filter((manifest) => options.includeHidden || !manifest.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Test-only: provider modules register globally when imported. */
export function __clearActivityProviders(): void {
  providers.clear();
}
