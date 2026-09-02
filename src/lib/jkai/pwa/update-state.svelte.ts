export const appUpdate = $state({
  available: false,
  installing: false,
  nextVersion: null as string | null,
  apply: null as (() => Promise<void>) | null,
  error: null as string | null,
});

export function offerAppUpdate(apply: () => Promise<void>, nextVersion?: string | null): void {
  appUpdate.available = true;
  appUpdate.nextVersion = nextVersion ?? null;
  appUpdate.apply = apply;
  appUpdate.error = null;
}

export async function applyAppUpdate(): Promise<void> {
  if (!appUpdate.apply || appUpdate.installing) return;
  appUpdate.installing = true;
  appUpdate.error = null;
  try {
    await appUpdate.apply();
    appUpdate.available = false;
    appUpdate.apply = null;
  } catch (err) {
    appUpdate.error = err instanceof Error ? err.message : 'The update could not be applied.';
  } finally {
    appUpdate.installing = false;
  }
}
