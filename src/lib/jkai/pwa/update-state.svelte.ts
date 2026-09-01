export const appUpdate = $state({
  available: false,
  installing: false,
  nextVersion: null as string | null,
  apply: null as (() => Promise<void>) | null,
});

export function offerAppUpdate(apply: () => Promise<void>, nextVersion?: string | null): void {
  appUpdate.available = true;
  appUpdate.nextVersion = nextVersion ?? null;
  appUpdate.apply = apply;
}

export async function applyAppUpdate(): Promise<void> {
  if (!appUpdate.apply || appUpdate.installing) return;
  appUpdate.installing = true;
  try {
    await appUpdate.apply();
  } finally {
    appUpdate.installing = false;
  }
}
