# Curate Codegen (Plan B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the codegen layer that emits a complete repo node from a canonical spec — definition, executor, Svelte panel, sr-docs markdown, plus targeted patches to `panels/registry.ts` and `workflows/index.ts`. Golden-file tests validate every emitter against an Apple Calendar fixture spec. After this plan, the curate engine (B3) can call `writeNodeFiles(spec, worktreeDir)` and get back a fully wired-up node ready for `npm run dev`.

**Architecture:** A canonical `NodeSpec` object (defined in `src/lib/curate/spec/types.ts`) drives everything. The `uiSchema` field on the spec describes the panel's UI as data — sections, fields, banners, actions — and the panel emitter translates this declaratively into a real Svelte 5 component. Each output file gets its own pure emitter function (`emitDefinition(spec): string`, `emitExecutor(spec): string`, etc.). A `writeNodeFiles(spec, dest)` orchestrator runs the emitters and writes the output to disk, including idempotent patches to two existing files.

**Tech Stack:** TypeScript, vitest with `toMatchFileSnapshot` (golden files in `tests/__fixtures__/curate-codegen/`), Svelte 5 runes idioms.

**Reference spec:** `docs/plans/curate-experience.md` §4.1 (canonical node spec), §4.2 (uiSchema), §4.7 (documentation generation).

**Reference code:**
- Existing definition pattern: `src/lib/workflows/nodes/gmail-send.def.ts`
- Existing executor pattern: `src/lib/workflows/nodes/gmail-send.ts`
- Existing specialized panel: `src/lib/canvas/nodes/panels/GmailSendPanel.svelte`
- Existing sr-docs node page: `~/sr-docs/content/internal/features/workflows/nodes-comms.md`

---

## Scope decisions

For v1, the panel emitter supports only the widget set Plan A actually shipped:

- Basic widgets: `string`, `textarea`, `dropdown`, `toggle`, `datetime`
- `credential-picker` (Plan A widget)
- `resource-picker` (existing in `shared/`)
- `template-string` (= existing `TemplatedInput` in `shared/`)
- Status banners: `credential-status` (Plan A widget)
- Actions: `test-connection` (Plan A widget)
- Layouts: `single` (default), `two-column`

Out of scope for v1 (deferred to a future plan): `key-value-list`, `code-block`, `enum-with-icons`, `tabs` layout, custom action buttons beyond `test-connection`.

The Apple Calendar fixture only uses the v1 widget set, so codegen is fully exercised end-to-end.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/lib/curate/spec/types.ts` | `NodeSpec`, `UISchema`, `UISchemaSection`, `UISchemaField`, widget union types, `Condition` shape, `OptionsResolverSpec`. |
| `src/lib/curate/spec/validate.ts` | `validateNodeSpec(spec): { ok: true } | { ok: false; errors: string[] }`. Cheap structural validation. |
| `src/lib/curate/codegen/definition.ts` | `emitDefinition(spec): string` — produces `<type>.def.ts` source. |
| `src/lib/curate/codegen/executor.ts` | `emitExecutor(spec): string` — produces `<type>.ts` source. |
| `src/lib/curate/codegen/panel.ts` | `emitPanel(spec): string` — produces `<Type>Panel.svelte` source from `uiSchema`. |
| `src/lib/curate/codegen/docs.ts` | `emitDocs(spec): string` — produces sr-docs markdown. |
| `src/lib/curate/codegen/registry-patch.ts` | `patchPanelRegistry(existing, spec): string` — idempotent insert into panels/registry.ts. |
| `src/lib/curate/codegen/index-patch.ts` | `patchWorkflowsIndex(existing, spec): string` — idempotent insert into workflows/index.ts. |
| `src/lib/curate/codegen/write-files.ts` | `writeNodeFiles(spec, worktreeDir, srDocsDir): Promise<{ written: string[] }>` — orchestrates the emitters and patches, writing to disk. |
| `src/lib/curate/codegen/index.ts` | Barrel. |
| `tests/__fixtures__/curate-codegen/apple-calendar.spec.ts` | Fixture spec (Apple Calendar / CalDAV). Imported by golden tests. |
| `tests/__fixtures__/curate-codegen/expected/apple-calendar.def.ts.txt` | Golden output for definition emitter. |
| `tests/__fixtures__/curate-codegen/expected/apple-calendar.ts.txt` | Golden output for executor emitter. |
| `tests/__fixtures__/curate-codegen/expected/AppleCalendarPanel.svelte.txt` | Golden output for panel emitter. |
| `tests/__fixtures__/curate-codegen/expected/apple-calendar.md.txt` | Golden output for docs emitter. |
| `tests/__fixtures__/curate-codegen/expected/registry-patched.ts.txt` | Golden output for the registry patch (with the apple-calendar entry inserted into a sample base file). |
| `tests/__fixtures__/curate-codegen/expected/index-patched.ts.txt` | Golden output for the workflows/index patch. |
| `tests/__fixtures__/curate-codegen/registry-base.ts.txt` | Sample BASE file for registry patch tests. |
| `tests/__fixtures__/curate-codegen/index-base.ts.txt` | Sample BASE file for index patch tests. |
| `tests/lib/curate/codegen/definition.test.ts` | Golden test: spec → emitDefinition → match. |
| `tests/lib/curate/codegen/executor.test.ts` | Golden test for executor emitter. |
| `tests/lib/curate/codegen/panel.test.ts` | Golden test for panel emitter. |
| `tests/lib/curate/codegen/docs.test.ts` | Golden test for docs emitter. |
| `tests/lib/curate/codegen/registry-patch.test.ts` | Patch idempotency + golden output. |
| `tests/lib/curate/codegen/index-patch.test.ts` | Patch idempotency + golden output. |
| `tests/lib/curate/codegen/validate.test.ts` | Validator: positive + negative cases. |
| `tests/lib/curate/codegen/write-files.test.ts` | Full integration: writes to a temp dir, asserts every file. |

### Files NOT modified in this plan

The codegen runs in-memory and writes to a temporary curate-session worktree (Plan B3 will wire that up). It does NOT modify the live `src/lib/canvas/nodes/panels/registry.ts` or `src/lib/workflows/index.ts` during testing — the patch tests use fixture base files.

---

## Pre-flight

No env-var changes. No DB changes.

- [ ] **Step 0: Branch setup** — controller creates worktree `feature/curate-codegen` off latest master.

---

## Phase 1 — Canonical spec types

### Task 1: NodeSpec + UISchema types

**Files:**
- Create: `src/lib/curate/spec/types.ts`

- [ ] **Step 1: Implement**

Create `src/lib/curate/spec/types.ts`:

```ts
// ── Canonical node spec ────────────────────────────────────────────────
//
// One in-memory object that drives all five emitters (definition, executor,
// panel, docs, registry/index patches). The curate engine builds a NodeSpec
// during the discovery phase and hands it to writeNodeFiles().

export interface NodeSpec {
  /** kebab-case id, e.g. 'apple-calendar'. Used for filenames + node `type` field. */
  type: string;

  /** Human label shown in the canvas node menu, e.g. 'Apple Calendar'. */
  label: string;

  /** Category for grouping in the node menu. */
  category: string;

  /** One-line description (canvas + sr-docs intro). */
  description: string;

  /** Detailed rationale for when the LLM should choose this node. */
  llmDescription: string;

  /** Worked examples the orchestrator can borrow when wiring this node. */
  llmExamples: NodeExample[];

  /** JSON Schema for inbound input. */
  inputSchema: JsonSchema;

  /** JSON Schema for outbound output. */
  outputSchema: JsonSchema;

  /** JSON Schema for the config blob. Mirrors uiSchema fields. */
  configSchema: JsonSchema;

  /** Default config when a fresh node is dropped on the canvas. */
  defaultConfig: Record<string, unknown>;

  /** Declarative description of the panel UI. Drives the panel emitter. */
  uiSchema: UISchema;

  /**
   * Body of the executor's `execute` function. May reference helpers
   * imported by the executor emitter (db, getCredential, etc.).
   * Plain TypeScript source string.
   */
  executorBody: string;

  /** npm packages required by the executor. e.g. [{ name: 'tsdav', version: '^2.0.0' }]. */
  deps: NodeDep[];

  /** Markdown source for sr-docs entry + (excerpted) in-canvas help drawer. */
  docs: string;

  /**
   * Optional: how to resolve options for `resource-picker` widgets at runtime.
   * Each entry registers a function on the integration adapter.
   */
  optionsResolvers?: OptionsResolverSpec[];

  /**
   * If the node uses an oauth2 credential, this declares the OAuth flow.
   * The curate engine writes a row to integrationOauthConfigs for it.
   */
  oauthSpec?: OAuthSpec;

  /**
   * Identifies the integration this node belongs to (e.g. 'apple-calendar').
   * Used by CredentialPicker to filter credentials.
   */
  integrationType?: string;

  /** Optional: short JS source for a one-line canvas summary string. */
  summarize?: string;
}

export interface NodeExample {
  scenario: string;
  config: Record<string, unknown>;
  notes?: string;
}

export type JsonSchema = Record<string, unknown>;

export interface NodeDep {
  name: string;
  version: string;
}

export interface OptionsResolverSpec {
  /** Field name on the panel that this resolver populates. */
  fieldName: string;
  /**
   * Function body. Receives `credentialId` from the panel and returns
   * `Promise<{ value: string; label: string }[]>`. Plain TS source.
   */
  body: string;
}

export interface OAuthSpec {
  authorizationUrl: string;
  tokenUrl: string;
  defaultScopes: string[];
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
}

// ── UI schema ──────────────────────────────────────────────────────────

export interface UISchema {
  layout: 'single' | 'two-column';
  sections: UISchemaSection[];
  banners?: UISchemaBanner[];
  actions?: UISchemaAction[];
}

export interface UISchemaSection {
  title: string;
  intro?: string; // markdown shown under the title
  showWhen?: Condition;
  fields: UISchemaField[];
}

export type UISchemaField =
  | StringField
  | TextareaField
  | DropdownField
  | ToggleField
  | DatetimeField
  | CredentialPickerField
  | ResourcePickerField
  | TemplateStringField;

interface FieldBase {
  /** Config key. Must match a key in configSchema.properties. */
  key: string;
  label: string;
  description?: string;
  showWhen?: Condition;
  required?: boolean;
}

export interface StringField extends FieldBase {
  widget: 'string';
  placeholder?: string;
}

export interface TextareaField extends FieldBase {
  widget: 'textarea';
  placeholder?: string;
  rows?: number;
}

export interface DropdownField extends FieldBase {
  widget: 'dropdown';
  options: { value: string; label: string }[];
}

export interface ToggleField extends FieldBase {
  widget: 'toggle';
}

export interface DatetimeField extends FieldBase {
  widget: 'datetime';
}

export interface CredentialPickerField extends FieldBase {
  widget: 'credential-picker';
  /** integrationType to filter by. Usually equals the spec's integrationType. */
  integrationType: string;
}

export interface ResourcePickerField extends FieldBase {
  widget: 'resource-picker';
  /**
   * The credential field (key) this resource-picker depends on.
   * The picker disables until that credential is selected.
   */
  credentialKey: string;
  /** integrationType is forwarded to /api/integrations/options/[type]/[fieldName]. */
  integrationType: string;
}

export interface TemplateStringField extends FieldBase {
  widget: 'template-string';
  placeholder?: string;
}

export interface UISchemaBanner {
  kind: 'credential-status';
  /** The config field whose value is the credentialId to check. */
  credentialField: string;
}

export interface UISchemaAction {
  kind: 'test-connection';
  /** Where in the UI to render: 'top' (above sections) | 'inline' (in a section). */
  placement: 'top' | 'inline';
  /** Required if placement='inline'. */
  sectionTitle?: string;
  /** integrationType forwarded to /api/integrations/test/[type]. */
  integrationType: string;
  /** The config field whose value is the credentialId to test. */
  credentialField: string;
}

// ── Conditionals ───────────────────────────────────────────────────────

export type Condition =
  | { kind: 'eq'; field: string; value: unknown }
  | { kind: 'neq'; field: string; value: unknown }
  | { kind: 'in'; field: string; values: unknown[] }
  | { kind: 'not-in'; field: string; values: unknown[] }
  | { kind: 'and'; conditions: Condition[] }
  | { kind: 'or'; conditions: Condition[] };
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "src/lib/curate/spec/types" || echo "(no errors)"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/curate/spec/types.ts
git commit -m "feat(curate): canonical NodeSpec + UISchema types"
```

---

## Phase 2 — Spec validator

### Task 2: validateNodeSpec + tests

**Files:**
- Create: `src/lib/curate/spec/validate.ts`
- Test: `tests/lib/curate/codegen/validate.test.ts`

- [ ] **Step 1: Test first (5 cases)**

```ts
import { describe, it, expect } from 'vitest';
import type { NodeSpec } from '$lib/curate/spec/types';

const validSpec: NodeSpec = {
  type: 'test-node',
  label: 'Test',
  category: 'integrations',
  description: 'A test node',
  llmDescription: 'Use this for testing',
  llmExamples: [],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  configSchema: { type: 'object', properties: { x: { type: 'string' } } },
  defaultConfig: { x: '' },
  uiSchema: {
    layout: 'single',
    sections: [{ title: 'Main', fields: [{ key: 'x', label: 'X', widget: 'string' }] }],
  },
  executorBody: 'return { ok: true };',
  deps: [],
  docs: '## When to use\nFor testing.',
};

describe('validateNodeSpec', () => {
  it('accepts a valid spec', async () => {
    const { validateNodeSpec } = await import('$lib/curate/spec/validate');
    const r = validateNodeSpec(validSpec);
    expect(r.ok).toBe(true);
  });

  it('rejects type with non-kebab-case', async () => {
    const { validateNodeSpec } = await import('$lib/curate/spec/validate');
    const r = validateNodeSpec({ ...validSpec, type: 'TestNode' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/kebab-case/i);
  });

  it('rejects empty label', async () => {
    const { validateNodeSpec } = await import('$lib/curate/spec/validate');
    const r = validateNodeSpec({ ...validSpec, label: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects field with key not in configSchema.properties', async () => {
    const { validateNodeSpec } = await import('$lib/curate/spec/validate');
    const bad: NodeSpec = {
      ...validSpec,
      uiSchema: {
        layout: 'single',
        sections: [{ title: 'Main', fields: [{ key: 'unknown', label: 'X', widget: 'string' }] }],
      },
    };
    const r = validateNodeSpec(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/unknown/);
  });

  it('rejects oauth2 spec missing oauthSpec', async () => {
    const { validateNodeSpec } = await import('$lib/curate/spec/validate');
    const bad: NodeSpec = {
      ...validSpec,
      uiSchema: {
        layout: 'single',
        sections: [{
          title: 'Main',
          fields: [{
            key: 'cred', label: 'Credential', widget: 'credential-picker',
            integrationType: 'foo',
          }],
        }],
      },
      configSchema: { type: 'object', properties: { cred: { type: 'string' }, x: { type: 'string' } } },
      integrationType: 'foo',
    };
    // Just ensure it accepts cred-picker fields:
    const r = validateNodeSpec(bad);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm test -- tests/lib/curate/codegen/validate.test.ts
```

- [ ] **Step 3: Implement**

```ts
import type { NodeSpec, UISchemaField, Condition } from './types';

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const KEBAB_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

export function validateNodeSpec(spec: NodeSpec): ValidationResult {
  const errors: string[] = [];

  if (!KEBAB_RE.test(spec.type)) errors.push(`type "${spec.type}" must be kebab-case`);
  if (!spec.label.trim()) errors.push('label must be non-empty');
  if (!spec.category.trim()) errors.push('category must be non-empty');
  if (!spec.description.trim()) errors.push('description must be non-empty');
  if (!spec.executorBody.trim()) errors.push('executorBody must be non-empty');

  // Walk uiSchema fields and verify each key exists in configSchema.properties.
  const props = (spec.configSchema as { properties?: Record<string, unknown> }).properties ?? {};
  const fieldKeysInUI = collectUiKeys(spec.uiSchema.sections.flatMap((s) => s.fields));
  for (const key of fieldKeysInUI) {
    if (!(key in props)) errors.push(`uiSchema field "${key}" is not in configSchema.properties`);
  }

  // Walk conditions and confirm referenced fields exist somewhere.
  const allKeys = new Set(Object.keys(props));
  for (const section of spec.uiSchema.sections) {
    if (section.showWhen) checkCondition(section.showWhen, allKeys, errors);
    for (const field of section.fields) {
      if (field.showWhen) checkCondition(field.showWhen, allKeys, errors);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function collectUiKeys(fields: UISchemaField[]): string[] {
  return fields.map((f) => f.key);
}

function checkCondition(c: Condition, knownKeys: Set<string>, errors: string[]): void {
  if (c.kind === 'and' || c.kind === 'or') {
    for (const sub of c.conditions) checkCondition(sub, knownKeys, errors);
    return;
  }
  if (!knownKeys.has(c.field)) errors.push(`condition references unknown field "${c.field}"`);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm test -- tests/lib/curate/codegen/validate.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/curate/spec/validate.ts tests/lib/curate/codegen/validate.test.ts
git commit -m "feat(curate): NodeSpec structural validator"
```

---

## Phase 3 — Apple Calendar fixture spec

### Task 3: Fixture spec used by all golden tests

**Files:**
- Create: `tests/__fixtures__/curate-codegen/apple-calendar.spec.ts`

- [ ] **Step 1: Implement the fixture**

This single file gets imported by every golden test in this plan. It exercises the full v1 widget set (string, dropdown, toggle, datetime, credential-picker, resource-picker, template-string) plus conditionals + a credential-status banner + a test-connection action.

```ts
import type { NodeSpec } from '$lib/curate/spec/types';

export const appleCalendarSpec: NodeSpec = {
  type: 'apple-calendar',
  label: 'Apple Calendar',
  category: 'integrations',
  description: 'Read and write events on iCloud calendars via CalDAV.',
  llmDescription:
    'Use to fetch events for a date range or to create / update / delete events on an iCloud calendar. ' +
    'Authenticated via app-specific password (basic auth, kind=basic in integrationCredentials).',
  llmExamples: [
    {
      scenario: 'List events in the next 7 days',
      config: { credentialId: '<id>', operation: 'list', dateRangeStart: '{{today}}', dateRangeEnd: '{{nextWeek}}' },
    },
    {
      scenario: 'Create a 1-hour event tomorrow at 10am',
      config: {
        credentialId: '<id>', operation: 'create',
        eventTitle: 'Standup', eventStart: '{{tomorrow10am}}', eventEnd: '{{tomorrow11am}}',
      },
    },
  ],
  inputSchema: { type: 'object', additionalProperties: true },
  outputSchema: {
    type: 'object',
    properties: {
      events: { type: 'array' },
      id: { type: 'string' },
      url: { type: 'string' },
      etag: { type: 'string' },
    },
  },
  configSchema: {
    type: 'object',
    properties: {
      credentialId: { type: 'string' },
      operation: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
      calendar: { type: 'string' },
      dateRangeStart: { type: 'string' },
      dateRangeEnd: { type: 'string' },
      eventTitle: { type: 'string' },
      eventStart: { type: 'string' },
      eventEnd: { type: 'string' },
      eventLocation: { type: 'string' },
      eventNotes: { type: 'string' },
      eventId: { type: 'string' },
    },
    required: ['credentialId', 'operation', 'calendar'],
  },
  defaultConfig: { operation: 'list' },
  integrationType: 'apple-calendar',
  uiSchema: {
    layout: 'single',
    banners: [{ kind: 'credential-status', credentialField: 'credentialId' }],
    actions: [{
      kind: 'test-connection',
      placement: 'top',
      integrationType: 'apple-calendar',
      credentialField: 'credentialId',
    }],
    sections: [
      {
        title: 'Connection',
        intro: 'Pick the iCloud account and calendar to operate on.',
        fields: [
          { key: 'credentialId', label: 'iCloud account', widget: 'credential-picker', integrationType: 'apple-calendar', required: true },
          { key: 'calendar', label: 'Calendar', widget: 'resource-picker', credentialKey: 'credentialId', integrationType: 'apple-calendar', required: true },
        ],
      },
      {
        title: 'Operation',
        fields: [
          { key: 'operation', label: 'What to do', widget: 'dropdown', options: [
            { value: 'list', label: 'List events' },
            { value: 'create', label: 'Create event' },
            { value: 'update', label: 'Update event' },
            { value: 'delete', label: 'Delete event' },
          ], required: true },
        ],
      },
      {
        title: 'Date range',
        showWhen: { kind: 'eq', field: 'operation', value: 'list' },
        fields: [
          { key: 'dateRangeStart', label: 'From', widget: 'template-string', placeholder: 'ISO date or {{template}}' },
          { key: 'dateRangeEnd', label: 'To', widget: 'template-string', placeholder: 'ISO date or {{template}}' },
        ],
      },
      {
        title: 'Event details',
        showWhen: { kind: 'in', field: 'operation', values: ['create', 'update'] },
        fields: [
          { key: 'eventTitle', label: 'Title', widget: 'template-string' },
          { key: 'eventStart', label: 'Start', widget: 'template-string' },
          { key: 'eventEnd', label: 'End', widget: 'template-string' },
          { key: 'eventLocation', label: 'Location', widget: 'template-string' },
          { key: 'eventNotes', label: 'Notes', widget: 'template-string' },
        ],
      },
      {
        title: 'Target event',
        showWhen: { kind: 'in', field: 'operation', values: ['update', 'delete'] },
        fields: [
          { key: 'eventId', label: 'Event ID', widget: 'string', required: true },
        ],
      },
    ],
  },
  executorBody: `
    const cred = await getCredential<'basic'>(config.credentialId);
    if (!cred) throw new Error('Credential not found: ' + config.credentialId);
    if (cred.kind !== 'basic') throw new Error('Apple Calendar needs a basic credential');
    const client = await tsdav.createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: { username: cred.payload.username, password: cred.payload.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    const calendars = await client.fetchCalendars();
    const target = calendars.find((c) => c.url === config.calendar);
    if (!target) throw new Error('Unknown calendar: ' + config.calendar);

    if (config.operation === 'list') {
      const events = await client.fetchCalendarObjects({
        calendar: target,
        timeRange: { start: config.dateRangeStart, end: config.dateRangeEnd },
      });
      return { events: events.map((e) => ({ id: e.url, ical: e.data })) };
    }
    if (config.operation === 'create') {
      const ical = buildICal({
        title: config.eventTitle,
        start: config.eventStart,
        end: config.eventEnd,
        location: config.eventLocation,
        notes: config.eventNotes,
      });
      const created = await client.createCalendarObject({
        calendar: target,
        filename: \`\${crypto.randomUUID()}.ics\`,
        iCalString: ical,
      });
      return { id: created.url, url: created.url };
    }
    if (config.operation === 'update') {
      const ical = buildICal({ /* ... */ });
      const updated = await client.updateCalendarObject({
        calendarObject: { url: config.eventId, etag: '*', data: ical },
      });
      return { id: config.eventId, etag: updated.etag };
    }
    if (config.operation === 'delete') {
      await client.deleteCalendarObject({ calendarObject: { url: config.eventId, etag: '*' } });
      return { id: config.eventId };
    }
    throw new Error('Unknown operation: ' + config.operation);
  `,
  deps: [{ name: 'tsdav', version: '^2.0.0' }],
  optionsResolvers: [{
    fieldName: 'calendar',
    body: `
      const cred = await getCredential<'basic'>(credentialId);
      if (!cred) return [];
      const client = await tsdav.createDAVClient({
        serverUrl: 'https://caldav.icloud.com',
        credentials: { username: cred.payload.username, password: cred.payload.password },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      });
      const calendars = await client.fetchCalendars();
      return calendars.map((c) => ({ value: c.url, label: c.displayName ?? c.url }));
    `,
  }],
  docs: `## When to use

For workflows that need to read or write events on your iCloud calendar — alerts before meetings, scheduling, syncing with other systems.

## How it works

Connects via CalDAV (RFC 4791) to \`caldav.icloud.com\` using an app-specific password. Pick a credential, pick a calendar, choose an operation.

## Configuration

- **iCloud account** — the credential. Create one at \`/admin/integrations\` with kind=basic.
- **Calendar** — populated dynamically once the account is selected.
- **Operation** — list / create / update / delete.

## Output

| Operation | Output shape |
|---|---|
| list | \`{ events: [{ id, ical }] }\` |
| create | \`{ id, url }\` |
| update | \`{ id, etag }\` |
| delete | \`{ id }\` |
`,
};
```

- [ ] **Step 2: Type-check the fixture**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "apple-calendar.spec" || echo "(no errors)"
```

- [ ] **Step 3: Commit**

```bash
git add tests/__fixtures__/curate-codegen/apple-calendar.spec.ts
git commit -m "test(curate): Apple Calendar fixture spec"
```

---

## Phase 4 — Definition emitter

### Task 4: emitDefinition + golden test

**Files:**
- Create: `src/lib/curate/codegen/definition.ts`
- Test: `tests/lib/curate/codegen/definition.test.ts`
- Fixture: `tests/__fixtures__/curate-codegen/expected/apple-calendar.def.ts.txt`

- [ ] **Step 1: Test first (golden file pattern)**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/curate-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/curate-codegen/expected');

describe('emitDefinition', () => {
  it('emits definition matching golden for apple-calendar', async () => {
    const { emitDefinition } = await import('$lib/curate/codegen/definition');
    const got = emitDefinition(appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'apple-calendar.def.ts.txt'), 'utf8');
    expect(got).toBe(want);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

```bash
npm test -- tests/lib/curate/codegen/definition.test.ts
```

- [ ] **Step 3: Implement emitDefinition**

```ts
import type { NodeSpec } from '../spec/types';

export function emitDefinition(spec: NodeSpec): string {
  const basicConfig = spec.uiSchema.sections
    .flatMap((s) => s.fields)
    .map(fieldToBasicConfig)
    .filter((x): x is string => x !== null)
    .join(',\n      ');

  return `// Generated by curate-codegen. Do not hand-edit; re-curate to update.

import type { NodeDefinition } from '$lib/workflows/types';

export const ${camel(spec.type)}Def: NodeDefinition = {
  type: '${spec.type}',
  label: '${escape(spec.label)}',
  category: '${spec.category}',
  description: '${escape(spec.description)}',
  llmDescription: ${tsString(spec.llmDescription)},
  llmExamples: ${json(spec.llmExamples, 2)},
  configSchema: ${json(spec.configSchema, 2)},
  defaultConfig: ${json(spec.defaultConfig, 2)},
  basicConfig: [
      ${basicConfig}
    ],
};
`;
}

function fieldToBasicConfig(field: { key: string; label: string; widget: string; description?: string; required?: boolean }): string | null {
  // Collapse the v1 widget set down to the existing basicConfig types
  // for compatibility with hand-written nodes that read basicConfig.
  const typeMap: Record<string, string> = {
    'string': 'string',
    'textarea': 'textarea',
    'dropdown': 'dropdown',
    'toggle': 'toggle',
    'datetime': 'string',
    'credential-picker': 'string', // raw id; specialized panel renders the picker
    'resource-picker': 'string',
    'template-string': 'string',
  };
  const t = typeMap[field.widget] ?? 'string';
  const parts = [`{ key: '${field.key}'`, `label: '${escape(field.label)}'`, `type: '${t}'`];
  if (field.description) parts.push(`description: ${tsString(field.description)}`);
  if (field.required) parts.push(`required: true`);
  return `  ${parts.join(', ')} }`;
}

function camel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function tsString(s: string): string {
  // Use template literal if the string contains both single quotes and newlines
  // — keeps output readable. Otherwise standard single-quoted.
  if (s.includes('\n')) return '`' + s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
  return `'${escape(s)}'`;
}

function json(value: unknown, indent: number): string {
  // 2-space indent, sorted keys for determinism.
  return JSON.stringify(value, null, indent).replace(/\n/g, '\n  ');
}
```

- [ ] **Step 4: Generate the golden file**

```bash
mkdir -p tests/__fixtures__/curate-codegen/expected
npx tsx -e "import('./tests/__fixtures__/curate-codegen/apple-calendar.spec.ts').then(({ appleCalendarSpec }) => import('./src/lib/curate/codegen/definition.ts').then(({ emitDefinition }) => process.stdout.write(emitDefinition(appleCalendarSpec))))" > tests/__fixtures__/curate-codegen/expected/apple-calendar.def.ts.txt
```

Inspect the generated file:

```bash
head -60 tests/__fixtures__/curate-codegen/expected/apple-calendar.def.ts.txt
```

If it looks reasonable (right structure, no obvious bugs), commit it as the golden. If it looks wrong, fix the emitter and regenerate. **Once committed, the golden becomes the contract.**

- [ ] **Step 5: Run, expect PASS**

```bash
npm test -- tests/lib/curate/codegen/definition.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/curate/codegen/definition.ts tests/lib/curate/codegen/definition.test.ts tests/__fixtures__/curate-codegen/expected/apple-calendar.def.ts.txt
git commit -m "feat(curate): definition emitter + golden test"
```

---

## Phase 5 — Executor emitter

### Task 5: emitExecutor + golden test

**Files:**
- Create: `src/lib/curate/codegen/executor.ts`
- Test: `tests/lib/curate/codegen/executor.test.ts`
- Fixture: `tests/__fixtures__/curate-codegen/expected/apple-calendar.ts.txt`

- [ ] **Step 1: Test first**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/curate-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/curate-codegen/expected');

describe('emitExecutor', () => {
  it('emits executor matching golden for apple-calendar', async () => {
    const { emitExecutor } = await import('$lib/curate/codegen/executor');
    const got = emitExecutor(appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'apple-calendar.ts.txt'), 'utf8');
    expect(got).toBe(want);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```ts
import type { NodeSpec, NodeDep } from '../spec/types';

export function emitExecutor(spec: NodeSpec): string {
  const importBlock = buildImports(spec);
  const optionsResolverFns = buildOptionsResolvers(spec);

  return `// Generated by curate-codegen. Do not hand-edit; re-curate to update.

${importBlock}

import type { NodeExecutor, NodeResult } from '$lib/workflows/types';
import { ${camel(spec.type)}Def } from './${spec.type}.def';
export { ${camel(spec.type)}Def } from './${spec.type}.def';

export const ${camel(spec.type)}Executor: NodeExecutor = {
  type: '${spec.type}',
  async execute(input, config: Record<string, any>, _ctx): Promise<NodeResult> {
${indentBody(spec.executorBody, 4)}
  },
  getInputSchema: () => ${camel(spec.type)}Def.configSchema,
  getOutputSchema: () => (${JSON.stringify(spec.outputSchema, null, 2).replace(/\n/g, '\n  ')}),
};
${optionsResolverFns ? '\n' + optionsResolverFns : ''}`;
}

function buildImports(spec: NodeSpec): string {
  const lines: string[] = [];
  lines.push(`import { getCredential } from '$lib/integrations/credentials';`);
  if (spec.deps.some((d) => d.name === 'tsdav')) {
    lines.push(`import * as tsdav from 'tsdav';`);
  }
  // Generic: also import any other deps as namespace
  for (const dep of spec.deps) {
    if (dep.name === 'tsdav') continue; // already imported above
    lines.push(`import * as ${depImportName(dep)} from '${dep.name}';`);
  }
  return lines.join('\n');
}

function buildOptionsResolvers(spec: NodeSpec): string | null {
  if (!spec.optionsResolvers || spec.optionsResolvers.length === 0) return null;
  const fns = spec.optionsResolvers.map((r) => {
    return `export async function resolveOptions_${r.fieldName}(credentialId: string): Promise<{ value: string; label: string }[]> {
${indentBody(r.body, 2)}
}`;
  });
  return fns.join('\n\n');
}

function depImportName(dep: NodeDep): string {
  return camel(dep.name.replace(/[^a-z0-9]/gi, '-'));
}

function camel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function indentBody(body: string, spaces: number): string {
  const ind = ' '.repeat(spaces);
  return body
    .split('\n')
    .map((line) => (line.trim() ? ind + line : line))
    .join('\n');
}
```

- [ ] **Step 4: Generate golden**

```bash
npx tsx -e "import('./tests/__fixtures__/curate-codegen/apple-calendar.spec.ts').then(({ appleCalendarSpec }) => import('./src/lib/curate/codegen/executor.ts').then(({ emitExecutor }) => process.stdout.write(emitExecutor(appleCalendarSpec))))" > tests/__fixtures__/curate-codegen/expected/apple-calendar.ts.txt
```

Inspect; if reasonable, commit.

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/lib/curate/codegen/executor.ts tests/lib/curate/codegen/executor.test.ts tests/__fixtures__/curate-codegen/expected/apple-calendar.ts.txt
git commit -m "feat(curate): executor emitter + golden test"
```

---

## Phase 6 — Panel emitter

The most involved task. Translates `uiSchema` into a Svelte 5 component matching the project's existing specialized-panel idiom.

### Task 6: emitPanel + golden test

**Files:**
- Create: `src/lib/curate/codegen/panel.ts`
- Test: `tests/lib/curate/codegen/panel.test.ts`
- Fixture: `tests/__fixtures__/curate-codegen/expected/AppleCalendarPanel.svelte.txt`

- [ ] **Step 1: Read existing reference panels first**

Before implementing, read `src/lib/canvas/nodes/panels/GmailSendPanel.svelte` and `src/lib/canvas/nodes/panels/GmailFetchPanel.svelte` to lock in the prop interface, conditional rendering style, and section markup conventions that the emitter must mirror.

Note especially:
- `let { config, onChange, definition, nodeId, workflowId, upstreamFields }: PanelProps = $props();` is the standard prop block
- Existing panels write back to `onChange({ ...config, x: newX })` immutably
- Conditional sections use `{#if}` blocks
- Existing panels often use a local helper `function set(key: string, value: unknown) { onChange({ ...config, [key]: value }); }`

- [ ] **Step 2: Test first**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/curate-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/curate-codegen/expected');

describe('emitPanel', () => {
  it('emits Svelte panel matching golden for apple-calendar', async () => {
    const { emitPanel } = await import('$lib/curate/codegen/panel');
    const got = emitPanel(appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'AppleCalendarPanel.svelte.txt'), 'utf8');
    expect(got).toBe(want);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Implement** (this is the long one)

```ts
import type {
  NodeSpec, UISchema, UISchemaSection, UISchemaField, UISchemaBanner,
  UISchemaAction, Condition,
} from '../spec/types';

export function emitPanel(spec: NodeSpec): string {
  const componentName = pascalCase(spec.type) + 'Panel';
  return [
    SCRIPT(spec, componentName),
    '',
    bannersBlock(spec.uiSchema.banners ?? []),
    actionsBlock(spec.uiSchema.actions ?? [], 'top'),
    sectionsBlock(spec.uiSchema.sections),
    '',
    STYLE,
  ].join('\n');
}

function SCRIPT(spec: NodeSpec, componentName: string): string {
  // Static imports for any widgets used.
  const widgets = collectUsedWidgets(spec);
  const imports: string[] = [
    `import type { Component } from 'svelte';`,
    `import type { NodeDefinition } from '$lib/workflows/types';`,
  ];
  if (widgets.has('credential-picker')) {
    imports.push(`import CredentialPicker from '$lib/canvas/nodes/panels/widgets/CredentialPicker.svelte';`);
  }
  if (widgets.has('resource-picker')) {
    imports.push(`import ResourcePicker from '$lib/canvas/nodes/panels/shared/ResourcePicker.svelte';`);
  }
  if (widgets.has('template-string')) {
    imports.push(`import TemplatedInput from '$lib/canvas/nodes/panels/shared/TemplatedInput.svelte';`);
  }
  if ((spec.uiSchema.banners ?? []).some((b) => b.kind === 'credential-status')) {
    imports.push(`import CredentialStatusBanner from '$lib/canvas/nodes/panels/widgets/CredentialStatusBanner.svelte';`);
  }
  if ((spec.uiSchema.actions ?? []).some((a) => a.kind === 'test-connection')) {
    imports.push(`import TestConnectionAction from '$lib/canvas/nodes/panels/widgets/TestConnectionAction.svelte';`);
  }

  return `<script lang="ts">
${imports.join('\n  ')}

  interface Props {
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    nodeId?: string;
    workflowId?: string;
    upstreamFields?: string[];
  }
  let { config, onChange, definition, nodeId, workflowId, upstreamFields }: Props = $props();

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // Generated condition helpers — each returns a boolean from the current config.
  ${conditionHelpers(spec)}
</script>`;
}

function collectUsedWidgets(spec: NodeSpec): Set<string> {
  const set = new Set<string>();
  for (const section of spec.uiSchema.sections) {
    for (const field of section.fields) set.add(field.widget);
  }
  return set;
}

function conditionHelpers(spec: NodeSpec): string {
  // Generate one named helper per unique condition. Reduces inline spaghetti.
  // For v1 the simplest path: emit inline `condEval(...)` calls in the markup
  // and define a single recursive helper here.
  return `
  function evalCond(cond: any): boolean {
    if (!cond) return true;
    if (cond.kind === 'eq') return config[cond.field] === cond.value;
    if (cond.kind === 'neq') return config[cond.field] !== cond.value;
    if (cond.kind === 'in') return cond.values.includes(config[cond.field]);
    if (cond.kind === 'not-in') return !cond.values.includes(config[cond.field]);
    if (cond.kind === 'and') return cond.conditions.every(evalCond);
    if (cond.kind === 'or') return cond.conditions.some(evalCond);
    return true;
  }`;
}

function bannersBlock(banners: UISchemaBanner[]): string {
  if (banners.length === 0) return '';
  return banners.map((b) => {
    if (b.kind === 'credential-status') {
      return `<CredentialStatusBanner credentialId={config.${b.credentialField} as string | undefined} />`;
    }
    return '';
  }).join('\n');
}

function actionsBlock(actions: UISchemaAction[], placement: 'top' | 'inline'): string {
  return actions
    .filter((a) => a.placement === placement)
    .map((a) => {
      if (a.kind === 'test-connection') {
        return `<TestConnectionAction integrationType="${a.integrationType}" credentialId={config.${a.credentialField} as string | undefined} />`;
      }
      return '';
    })
    .join('\n');
}

function sectionsBlock(sections: UISchemaSection[]): string {
  return sections.map(emitSection).join('\n\n');
}

function emitSection(section: UISchemaSection): string {
  const open = section.showWhen ? `{#if evalCond(${jsonInline(section.showWhen)})}` : '';
  const close = section.showWhen ? '{/if}' : '';
  const intro = section.intro ? `<p class="section-intro">${escapeHtml(section.intro)}</p>` : '';
  const fields = section.fields.map(emitField).join('\n  ');
  return [
    open,
    `<section class="config-section">`,
    `  <h3>${escapeHtml(section.title)}</h3>`,
    intro,
    `  ${fields}`,
    `</section>`,
    close,
  ].filter(Boolean).join('\n');
}

function emitField(field: UISchemaField): string {
  const wrapOpen = field.showWhen ? `{#if evalCond(${jsonInline(field.showWhen)})}` : '';
  const wrapClose = field.showWhen ? '{/if}' : '';
  const labelHtml = `<label>${escapeHtml(field.label)}${field.required ? ' <span class="req">*</span>' : ''}</label>`;
  const descHtml = field.description ? `<p class="hint">${escapeHtml(field.description)}</p>` : '';
  const widget = emitWidget(field);
  return [wrapOpen, `<div class="field">`, `  ${labelHtml}`, descHtml ? `  ${descHtml}` : '', `  ${widget}`, `</div>`, wrapClose].filter(Boolean).join('\n  ');
}

function emitWidget(field: UISchemaField): string {
  switch (field.widget) {
    case 'string':
      return `<input class="nm-text-input" type="text" placeholder="${escapeHtml(field.placeholder ?? '')}" value={(config.${field.key} as string | undefined) ?? ''} oninput={(e) => set('${field.key}', (e.currentTarget as HTMLInputElement).value)} />`;
    case 'textarea':
      return `<textarea class="nm-text-input" rows="${field.rows ?? 4}" placeholder="${escapeHtml(field.placeholder ?? '')}" value={(config.${field.key} as string | undefined) ?? ''} oninput={(e) => set('${field.key}', (e.currentTarget as HTMLTextAreaElement).value)}></textarea>`;
    case 'dropdown':
      return `<select class="nm-text-input" value={(config.${field.key} as string | undefined) ?? ''} onchange={(e) => set('${field.key}', (e.currentTarget as HTMLSelectElement).value)}>${(field as { options: { value: string; label: string }[] }).options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}</select>`;
    case 'toggle':
      return `<input type="checkbox" checked={!!config.${field.key}} onchange={(e) => set('${field.key}', (e.currentTarget as HTMLInputElement).checked)} />`;
    case 'datetime':
      return `<input class="nm-text-input" type="datetime-local" value={(config.${field.key} as string | undefined) ?? ''} oninput={(e) => set('${field.key}', (e.currentTarget as HTMLInputElement).value)} />`;
    case 'credential-picker':
      return `<CredentialPicker integrationType="${(field as { integrationType: string }).integrationType}" value={config.${field.key} as string | undefined} onChange={(id) => set('${field.key}', id)} />`;
    case 'resource-picker': {
      const f = field as { credentialKey: string; integrationType: string; key: string };
      return `<ResourcePicker integrationType="${f.integrationType}" fieldName="${f.key}" credentialId={config.${f.credentialKey} as string | undefined} value={config.${f.key} as string | undefined} onChange={(v) => set('${f.key}', v)} />`;
    }
    case 'template-string':
      return `<TemplatedInput value={(config.${field.key} as string | undefined) ?? ''} placeholder="${escapeHtml((field as { placeholder?: string }).placeholder ?? '')}" upstreamFields={upstreamFields} onChange={(v) => set('${field.key}', v)} />`;
  }
}

const STYLE = `<style>
  .config-section { margin-bottom: 1rem; }
  .config-section h3 { margin: 0 0 0.25rem; font-size: 0.85rem; font-weight: 600; }
  .section-intro { color: var(--nm-muted, #666); font-size: 0.85rem; margin: 0 0 0.5rem; }
  .field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
  .field label { font-size: 0.85rem; }
  .req { color: var(--nm-status-error, #c0392b); }
  .hint { font-size: 0.8rem; color: var(--nm-muted, #666); margin: 0; }
</style>`;

function pascalCase(kebab: string): string {
  return kebab.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
}

function jsonInline(v: unknown): string {
  return JSON.stringify(v).replace(/"/g, '\'');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

- [ ] **Step 5: Generate golden**

```bash
npx tsx -e "import('./tests/__fixtures__/curate-codegen/apple-calendar.spec.ts').then(({ appleCalendarSpec }) => import('./src/lib/curate/codegen/panel.ts').then(({ emitPanel }) => process.stdout.write(emitPanel(appleCalendarSpec))))" > tests/__fixtures__/curate-codegen/expected/AppleCalendarPanel.svelte.txt
```

Inspect carefully. The output should:
- Open with a `<script lang="ts">` block with the right imports
- Contain the props block + `set()` helper + `evalCond()` helper
- Have a `<CredentialStatusBanner>` and `<TestConnectionAction>` at the top
- Have one `<section>` per uiSchema section (some wrapped in `{#if evalCond(...)}` for conditional ones)
- Have inputs for each field using the right widget
- End with the `<style>` block

If anything's off (especially the `{#if}` guards, which are the trickiest), fix the emitter.

- [ ] **Step 6: Run, expect PASS**

- [ ] **Step 7: Commit**

```bash
git add src/lib/curate/codegen/panel.ts tests/lib/curate/codegen/panel.test.ts tests/__fixtures__/curate-codegen/expected/AppleCalendarPanel.svelte.txt
git commit -m "feat(curate): panel emitter (uiSchema → Svelte) + golden test"
```

---

## Phase 7 — Docs emitter

### Task 7: emitDocs + golden test

**Files:**
- Create: `src/lib/curate/codegen/docs.ts`
- Test: `tests/lib/curate/codegen/docs.test.ts`
- Fixture: `tests/__fixtures__/curate-codegen/expected/apple-calendar.md.txt`

- [ ] **Step 1: Test first** — same golden-file pattern as definition/executor.

- [ ] **Step 2: Implement**

```ts
import type { NodeSpec } from '../spec/types';

export function emitDocs(spec: NodeSpec): string {
  const front = `# ${spec.label}

> ${spec.description}

`;
  const body = spec.docs.trim();
  const examples = spec.llmExamples.length > 0
    ? `\n\n## Example configurations\n\n${spec.llmExamples.map(formatExample).join('\n\n')}`
    : '';
  const footer = `\n\n---\n\n*Auto-generated by curate-codegen for node \`${spec.type}\`.*\n`;
  return front + body + examples + footer;
}

function formatExample(ex: { scenario: string; config: Record<string, unknown>; notes?: string }): string {
  return `### ${ex.scenario}\n\n` +
    '```json\n' + JSON.stringify(ex.config, null, 2) + '\n```' +
    (ex.notes ? `\n\n${ex.notes}` : '');
}
```

- [ ] **Step 3: Generate golden + commit**

```bash
npx tsx -e "import('./tests/__fixtures__/curate-codegen/apple-calendar.spec.ts').then(({ appleCalendarSpec }) => import('./src/lib/curate/codegen/docs.ts').then(({ emitDocs }) => process.stdout.write(emitDocs(appleCalendarSpec))))" > tests/__fixtures__/curate-codegen/expected/apple-calendar.md.txt
git add src/lib/curate/codegen/docs.ts tests/lib/curate/codegen/docs.test.ts tests/__fixtures__/curate-codegen/expected/apple-calendar.md.txt
git commit -m "feat(curate): docs emitter + golden test"
```

---

## Phase 8 — Registry patches

### Task 8: panels/registry.ts patcher

**Files:**
- Create: `src/lib/curate/codegen/registry-patch.ts`
- Test: `tests/lib/curate/codegen/registry-patch.test.ts`
- Fixture: `tests/__fixtures__/curate-codegen/registry-base.ts.txt` (sample BASE)
- Fixture: `tests/__fixtures__/curate-codegen/expected/registry-patched.ts.txt`

- [ ] **Step 1: Create the BASE fixture**

A small, self-contained version of `panels/registry.ts` to use as a known input. Copy from the live file but trim down to ~3 imports and 3 specialized entries:

```ts
// tests/__fixtures__/curate-codegen/registry-base.ts.txt
import type { Component } from 'svelte';
import GmailSendPanel from './GmailSendPanel.svelte';
import StealthScrapePanel from './StealthScrapePanel.svelte';
import BasicConfigForm from './BasicConfigForm.svelte';
import GenericJsonPanel from './GenericJsonPanel.svelte';
import type { NodeDefinition } from '$lib/workflows/types';

export type PanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  definition?: NodeDefinition;
  nodeId?: string;
  workflowId?: string;
  upstreamFields?: string[];
};

const specialized: Record<string, Component<PanelProps>> = {
  'gmail-send': GmailSendPanel as unknown as Component<PanelProps>,
  'stealth-scrape': StealthScrapePanel as unknown as Component<PanelProps>,
};

export function getPanel(type: string, definition?: NodeDefinition): Component<PanelProps> {
  return specialized[type] ?? (definition?.basicConfig ? BasicConfigForm as unknown as Component<PanelProps> : GenericJsonPanel as unknown as Component<PanelProps>);
}
```

- [ ] **Step 2: Test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appleCalendarSpec } from '../../../__fixtures__/curate-codegen/apple-calendar.spec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../../__fixtures__/curate-codegen');

describe('patchPanelRegistry', () => {
  it('adds the import + specialized entry for apple-calendar', async () => {
    const { patchPanelRegistry } = await import('$lib/curate/codegen/registry-patch');
    const base = readFileSync(path.join(FIXTURE, 'registry-base.ts.txt'), 'utf8');
    const got = patchPanelRegistry(base, appleCalendarSpec);
    const want = readFileSync(path.join(FIXTURE, 'expected/registry-patched.ts.txt'), 'utf8');
    expect(got).toBe(want);
  });

  it('is idempotent — patching twice produces the same output', async () => {
    const { patchPanelRegistry } = await import('$lib/curate/codegen/registry-patch');
    const base = readFileSync(path.join(FIXTURE, 'registry-base.ts.txt'), 'utf8');
    const once = patchPanelRegistry(base, appleCalendarSpec);
    const twice = patchPanelRegistry(once, appleCalendarSpec);
    expect(twice).toBe(once);
  });
});
```

- [ ] **Step 3: Implement**

```ts
import type { NodeSpec } from '../spec/types';

export function patchPanelRegistry(source: string, spec: NodeSpec): string {
  const componentName = pascalCase(spec.type) + 'Panel';
  const importLine = `import ${componentName} from './${componentName}.svelte';`;
  const entryLine = `  '${spec.type}': ${componentName} as unknown as Component<PanelProps>,`;

  let out = source;

  // 1. Add import after the last existing './XPanel.svelte' import
  if (!out.includes(importLine)) {
    const lastImport = out.match(/(.*from '\.\/[A-Z][A-Za-z]+Panel\.svelte';)(\n|$)/g);
    if (lastImport && lastImport.length > 0) {
      const insertAfter = lastImport[lastImport.length - 1];
      out = out.replace(insertAfter, insertAfter + importLine + '\n');
    } else {
      // Fallback: prepend after first 'import type { Component }'
      out = out.replace(/(import type \{ Component \}.*\n)/, `$1${importLine}\n`);
    }
  }

  // 2. Add entry to the specialized map before the closing brace of that const.
  const entryAlreadyPresent = new RegExp(`'${spec.type}'\\s*:\\s*${componentName}`).test(out);
  if (!entryAlreadyPresent) {
    out = out.replace(
      /const specialized: Record<string, Component<PanelProps>> = \{([\s\S]*?)\n\};/,
      (_, body) => `const specialized: Record<string, Component<PanelProps>> = {${body}\n${entryLine}\n};`,
    );
  }

  return out;
}

function pascalCase(kebab: string): string {
  return kebab.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
}
```

- [ ] **Step 4: Generate golden + commit**

```bash
mkdir -p tests/__fixtures__/curate-codegen/expected
npx tsx -e "
const fs = require('fs');
const path = require('path');
import('./tests/__fixtures__/curate-codegen/apple-calendar.spec.ts').then(({ appleCalendarSpec }) =>
  import('./src/lib/curate/codegen/registry-patch.ts').then(({ patchPanelRegistry }) => {
    const base = fs.readFileSync('tests/__fixtures__/curate-codegen/registry-base.ts.txt', 'utf8');
    process.stdout.write(patchPanelRegistry(base, appleCalendarSpec));
  })
);
" > tests/__fixtures__/curate-codegen/expected/registry-patched.ts.txt
```

Inspect, run test, commit.

```bash
git add src/lib/curate/codegen/registry-patch.ts tests/lib/curate/codegen/registry-patch.test.ts tests/__fixtures__/curate-codegen/registry-base.ts.txt tests/__fixtures__/curate-codegen/expected/registry-patched.ts.txt
git commit -m "feat(curate): panels/registry.ts patcher + golden test"
```

### Task 9: workflows/index.ts patcher

**Files:**
- Create: `src/lib/curate/codegen/index-patch.ts`
- Test: `tests/lib/curate/codegen/index-patch.test.ts`
- Fixture: `tests/__fixtures__/curate-codegen/index-base.ts.txt`
- Fixture: `tests/__fixtures__/curate-codegen/expected/index-patched.ts.txt`

- [ ] **Step 1: Create the BASE fixture**

```ts
// tests/__fixtures__/curate-codegen/index-base.ts.txt
import { NodeRegistry } from './registry';
import { gmailSendDef, gmailSendExecutor } from './nodes/gmail-send';
import { stealthScrapeDef, stealthScrapeExecutor } from './nodes/stealth-scrape';

export const registry = new NodeRegistry();

registry.register(gmailSendDef, gmailSendExecutor);
registry.register(stealthScrapeDef, stealthScrapeExecutor);

export type { NodeRegistry };
```

- [ ] **Step 2: Test (with idempotency case)**

Same pattern as Task 8.

- [ ] **Step 3: Implement**

```ts
import type { NodeSpec } from '../spec/types';

export function patchWorkflowsIndex(source: string, spec: NodeSpec): string {
  const camelType = camel(spec.type);
  const importLine = `import { ${camelType}Def, ${camelType}Executor } from './nodes/${spec.type}';`;
  const registerLine = `registry.register(${camelType}Def, ${camelType}Executor);`;

  let out = source;

  if (!out.includes(importLine)) {
    // Insert after the last node import.
    const lastImport = out.match(/(import .* from '\.\/nodes\/[a-z0-9-]+';)(\n|$)/g);
    if (lastImport && lastImport.length > 0) {
      const insertAfter = lastImport[lastImport.length - 1];
      out = out.replace(insertAfter, insertAfter + importLine + '\n');
    } else {
      // Fallback: after `import { NodeRegistry }`
      out = out.replace(/(import \{ NodeRegistry \}.*\n)/, `$1${importLine}\n`);
    }
  }

  if (!out.includes(registerLine)) {
    // Append after the last register call.
    const lastRegister = out.match(/(registry\.register\([^)]+\);)(\n|$)/g);
    if (lastRegister && lastRegister.length > 0) {
      const insertAfter = lastRegister[lastRegister.length - 1];
      out = out.replace(insertAfter, insertAfter + registerLine + '\n');
    } else {
      // Fallback: after `export const registry`
      out = out.replace(/(export const registry = .*?;\n)/, `$1\n${registerLine}\n`);
    }
  }

  return out;
}

function camel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
```

- [ ] **Step 4: Generate golden + commit**

Same pattern as Task 8.

```bash
git add src/lib/curate/codegen/index-patch.ts tests/lib/curate/codegen/index-patch.test.ts tests/__fixtures__/curate-codegen/index-base.ts.txt tests/__fixtures__/curate-codegen/expected/index-patched.ts.txt
git commit -m "feat(curate): workflows/index.ts patcher + golden test"
```

---

## Phase 9 — File-writing orchestrator

### Task 10: writeNodeFiles + integration test

**Files:**
- Create: `src/lib/curate/codegen/write-files.ts`
- Test: `tests/lib/curate/codegen/write-files.test.ts`

- [ ] **Step 1: Test first**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appleCalendarSpec } from '../../../__fixtures__/curate-codegen/apple-calendar.spec';

let tempDir: string;
let srDocsDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-write-'));
  srDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-srdocs-'));
  // Seed fake panels/registry.ts and workflows/index.ts in tempDir so the
  // patchers have something to write into.
  fs.mkdirSync(path.join(tempDir, 'src/lib/canvas/nodes/panels'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'src/lib/workflows/nodes'), { recursive: true });
  fs.mkdirSync(path.join(srDocsDir, 'content/internal/features/workflows/nodes'), { recursive: true });

  const FIXTURE = path.join(__dirname, '../../../__fixtures__/curate-codegen');
  fs.writeFileSync(
    path.join(tempDir, 'src/lib/canvas/nodes/panels/registry.ts'),
    fs.readFileSync(path.join(FIXTURE, 'registry-base.ts.txt'), 'utf8'),
  );
  fs.writeFileSync(
    path.join(tempDir, 'src/lib/workflows/index.ts'),
    fs.readFileSync(path.join(FIXTURE, 'index-base.ts.txt'), 'utf8'),
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(srDocsDir, { recursive: true, force: true });
});

describe('writeNodeFiles', () => {
  it('writes all expected files for apple-calendar', async () => {
    const { writeNodeFiles } = await import('$lib/curate/codegen/write-files');
    const result = await writeNodeFiles(appleCalendarSpec, tempDir, srDocsDir);
    expect(result.written).toEqual(expect.arrayContaining([
      'src/lib/workflows/nodes/apple-calendar.def.ts',
      'src/lib/workflows/nodes/apple-calendar.ts',
      'src/lib/canvas/nodes/panels/AppleCalendarPanel.svelte',
      'src/lib/canvas/nodes/panels/registry.ts',
      'src/lib/workflows/index.ts',
    ]));
    // sr-docs path is relative to srDocsDir.
    expect(fs.existsSync(path.join(srDocsDir, 'content/internal/features/workflows/nodes/apple-calendar.md'))).toBe(true);
  });

  it('is idempotent — running twice produces identical files', async () => {
    const { writeNodeFiles } = await import('$lib/curate/codegen/write-files');
    await writeNodeFiles(appleCalendarSpec, tempDir, srDocsDir);
    const snapshot1 = fs.readFileSync(path.join(tempDir, 'src/lib/canvas/nodes/panels/registry.ts'), 'utf8');
    await writeNodeFiles(appleCalendarSpec, tempDir, srDocsDir);
    const snapshot2 = fs.readFileSync(path.join(tempDir, 'src/lib/canvas/nodes/panels/registry.ts'), 'utf8');
    expect(snapshot2).toBe(snapshot1);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { NodeSpec } from '../spec/types';
import { emitDefinition } from './definition';
import { emitExecutor } from './executor';
import { emitPanel } from './panel';
import { emitDocs } from './docs';
import { patchPanelRegistry } from './registry-patch';
import { patchWorkflowsIndex } from './index-patch';
import { validateNodeSpec } from '../spec/validate';

export interface WriteResult {
  written: string[];
}

export async function writeNodeFiles(
  spec: NodeSpec,
  worktreeDir: string,
  srDocsDir: string,
): Promise<WriteResult> {
  const validation = validateNodeSpec(spec);
  if (!validation.ok) {
    throw new Error(`Invalid spec: ${validation.errors.join('; ')}`);
  }

  const written: string[] = [];

  // 1. Definition + executor (new files)
  const defPath = path.join('src/lib/workflows/nodes', `${spec.type}.def.ts`);
  const execPath = path.join('src/lib/workflows/nodes', `${spec.type}.ts`);
  await writeNew(worktreeDir, defPath, emitDefinition(spec));
  await writeNew(worktreeDir, execPath, emitExecutor(spec));
  written.push(defPath, execPath);

  // 2. Specialized panel (new file)
  const componentName = pascalCase(spec.type) + 'Panel';
  const panelPath = path.join('src/lib/canvas/nodes/panels', `${componentName}.svelte`);
  await writeNew(worktreeDir, panelPath, emitPanel(spec));
  written.push(panelPath);

  // 3. Patches (existing files)
  const registryPath = path.join('src/lib/canvas/nodes/panels', 'registry.ts');
  const registrySource = fs.readFileSync(path.join(worktreeDir, registryPath), 'utf8');
  fs.writeFileSync(path.join(worktreeDir, registryPath), patchPanelRegistry(registrySource, spec));
  written.push(registryPath);

  const indexPath = path.join('src/lib/workflows', 'index.ts');
  const indexSource = fs.readFileSync(path.join(worktreeDir, indexPath), 'utf8');
  fs.writeFileSync(path.join(worktreeDir, indexPath), patchWorkflowsIndex(indexSource, spec));
  written.push(indexPath);

  // 4. sr-docs entry (relative to srDocsDir)
  const docsPath = path.join(srDocsDir, `content/internal/features/workflows/nodes/${spec.type}.md`);
  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  fs.writeFileSync(docsPath, emitDocs(spec));

  return { written };
}

async function writeNew(base: string, relPath: string, content: string): Promise<void> {
  const full = path.join(base, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function pascalCase(kebab: string): string {
  return kebab.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
}
```

- [ ] **Step 3: Run, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/lib/curate/codegen/write-files.ts tests/lib/curate/codegen/write-files.test.ts
git commit -m "feat(curate): writeNodeFiles orchestrator + integration test"
```

---

## Phase 10 — Barrel + final verification

### Task 11: index barrel

**Files:**
- Create: `src/lib/curate/codegen/index.ts`

```ts
export * from './definition';
export * from './executor';
export * from './panel';
export * from './docs';
export * from './registry-patch';
export * from './index-patch';
export * from './write-files';
```

Plus update `src/lib/curate/index.ts` to also export `./codegen` and `./spec`.

```bash
git add src/lib/curate/codegen/index.ts src/lib/curate/index.ts
git commit -m "feat(curate): codegen barrel + curate index update"
```

### Task 12: Final sweep

- [ ] **Step 1: Run all curate tests**

```bash
npm test -- tests/lib/curate/
```

Expected: previous 13 still pass, plus 7 new (validate × 5, definition × 1, executor × 1, panel × 1, docs × 1, registry-patch × 2, index-patch × 2, write-files × 2). Total ≥ 25.

- [ ] **Step 2: tsc clean for new files**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "src/lib/curate|tests/lib/curate" | head -20
```

- [ ] **Step 3: Full suite baseline check**

```bash
npm test 2>&1 | tail -3
```

12 pre-existing failures unchanged.

- [ ] **Step 4: Inspect a generated panel by eye**

Open `tests/__fixtures__/curate-codegen/expected/AppleCalendarPanel.svelte.txt` and read it as if you'd just written it by hand. Common issues to check:
- All conditional sections wrapped in `{#if evalCond(...)}`
- Imports match the widgets used (no extras, no missing)
- The `<style>` block at the bottom has the right tokens

If you spot a real issue, fix the emitter and regenerate the golden — then run the tests again.

---

## Self-Review Checklist

- [ ] All 12 tasks committed individually
- [ ] `npm test -- tests/lib/curate/codegen/` clean
- [ ] All goldens committed and match emitter output exactly
- [ ] `tsc --noEmit --skipLibCheck` clean for codegen paths
- [ ] Pre-existing baseline unchanged
- [ ] Each emitter is a pure function (no fs / network / state)
- [ ] `writeNodeFiles` is idempotent (test verifies)
- [ ] `validateNodeSpec` runs at the top of `writeNodeFiles` so bad specs never reach disk
- [ ] No `console.log` in committed code

---

## Out of scope for B2 — handled in B3

- The discovery toolkit (web/context7/repo-readers/sandbox probe)
- The phase state machine
- Live test runner
- Promote pipeline
- `/jkai/curate` UI

## Out of scope entirely (deferred)

- `key-value-list`, `code-block`, `enum-with-icons` widgets
- `tabs` panel layout
- Custom action buttons beyond `test-connection`
- AST-based registry/index patches (string-based is good enough for now)
- `optionsResolvers` registration into the integration adapter (B3 wires this when generated nodes register at runtime)

---

## Notes for the executing agent

- **Golden tests are character-perfect.** Whitespace and line endings matter. Always use `expect(got).toBe(want)`, never `.toContain()`, for goldens. If a golden mismatch happens, decide: bug in emitter, or stale golden? Fix one or the other.
- **Generating a golden initially**: use the `npx tsx -e ...` pattern shown in each task. After generating, **inspect the file** before running the test — that's your one-time sanity check that the emitter output is sensible. Once committed, the test enforces it.
- **`npx tsx` resolution**: if running scripts that import `$lib/...` aliases needs the scripts tsconfig, use `npx tsx --tsconfig scripts/tsconfig.scripts.json ...` (set up in B1).
- **Patchers are string-based.** For the v1 scope this is fine, since the BASE files we patch are well-shaped and predictable. If a future BASE format change breaks a patcher, the golden test will catch it on the next CI run.
- **Don't modify the live `panels/registry.ts` or `workflows/index.ts`** during testing — only the fixture base files in `tests/__fixtures__/curate-codegen/`. The patchers will modify the live files only when called from B3's curate engine inside a session worktree.
