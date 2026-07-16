import type { NodeDefinition } from '../types';

const ARRAY_OPS = ['append', 'add_to_set'];
const VALUE_OPS = ['set', 'append', 'add_to_set', 'has'];

export const dataStoreDef: NodeDefinition = {
  type: 'data-store',
  label: 'Data Store',
  category: 'core',
  description:
    'Workflow-scoped key-value store. Persists across runs. Get/set plus atomic append, add-to-set (dedupe), has, increment, and delete.',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['get', 'set', 'append', 'add_to_set', 'has', 'increment', 'delete'],
        description:
          "'get' reads (with optional default + passthrough merge); 'set' overwrites; 'append' pushes onto a list; 'add_to_set' unions into a set (no duplicates); 'has' tests set membership; 'increment' adds to a counter; 'delete' removes the key. NOT 'read' / 'write' — those are rejected at save time.",
      },
      key: { type: 'string', description: 'Key name. Supports {{input.field}} templates.' },
      valuePath: {
        type: 'string',
        description:
          'Dot-path into input to extract the value to store / append / check. Defaults to input.value or the whole input.',
      },
      default: {
        description: 'get only — value returned when the key does not exist (instead of null).',
      },
      passthrough: {
        type: 'boolean',
        description:
          'get only — when true, output is the whole input merged with { [outputKey]: value, found } so a get never drops upstream data.',
      },
      outputKey: {
        type: 'string',
        description: "get + passthrough only — key under which the looked-up value is merged (default 'value').",
      },
      amount: {
        type: 'number',
        description: 'increment only — how much to add (default 1). Falls back to input.value / valuePath.',
      },
      maxItems: {
        type: 'number',
        description:
          'append / add_to_set only — cap the list to the most recent N elements (oldest trimmed) in the same atomic statement.',
      },
    },
    required: ['operation', 'key'],
  },
  defaultConfig: { operation: 'get', key: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  summarize: (config) => {
    const op = String(config.operation ?? 'get');
    const key = String(config.key ?? '').trim() || '(no key)';
    const verb: Record<string, string> = {
      get: 'Read',
      set: 'Write',
      append: 'Append to',
      add_to_set: 'Add to set',
      has: 'Check membership in',
      increment: 'Increment',
      delete: 'Delete',
    };
    return {
      line: `${verb[op] ?? op} data-store key "${key}"`,
      preview: { kind: 'db', details: { Operation: op, Key: key } },
    };
  },
  basicConfig: [
    {
      key: 'operation',
      label: 'Action',
      type: 'dropdown',
      description: 'What to do with the stored value.',
      options: [
        { value: 'get', label: 'Get (read value)' },
        { value: 'set', label: 'Set (overwrite value)' },
        { value: 'append', label: 'Append (push onto list)' },
        { value: 'add_to_set', label: 'Add to set (dedupe)' },
        { value: 'has', label: 'Has (set membership)' },
        { value: 'increment', label: 'Increment (counter)' },
        { value: 'delete', label: 'Delete (remove key)' },
      ],
    },
    {
      key: 'key',
      label: 'Key',
      type: 'template-textarea',
      description: 'Name of the stored item. Supports {{input.field}} templates so keys can be dynamic.',
      placeholder: 'last_run_timestamp',
    },
    {
      key: 'valuePath',
      label: 'Value Path',
      type: 'text',
      description:
        'Dot-path into the input to pick the value (e.g. data.count). Leave empty to use input.value or the whole input.',
      placeholder: 'data.count',
      visibleWhen: { key: 'operation', in: VALUE_OPS },
    },
    {
      key: 'amount',
      label: 'Amount',
      type: 'number',
      description: 'How much to add to the counter (default 1).',
      visibleWhen: { key: 'operation', equals: 'increment' },
    },
    {
      key: 'maxItems',
      label: 'Max items',
      type: 'number',
      description: 'Cap the list/set to the most recent N elements (oldest trimmed).',
      placeholder: '500',
      visibleWhen: { key: 'operation', in: ARRAY_OPS },
    },
    {
      key: 'default',
      label: 'Default',
      type: 'text',
      description: 'Value returned when the key is not found (get only).',
      visibleWhen: { key: 'operation', equals: 'get' },
    },
    {
      key: 'passthrough',
      label: 'Merge into input',
      type: 'toggle',
      description: 'Output the whole input with the looked-up value merged in (get only).',
      visibleWhen: { key: 'operation', equals: 'get' },
    },
    {
      key: 'outputKey',
      label: 'Output key',
      type: 'text',
      placeholder: 'value',
      description: 'Key the looked-up value is merged under when Merge-into-input is on.',
      visibleWhen: { key: 'operation', equals: 'get' },
    },
  ],
  llmDescription:
    "Workflow-scoped persistent key-value store. Survives across runs of the same workflow. Operations: " +
    "get (read; supports `default` for a fallback value and `passthrough:true` to merge the value into the input under `outputKey` (default 'value') so upstream data is NOT dropped); " +
    "set (overwrite); " +
    "append (atomically push a value onto a jsonb list — use for event logs / rolling history, optional `maxItems` keeps only the most recent N); " +
    "add_to_set (atomically union a value — or an array of values — into a set with NO duplicates; use for seen-id sets / cursors, optional `maxItems` bounds the set); " +
    "has (test set membership → { value: boolean }); " +
    "increment (atomically add `amount` (default 1) to a numeric counter); " +
    "delete (remove the key). " +
    "append/add_to_set/increment are atomic single SQL statements, safe when several nodes write the same key concurrently. " +
    "Common uses: cursors for incremental sync (set/get), seen-id sets to avoid re-processing (add_to_set + has, or the dedupe node), counters (increment). " +
    "Keys are listed in the prompt's Workspace Resources for the current workflow; reference them verbatim. Small JSON values only.",
  llmExamples: [
    { operation: 'get', key: 'last_processed_message_id' },
    { operation: 'get', key: 'cursor', default: '0', passthrough: true, outputKey: 'sinceId' },
    { operation: 'set', key: 'last_processed_message_id', valuePath: 'messageId' },
    { operation: 'add_to_set', key: 'seen_urls', valuePath: 'url', maxItems: 500 },
    { operation: 'has', key: 'seen_urls', valuePath: 'url' },
    { operation: 'increment', key: 'items_sent_total', amount: 1 },
    { operation: 'set', key: 'cursor_{{input.accountId}}', valuePath: 'data.historyId' },
  ],
};
