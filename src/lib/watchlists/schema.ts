import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,	varchar
} from 'drizzle-orm/pg-core';

export type WatchlistKind = 'retail' | 'package_holiday' | 'vehicle_valuation';
export type SourceKind = 'retailer' | 'travel' | 'vehicle_valuation';

export interface WatchCriteria {
	query?: string;
	retailerNames?: string[];
	sourceIds?: string[];
	maxPriceMinor?: number;
	minDiscountPercent?: number;
	exceptionalBelowMedianPercent?: number;
	currency?: string;
	destination?: string;
	departureAirport?: string;
	vehicleRegistration?: string;
	vehicleMakeModel?: string;
}

export const dealWatchlists = pgTable(
	'deal_watchlists',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id').notNull(),
		name: varchar('name', { length: 160 }).notNull(),
		kind: varchar('kind', { length: 32 }).$type<WatchlistKind>().notNull(),
		criteria: jsonb('criteria').$type<WatchCriteria>().notNull(),
		enabled: integer('enabled').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('deal_watchlists_user_enabled_idx').on(table.userId, table.enabled)]
);

export const watchlistSources = pgTable(
	'watchlist_sources',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: varchar('name', { length: 160 }).notNull(),
		kind: varchar('kind', { length: 32 }).$type<SourceKind>().notNull(),
		baseUrl: text('base_url').notNull(),
		enabled: integer('enabled').notNull().default(1),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('watchlist_sources_name_key').on(table.name)]
);

export const catalogueListings = pgTable(
	'catalogue_listings',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		sourceId: uuid('source_id').notNull().references(() => watchlistSources.id, { onDelete: 'cascade' }),
		externalId: varchar('external_id', { length: 512 }).notNull(),
		canonicalUrl: text('canonical_url').notNull(),
		title: text('title').notNull(),
		retailerName: varchar('retailer_name', { length: 160 }),
		currency: varchar('currency', { length: 3 }).notNull(),
		attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
		firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('catalogue_listings_source_external_key').on(table.sourceId, table.externalId),
		index('catalogue_listings_source_seen_idx').on(table.sourceId, table.lastSeenAt)
	]
);

export const listingPriceHistory = pgTable(
	'listing_price_history',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		listingId: uuid('listing_id').notNull().references(() => catalogueListings.id, { onDelete: 'cascade' }),
		priceMinor: integer('price_minor').notNull(),
		originalPriceMinor: integer('original_price_minor'),
		availability: varchar('availability', { length: 32 }).notNull().default('available'),
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('listing_price_history_listing_observed_key').on(table.listingId, table.observedAt),
		index('listing_price_history_listing_price_idx').on(table.listingId, table.priceMinor)
	]
);

export const watchlistAlerts = pgTable(
	'watchlist_alerts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		watchlistId: uuid('watchlist_id').notNull().references(() => dealWatchlists.id, { onDelete: 'cascade' }),
		listingId: uuid('listing_id').notNull().references(() => catalogueListings.id, { onDelete: 'cascade' }),
		priceHistoryId: uuid('price_history_id').references(() => listingPriceHistory.id, { onDelete: 'set null' }),
		fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
		reason: text('reason').notNull(),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('watchlist_alerts_fingerprint_key').on(table.fingerprint),
		index('watchlist_alerts_watchlist_created_idx').on(table.watchlistId, table.createdAt)
	]
);
