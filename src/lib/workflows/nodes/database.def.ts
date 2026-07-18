import type { NodeDefinition } from '../types';

// Op groupings used for `visibleWhen` on the basic-config form.
const AUTOCREATE_OPS = ['insert', 'upsert'];
const KEY_OPS = ['upsert', 'get', 'update', 'patch', 'delete'];
const DATA_OPS = ['insert', 'upsert', 'update'];
const FILTER_OPS = ['query', 'count', 'aggregate'];
const QUERY_OPS = ['query'];
const AGGREGATE_OPS = ['aggregate'];
const WRITE_PERMS_OPS = ['insert', 'upsert', 'update', 'patch'];
const VERSION_OPS = ['update', 'patch'];

/**
 * `database` — full-CRUD access to the permanent, sitewide datastore
 * (`$lib/datastore` collections + jsonb records). Distinct from the
 * per-workflow `data-store` KV node: data written here persists permanently,
 * is queryable with a filter DSL + aggregates, carries row-level permissions,
 * and is shared across every workflow / jkai chat / the admin UI.
 */
export const databaseDef: NodeDefinition = {
  type: 'database',
  label: 'Database',
  category: 'integration',
  description:
    'Permanent, sitewide datastore. Full CRUD over jsonb records in named collections: insert / upsert / get / query (filter DSL) / update / patch / delete / count / aggregate. Shared across workflows (unlike the per-workflow Data store).',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['insert', 'upsert', 'get', 'query', 'update', 'patch', 'delete', 'count', 'aggregate'],
        description:
          "insert (add a record); upsert (insert or overwrite by key); get (read one by key); query (filter DSL + sort + paging); update (replace a record's data by key); patch (shallow-merge fields by key); delete (remove one by key); count (matching-record count); aggregate (count/sum/avg/min/max over a numeric path, optional groupBy).",
      },
      collection: {
        type: 'string',
        description: 'Collection slug (lowercase, hyphen/underscore). Supports {{input.field}} templates.',
      },
      autoCreate: {
        type: 'boolean',
        description: 'insert/upsert only — create the collection if it does not exist yet (default true).',
      },
      key: {
        type: 'string',
        description: 'Natural key of the record (for upsert/get/update/patch/delete). Supports {{input.field}} templates.',
      },
      data: {
        type: 'string',
        description: 'JSON object of the record body (insert/upsert/update). Supports {{input.field}} templates.',
      },
      patch: {
        type: 'string',
        description: 'patch only — JSON object of fields to shallow-merge onto the existing record. Supports templates.',
      },
      filters: {
        type: 'string',
        description:
          'query/count/aggregate — JSON array of { path, op, value } filters. op ∈ eq|ne|gt|gte|lt|lte|contains|exists|in. path is a dot-path into the record data (e.g. "status" or "meta.year").',
      },
      sortField: {
        type: 'string',
        enum: ['createdAt', 'updatedAt', 'key'],
        description: 'query — sort by a built-in column. Ignored when Sort path is set.',
      },
      sortPath: {
        type: 'string',
        description: 'query — sort by a dot-path into the record data (overrides Sort field).',
      },
      sortDir: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'query — sort direction (default desc).',
      },
      limit: { type: 'number', description: 'query — max records to return (1–500, default 100).' },
      offset: { type: 'number', description: 'query — number of records to skip.' },
      aggregateOp: {
        type: 'string',
        enum: ['count', 'sum', 'avg', 'min', 'max'],
        description: 'aggregate — the aggregation function.',
      },
      aggregatePath: {
        type: 'string',
        description: 'aggregate — dot-path to the numeric field (required for sum/avg/min/max).',
      },
      groupBy: {
        type: 'string',
        description: 'aggregate — optional dot-path to group results by.',
      },
      permissions: {
        type: 'string',
        description:
          'Writes — optional JSON row-level permissions { read?: string[], write?: string[], delete?: string[] } using actor strings (owner, jkai, system, workflow:<id>, workflow:*, *).',
      },
      expectedVersion: {
        type: 'number',
        description: 'update/patch — optimistic concurrency guard: fail with a conflict if the stored version differs.',
      },
      outputKey: {
        type: 'string',
        description: "Key under which the result is placed on the output (default 'records' for query, 'record' for get/writes, 'result' otherwise).",
      },
    },
    required: ['operation', 'collection'],
  },
  defaultConfig: { operation: 'query', collection: '', autoCreate: true },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  summarize: (config) => {
    const op = String(config.operation ?? 'query');
    const collection = String(config.collection ?? '').trim() || '(no collection)';
    const key = String(config.key ?? '').trim();
    const details: Record<string, string> = { Operation: op, Collection: collection };
    if (KEY_OPS.includes(op) && key) details.Key = key;
    let line: string;
    switch (op) {
      case 'query':
        line = `Query "${collection}"`;
        break;
      case 'count':
        line = `Count records in "${collection}"`;
        break;
      case 'aggregate':
        line = `Aggregate (${String(config.aggregateOp ?? 'count')}) over "${collection}"`;
        break;
      case 'get':
        line = `Get "${key || '?'}" from "${collection}"`;
        break;
      case 'delete':
        line = `Delete "${key || '?'}" from "${collection}"`;
        break;
      case 'insert':
        line = `Insert a record into "${collection}"`;
        break;
      case 'upsert':
        line = `Upsert "${key || '?'}" into "${collection}"`;
        break;
      case 'update':
        line = `Update "${key || '?'}" in "${collection}"`;
        break;
      case 'patch':
        line = `Patch "${key || '?'}" in "${collection}"`;
        break;
      default:
        line = `${op} "${collection}"`;
    }
    return { line, preview: { kind: 'db', details } };
  },
  basicConfig: [
    {
      key: 'operation',
      label: 'Operation',
      type: 'dropdown',
      description: 'What to do against the datastore.',
      options: [
        { value: 'insert', label: 'Insert (add a record)' },
        { value: 'upsert', label: 'Upsert (insert or overwrite by key)' },
        { value: 'get', label: 'Get (read one by key)' },
        { value: 'query', label: 'Query (filter DSL)' },
        { value: 'update', label: 'Update (replace data by key)' },
        { value: 'patch', label: 'Patch (merge fields by key)' },
        { value: 'delete', label: 'Delete (remove by key)' },
        { value: 'count', label: 'Count (matching records)' },
        { value: 'aggregate', label: 'Aggregate (sum/avg/…)' },
      ],
    },
    {
      key: 'collection',
      label: 'Collection',
      type: 'template-textarea',
      description: 'Collection slug. Supports {{input.field}} templates.',
      placeholder: 'notes',
    },
    {
      key: 'autoCreate',
      label: 'Auto-create collection',
      type: 'toggle',
      description: 'Create the collection on first write if it does not exist.',
      visibleWhen: { key: 'operation', in: AUTOCREATE_OPS },
    },
    {
      key: 'key',
      label: 'Key',
      type: 'template-textarea',
      description: 'Natural key of the record. Supports {{input.field}} templates.',
      placeholder: '{{input.id}}',
      visibleWhen: { key: 'operation', in: KEY_OPS },
    },
    {
      key: 'data',
      label: 'Data (JSON)',
      type: 'template-textarea',
      description: 'JSON object of the record body. Supports {{input.field}} templates.',
      placeholder: '{ "title": "{{input.title}}", "status": "open" }',
      visibleWhen: { key: 'operation', in: DATA_OPS },
    },
    {
      key: 'patch',
      label: 'Patch (JSON)',
      type: 'template-textarea',
      description: 'JSON object of fields to shallow-merge onto the existing record.',
      placeholder: '{ "status": "done" }',
      visibleWhen: { key: 'operation', in: ['patch'] },
    },
    {
      key: 'filters',
      label: 'Filters (JSON)',
      type: 'code',
      language: 'json',
      description:
        'JSON array of { path, op, value }. op ∈ eq|ne|gt|gte|lt|lte|contains|exists|in.',
      placeholder: '[ { "path": "status", "op": "eq", "value": "open" } ]',
      visibleWhen: { key: 'operation', in: FILTER_OPS },
    },
    {
      key: 'sortField',
      label: 'Sort field',
      type: 'dropdown',
      description: 'Sort by a built-in column (ignored when Sort path is set).',
      options: [
        { value: 'updatedAt', label: 'Updated at' },
        { value: 'createdAt', label: 'Created at' },
        { value: 'key', label: 'Key' },
      ],
      visibleWhen: { key: 'operation', in: QUERY_OPS },
    },
    {
      key: 'sortPath',
      label: 'Sort path',
      type: 'text',
      description: 'Sort by a dot-path into the record data (overrides Sort field).',
      placeholder: 'meta.year',
      visibleWhen: { key: 'operation', in: QUERY_OPS },
    },
    {
      key: 'sortDir',
      label: 'Sort direction',
      type: 'dropdown',
      options: [
        { value: 'desc', label: 'Descending' },
        { value: 'asc', label: 'Ascending' },
      ],
      visibleWhen: { key: 'operation', in: QUERY_OPS },
    },
    {
      key: 'limit',
      label: 'Limit',
      type: 'number',
      description: 'Max records to return (1–500, default 100).',
      placeholder: '100',
      visibleWhen: { key: 'operation', in: QUERY_OPS },
    },
    {
      key: 'offset',
      label: 'Offset',
      type: 'number',
      description: 'Records to skip.',
      placeholder: '0',
      visibleWhen: { key: 'operation', in: QUERY_OPS },
    },
    {
      key: 'aggregateOp',
      label: 'Aggregate function',
      type: 'dropdown',
      options: [
        { value: 'count', label: 'Count' },
        { value: 'sum', label: 'Sum' },
        { value: 'avg', label: 'Average' },
        { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' },
      ],
      visibleWhen: { key: 'operation', in: AGGREGATE_OPS },
    },
    {
      key: 'aggregatePath',
      label: 'Aggregate path',
      type: 'text',
      description: 'Dot-path to the numeric field (required for sum/avg/min/max).',
      placeholder: 'amount',
      visibleWhen: { key: 'operation', in: AGGREGATE_OPS },
    },
    {
      key: 'groupBy',
      label: 'Group by',
      type: 'text',
      description: 'Optional dot-path to group aggregate results by.',
      placeholder: 'status',
      visibleWhen: { key: 'operation', in: AGGREGATE_OPS },
    },
    {
      key: 'permissions',
      label: 'Row permissions (JSON)',
      type: 'textarea',
      advancedOnly: true,
      description:
        'Optional { read?, write?, delete? } actor lists on this record. Actors: owner, jkai, system, workflow:<id>, workflow:*, *.',
      placeholder: '{ "read": ["*"], "write": ["owner", "workflow:*"] }',
      visibleWhen: { key: 'operation', in: WRITE_PERMS_OPS },
    },
    {
      key: 'expectedVersion',
      label: 'Expected version',
      type: 'number',
      advancedOnly: true,
      description: 'Optimistic concurrency: fail if the stored version differs.',
      visibleWhen: { key: 'operation', in: VERSION_OPS },
    },
    {
      key: 'outputKey',
      label: 'Output key',
      type: 'text',
      advancedOnly: true,
      description: "Key the result is placed under (default records/record/result by operation).",
    },
  ],
  llmDescription:
    'Full-CRUD access to the PERMANENT, SITEWIDE datastore — named collections of jsonb records that persist forever and are shared across every workflow, jkai chat, and the admin UI. This is distinct from the `data-store` node (which is a per-workflow key-value scratchpad). Use `database` for durable structured data you want to query later or share between workflows (e.g. a catalogue, a ledger, tracked entities). ' +
    'Operations: ' +
    'insert (add a record; optional `key`, `data` JSON object, optional row `permissions`); ' +
    'upsert (insert-or-overwrite by natural `key` — the idempotent write, use this for recurring syncs); ' +
    'get (read one record by `key` → { record, found }); ' +
    'query (filter with `filters` — a JSON array of { path, op, value } where op ∈ eq|ne|gt|gte|lt|lte|contains|exists|in — plus `sortField`/`sortPath`/`sortDir`, `limit`, `offset` → { records, count }); ' +
    'update (replace a record\'s `data` by `key`); ' +
    'patch (shallow-merge `patch` fields onto an existing record by `key`); ' +
    'delete (remove one record by `key`); ' +
    'count (number of records matching `filters`); ' +
    'aggregate (`aggregateOp` count/sum/avg/min/max over `aggregatePath`, optional `groupBy`). ' +
    'insert/upsert auto-create the collection by default (`autoCreate`). `collection`, `key`, `data`, `patch`, and `filters` all support {{input.field}} templates. Writes honour dry-run (they are simulated, not executed). ' +
    'Prefer upsert with a stable natural `key` so re-runs update the same row instead of duplicating.',
  llmExamples: [
    { operation: 'upsert', collection: 'notes', key: '{{input.id}}', data: '{ "title": "{{input.title}}", "status": "open" }' },
    { operation: 'query', collection: 'notes', filters: '[{ "path": "status", "op": "eq", "value": "open" }]', sortField: 'updatedAt', sortDir: 'desc', limit: 20 },
    { operation: 'get', collection: 'notes', key: '{{input.id}}' },
    { operation: 'patch', collection: 'notes', key: '{{input.id}}', patch: '{ "status": "done" }' },
    { operation: 'count', collection: 'notes', filters: '[{ "path": "status", "op": "eq", "value": "open" }]' },
    { operation: 'aggregate', collection: 'orders', aggregateOp: 'sum', aggregatePath: 'total', groupBy: 'customer' },
    { operation: 'insert', collection: 'events', data: '{ "kind": "signup", "at": "{{input.timestamp}}" }' },
    { operation: 'delete', collection: 'notes', key: '{{input.id}}' },
  ],
};
