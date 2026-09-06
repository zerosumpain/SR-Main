export interface CleanupOptions {
  apply?: boolean;
  pathPrefix?: string;
  fileIds?: string[];
  /** Limit orphan inspection to a selected set of entities. */
  entityIds?: string[];
  /** Used when a source is explicitly deleted. */
  noteIds?: string[];
  scanOrphans?: boolean;
}

export interface CleanupResult {
  applied: boolean;
  notes: Array<{ id: string; title: string; reason: string }>;
  entities: Array<{ id: string; name: string }>;
  review: Array<{ id: string; name: string }>;
  counts: {
    notesRemoved: number;
    entitiesRemoved: number;
    entitiesRefreshed: number;
    entitiesProtected: number;
    relationshipsRemoved: number;
    timelineEventsRemoved: number;
    dossierItemsRemoved: number;
    insightsRemoved: number;
    alertsRemoved: number;
    brokenMergesRestored: number;
    reviewRequired: number;
    remaining: number;
  };
}
