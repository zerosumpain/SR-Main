import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const dealRequirements = pgTable('deal_requirements', {
	id: uuid('id').defaultRandom().primaryKey(),
	kind: text('kind', { enum: ['pc', 'travel'] }).notNull(),
	name: text('name').notNull(),
	criteria: text('criteria').notNull(),
	currency: text('currency').notNull(),
	notificationThresholdMinor: integer('notification_threshold_minor').notNull(),
	isActive: integer('is_active').notNull().default(1),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const retailerSources = pgTable(
	'retailer_sources',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		requirementId: uuid('requirement_id')
			.notNull()
			.references(() => dealRequirements.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		baseUrl: text('base_url').notNull(),
		isActive: integer('is_active').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('retailer_sources_requirement_name_unique').on(table.requirementId, table.name)]
);

export const dealListings = pgTable(
	'deal_listings',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		requirementId: uuid('requirement_id')
			.notNull()
			.references(() => dealRequirements.id, { onDelete: 'cascade' }),
		retailerSourceId: uuid('retailer_source_id')
			.notNull()
			.references(() => retailerSources.id, { onDelete: 'cascade' }),
		fingerprint: text('fingerprint').notNull(),
		externalId: text('external_id').notNull(),
		title: text('title').notNull(),
		url: text('url').notNull(),
		priceMinor: integer('price_minor').notNull(),
		currency: text('currency').notNull(),
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('deal_listings_requirement_fingerprint_unique').on(table.requirementId, table.fingerprint),
		index('deal_listings_requirement_price_idx').on(table.requirementId, table.priceMinor)
	]
);

export const dealPriceHistory = pgTable(
	'deal_price_history',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		listingId: uuid('listing_id')
			.notNull()
			.references(() => dealListings.id, { onDelete: 'cascade' }),
		priceMinor: integer('price_minor').notNull(),
		currency: text('currency').notNull(),
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull()
	},
	(table) => [index('deal_price_history_listing_observed_idx').on(table.listingId, table.observedAt)]
);

export const dealNotificationDeliveries = pgTable(
	'deal_notification_deliveries',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		listingId: uuid('listing_id')
			.notNull()
			.references(() => dealListings.id, { onDelete: 'cascade' }),
		priceHistoryId: uuid('price_history_id').references(() => dealPriceHistory.id, { onDelete: 'set null' }),
		thresholdMinor: integer('threshold_minor').notNull(),
		deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('deal_notification_deliveries_listing_idx').on(table.listingId)]
);
