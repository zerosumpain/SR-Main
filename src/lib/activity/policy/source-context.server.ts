export async function loadActivitySources() {
  const [{ ensureOwnerActivityPrincipal }, { listActivityConnections }, { consumerGrantMap, consumerMayRead }, { getCatalogProvider }, { connectionCoverage, overallCoverage }] =
    await Promise.all([
      import('$lib/activity/store/principals.server'),
      import('$lib/activity/store/connections.server'),
      import('$lib/activity/policy/consumer-access.server'),
      import('$lib/activity/providers/catalog'),
      import('$lib/activity/policy/coverage'),
    ]);
  const principal = await ensureOwnerActivityPrincipal();
  const [connections, grants] = await Promise.all([
    listActivityConnections(principal.id),
    consumerGrantMap(principal.id, 'jkai'),
  ]);
  const now = new Date();
  const sources = connections.map((connection) => {
    const manifest = getCatalogProvider(connection.provider)?.manifest;
    const readsActivity = consumerMayRead(grants, connection.id, 'activity');
    const readsMetadata = consumerMayRead(grants, connection.id, 'metadata');
    return {
      id: connection.id,
      provider: connection.provider,
      providerName: manifest?.name ?? connection.provider,
      label: connection.label,
      category: manifest?.category ?? null,
      mode: connection.mode,
      status: connection.status,
      health: connection.healthStatus,
      healthMessage: connection.healthMessage,
      lastSyncSucceededAt: connection.lastSyncSucceededAt,
      evidenceModes: manifest?.evidenceModes ?? [],
      grants: { activity: readsActivity, metadata: readsMetadata },
      coverage: connectionCoverage(
        {
          status: connection.status,
          mode: connection.mode,
          evidenceModes: manifest?.evidenceModes ?? [],
          lastSyncSucceededAt: connection.lastSyncSucceededAt,
          readable: readsActivity,
        },
        now,
      ),
    };
  });
  return {
    principalId: principal.id,
    grants,
    sources,
    overall: overallCoverage(sources.map((source) => source.coverage)),
  };
}
