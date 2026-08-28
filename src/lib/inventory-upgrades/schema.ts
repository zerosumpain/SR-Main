import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const inventoryInstallations = pgTable(
  'inventory_installations',
  {
    id: text('id').primaryKey(),
    component: text('component').notNull(),
    environment: text('environment').notNull(),
    version: text('version').notNull(),
    sourceUrl: text('source_url'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('inventory_installations_component_environment_unique').on(
      table.component,
      table.environment
    ),
    index('inventory_installations_environment_idx').on(table.environment)
  ]
);

export const inventoryReleaseNotes = pgTable(
  'inventory_release_notes',
  {
    id: text('id').primaryKey(),
    component: text('component').notNull(),
    version: text('version').notNull(),
    sourceUrl: text('source_url').notNull(),
    notes: text('notes').notNull(),
    breakingChanges: jsonb('breaking_changes').$type<string[]>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('inventory_release_notes_component_version_unique').on(
      table.component,
      table.version
    )
  ]
);
