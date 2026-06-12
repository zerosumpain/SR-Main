// Core domain model for the Data Standard Designer.
//
// A "standard" produced by this tool is a Brief (why the data exists, who
// provides and consumes it, what it is processed for) plus a Schema (the
// fields, their types, identifiers, codelists and metadata). The engine reads
// both against a grounded knowledge base of existing UK/international gov data
// standards to propose fields, identifiers, formats, cadence and a crosswalk,
// and to score the design for interoperability, assurance and adoption.

/** Broad domain a dataset belongs to. Drives which standards the engine reaches for. */
export type Sector =
  | 'education'
  | 'childrens-social-care'
  | 'child-protection'
  | 'health'
  | 'local-gov'
  | 'cross-gov'
  | 'employment'
  | 'justice'
  | 'housing'
  | 'voluntary'
  | 'private'
  | 'international'
  | 'metadata'
  | 'interoperability';

/** The kind of organisation that supplies the data. Determines collection method + burden. */
export type ProviderSector =
  | 'schools'
  | 'multi-academy-trusts'
  | 'local-authorities'
  | 'nhs-health'
  | 'early-years'
  | 'further-education'
  | 'higher-education'
  | 'police'
  | 'housing'
  | 'private-providers'
  | 'voluntary-sector'
  | 'central-gov'
  | 'other';

export type Ownership = 'public' | 'private' | 'voluntary' | 'mixed';

export type Cadence =
  | 'real-time'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'termly'
  | 'quarterly'
  | 'annual'
  | 'biannual'
  | 'ad-hoc'
  | 'one-off';

export type SerializationFormat = 'csv' | 'json' | 'xml' | 'fhir' | 'rdf' | 'parquet' | 'xlsx';

export type CollectionMethod =
  | 'mis-extract'
  | 'statutory-return'
  | 'rest-api'
  | 'event-stream'
  | 'bulk-upload'
  | 'manual-form'
  | 'register-sync';

/** One organisation (or class of organisation) that supplies records to the dataset. */
export interface ProviderEntry {
  id: string;
  label: string;
  sector: ProviderSector;
  ownership: Ownership;
  /** ids (in the knowledge catalog) of standards this provider already holds the data in. */
  existingStandards: string[];
  /** Free text: the systems they keep this data in today (e.g. "SIMS / Arbor MIS"). */
  systemsHeld: string;
  /** How sensitive they are to extra reporting burden. Feeds the adoption score. */
  burdenSensitivity: 'low' | 'medium' | 'high';
}

/** One organisation (or class) that uses the data downstream. */
export interface ConsumerEntry {
  id: string;
  label: string;
  sector: ProviderSector | Sector;
  /** What they do with it. */
  use: string;
}

/** The "why and who" of the dataset — captured first, in plain language. */
export interface Brief {
  name: string;
  /** What the dataset is for, in one or two sentences. */
  purpose: string;
  domain: Sector;
  /** Upstream — who collects / supplies the data. */
  providers: ProviderEntry[];
  /** Downstream — who consumes it and for what. */
  consumers: ConsumerEntry[];
  /** What the data will be processed for (analysis, operational use, accountability, research...). */
  processingPurposes: string[];
  /** Data-protection characteristics. */
  containsPersonalData: boolean;
  containsSpecialCategory: boolean;
  aboutChildren: boolean;
  /** national | regional | local-authority | institution | individual. */
  geographicCoverage: string;
  /** Free-text lawful-basis notes (kept for detail beyond the structured picks). */
  legalBasis: string;
  /** Selected legal-basis registry node ids (Layer A data-protection basis,
   *  Layer B power/gateway, Layer C governance) — see lib/legalBasis.ts. */
  legalBasisIds: string[];
  /** How hard the team wants to push interoperability. */
  interopGoal: 'low' | 'medium' | 'high';
  notes: string;
}

export type FieldType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'identifier'
  | 'geo'
  | 'currency'
  | 'object'
  | 'array';

/** One column / data element in the schema. */
export interface Field {
  id: string;
  /** Machine name (snake_case). */
  name: string;
  /** Human-readable label. */
  title: string;
  type: FieldType;
  description: string;
  required: boolean;
  /** Personal data (identifies a living individual). */
  pii: boolean;
  /** Special-category / sensitive data (UK GDPR Art.9). */
  specialCategory: boolean;
  /** If this field carries a known identifier, the id in IDENTIFIERS. */
  identifier?: string;
  /** Controlled vocabulary / codelist reference (human name or URL). */
  codelist?: string;
  /** Id into CODELISTS when the permissible values are enumerated. */
  codelistId?: string;
  /** Format hint: ISO 8601, GSS code, a regex, etc. */
  format?: string;
  unit?: string;
  example?: string;
  /** Provenance: the catalog id of the standard this field was drawn from. */
  sourceStandard?: string;
  /** Validation note shown to architects. */
  constraints?: string;
}

// ---------------------------------------------------------------------------
// Knowledge base shapes
// ---------------------------------------------------------------------------

/** A real-world data standard the engine knows about. */
export interface StandardEntry {
  id: string;
  name: string;
  owner: string;
  sector: Sector;
  description: string;
  dataCovered?: string;
  keyFields?: string[];
  identifiers?: string[];
  metadataApproach?: string;
  formats?: string[];
  collectionMethod?: string;
  frequency?: string;
  publishing?: string;
  interoperability?: string;
  assurance?: string;
  connectsTo?: string[];
  urls?: string[];
  /** Cadence used for harmonisation suggestions, where known. */
  cadence?: Cadence;
}

/** A reusable identifier (UPN, NHS number, UPRN...). Reuse is the single biggest interoperability win. */
export interface IdentifierEntry {
  id: string;
  name: string;
  /** What it identifies (a pupil, a school, a person, a property...). */
  scope: string;
  owner: string;
  /** Format / pattern, human readable. */
  format: string;
  sectors: Sector[];
  /** Where a provider would already hold it. */
  heldBy: string;
  /** Legal / practical caveat on reuse. */
  caveat?: string;
  url?: string;
}

/** A rule the engine uses to map a brief to recommendations. */
export interface EngineHeuristic {
  id: string;
  /** Human description of the condition. */
  when: string;
  /** Predicate evaluated against a Brief. */
  match: (b: Brief) => boolean;
  recommendStandards?: string[];
  recommendIdentifiers?: string[];
  metadata?: string;
  format?: SerializationFormat;
  collection?: CollectionMethod;
  frequency?: Cadence;
  rationale: string;
  /** Weight when several heuristics fire. */
  weight?: number;
}

export interface Relationship {
  from: string;
  to: string;
  nature:
    | 'shares-identifier'
    | 'feeds'
    | 'profiles'
    | 'supersedes'
    | 'aligns-with'
    | 'depends-on'
    | 'publishes-via';
  note?: string;
}

export interface MethodEntry {
  id: string;
  title: string;
  category: 'schema-design' | 'metadata' | 'interoperability' | 'assurance' | 'adoption' | 'legal' | 'governance';
  summary: string;
  appliesTo?: string;
  source?: string;
}

/** A ready-to-load field template grouped by domain. */
export interface FieldTemplate extends Omit<Field, 'id'> {
  /** which domains this template is offered for. */
  domains: Sector[];
  /** human reason this field is suggested. */
  why: string;
}

// ---------------------------------------------------------------------------
// Engine output shapes
// ---------------------------------------------------------------------------

export interface ScoreBreakdownItem {
  label: string;
  /** -1..1 contribution (negative = penalty). */
  delta: number;
  detail: string;
  met: boolean;
}

export interface Score {
  /** 0..100. */
  value: number;
  band: 'low' | 'developing' | 'good' | 'strong';
  items: ScoreBreakdownItem[];
}

export interface Recommendation {
  standards: StandardEntry[];
  identifiers: IdentifierEntry[];
  metadataStandard: string;
  format: { value: SerializationFormat; rationale: string };
  collection: { value: CollectionMethod; rationale: string };
  frequency: { value: Cadence; rationale: string; sympathetic: string[] };
  rationaleLines: string[];
}

export interface CrosswalkEdge {
  standardId: string;
  standardName: string;
  via: string; // shared identifier / aligned field
  fieldName: string;
  nature: string;
}

export interface StakeholderRow {
  stakeholder: string;
  kind: 'provider' | 'consumer' | 'data-subject' | 'regulator';
  burden: 'low' | 'medium' | 'high';
  value: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  note: string;
}

export interface AvailabilityRow {
  fieldName: string;
  heldBy: string;
  availability: 'already-held' | 'partially-held' | 'new-collection';
  sector: 'public' | 'private' | 'mixed';
  note: string;
}
