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
