import { sql, type SQL } from 'drizzle-orm';

export interface Installation {
  id: string;
  component: string;
  environment: string;
  version: string;
  sourceUrl: string | null;
  discoveredAt: Date;
  updatedAt: Date;
}

export interface ReleaseNotes {
  id: string;
  component: string;
  version: string;
  sourceUrl: string;
  notes: string;
  breakingChanges: string[];
  fetchedAt: Date;
}

export interface UpgradeRepository {
  saveInstallation(installation: Installation): Promise<void>;
  findInstallation(component: string, environment: string): Promise<Installation | null>;
  saveReleaseNotes(releaseNotes: ReleaseNotes): Promise<void>;
  findReleaseNotes(component: string, version: string): Promise<ReleaseNotes | null>;
}

export interface DrizzleSqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

type Row = Record<string, unknown>;

function rowsFrom(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function installationFromRow(row: Row): Installation {
  return {
    id: String(row.id),
    component: String(row.component),
    environment: String(row.environment),
    version: String(row.version),
    sourceUrl: row.source_url === null ? null : String(row.source_url),
    discoveredAt: asDate(row.discovered_at),
    updatedAt: asDate(row.updated_at)
  };
}

function releaseNotesFromRow(row: Row): ReleaseNotes {
  const breakingChanges = row.breaking_changes;
  return {
    id: String(row.id),
    component: String(row.component),
    version: String(row.version),
    sourceUrl: String(row.source_url),
    notes: String(row.notes),
    breakingChanges: Array.isArray(breakingChanges) ? breakingChanges.map(String) : [],
    fetchedAt: asDate(row.fetched_at)
  };
}

/** A PostgreSQL repository usable with any Drizzle database that exposes execute(sql). */
export class DrizzleInventoryRepository implements UpgradeRepository {
  constructor(private readonly db: DrizzleSqlExecutor) {}

  async saveInstallation(installation: Installation): Promise<void> {
    await this.db.execute(sql`
      insert into inventory_installations
        (id, component, environment, version, source_url, discovered_at, updated_at)
      values
        (${installation.id}, ${installation.component}, ${installation.environment}, ${installation.version}, ${installation.sourceUrl}, ${installation.discoveredAt}, ${installation.updatedAt})
      on conflict (component, environment) do update set
        id = excluded.id,
        version = excluded.version,
        source_url = excluded.source_url,
        discovered_at = excluded.discovered_at,
        updated_at = excluded.updated_at
    `);
  }

  async findInstallation(component: string, environment: string): Promise<Installation | null> {
    const result = await this.db.execute(sql`
      select id, component, environment, version, source_url, discovered_at, updated_at
      from inventory_installations
      where component = ${component} and environment = ${environment}
      limit 1
    `);
    const row = rowsFrom(result)[0];
    return row ? installationFromRow(row) : null;
  }

  async saveReleaseNotes(releaseNotes: ReleaseNotes): Promise<void> {
    await this.db.execute(sql`
      insert into inventory_release_notes
        (id, component, version, source_url, notes, breaking_changes, fetched_at)
      values
        (${releaseNotes.id}, ${releaseNotes.component}, ${releaseNotes.version}, ${releaseNotes.sourceUrl}, ${releaseNotes.notes}, ${JSON.stringify(releaseNotes.breakingChanges)}::jsonb, ${releaseNotes.fetchedAt})
      on conflict (component, version) do update set
        id = excluded.id,
        source_url = excluded.source_url,
        notes = excluded.notes,
        breaking_changes = excluded.breaking_changes,
        fetched_at = excluded.fetched_at
    `);
  }

  async findReleaseNotes(component: string, version: string): Promise<ReleaseNotes | null> {
    const result = await this.db.execute(sql`
      select id, component, version, source_url, notes, breaking_changes, fetched_at
      from inventory_release_notes
      where component = ${component} and version = ${version}
      limit 1
    `);
    const row = rowsFrom(result)[0];
    return row ? releaseNotesFromRow(row) : null;
  }
}
