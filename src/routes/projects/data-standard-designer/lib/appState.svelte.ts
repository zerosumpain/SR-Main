// Shared reactive state for the Data Standard Designer (Svelte 5 runes).
//
// One store, imported by every sub-route, so the brief and schema persist as
// the user moves between Brief → Schema → Interoperability → Impact → Publish.
// All the heavy thinking is derived, so editing a field re-scores everything
// live — the core "play with it and see the impact" experience.

import type { Brief, Field, FieldType, Sector, ProviderEntry, ConsumerEntry, FieldTemplate, StandardEntry } from './types';
import { IDENTIFIERS, standardById } from './knowledge';
import { codelistById } from './codelists';
import { legalById, summariseLegalBasis, legalCompleteness } from './legalBasis';
import {
  recommend,
  interoperabilityScore,
  assuranceScore,
  adoptionScore,
  crosswalk,
  stakeholders,
  availability,
} from './engine';
import type { ExportInput } from './exporters';

export type Mode = 'analyst' | 'architect';

export function emptyBrief(): Brief {
  return {
    name: '',
    purpose: '',
    domain: 'education',
    providers: [],
    consumers: [],
    processingPurposes: [],
    containsPersonalData: true,
    containsSpecialCategory: false,
    aboutChildren: false,
    geographicCoverage: 'England — national',
    legalBasis: '',
    legalBasisIds: [],
    interopGoal: 'high',
    notes: '',
  };
}

let SEQ = 0;
export function newFieldId(): string {
  SEQ += 1;
  return `f${SEQ}_${Date.now().toString(36)}`;
}

export function fieldFromTemplate(t: FieldTemplate): Field {
  const { domains, why, ...rest } = t;
  return { id: newFieldId(), ...rest };
}

class DesignerState {
  mode = $state<Mode>('analyst');
  brief = $state<Brief>(emptyBrief());
  fields = $state<Field[]>([]);
  version = $state('0.1.0');
  mounted = $state(false);
  /** Catalog entries merged in from the research workflow (optional enrichment). */
  researchCatalog = $state<StandardEntry[]>([]);
  /** The catalog standard currently open in the explorer drawer (id), if any. */
  exploreStandardId = $state<string | null>(null);

  // ---- derived intelligence (recomputes on every edit) ----
  rec = $derived.by(() => recommend(this.brief));
  interop = $derived.by(() => interoperabilityScore(this.brief, this.fields));
  assurance = $derived.by(() => assuranceScore(this.brief, this.fields));
  adoption = $derived.by(() => adoptionScore(this.brief, this.fields));
  crosswalkEdges = $derived.by(() => crosswalk(this.fields));
  stakeholderRows = $derived.by(() => stakeholders(this.brief, this.fields));
  availabilityRows = $derived.by(() => availability(this.brief, this.fields));
  overall = $derived.by(() => Math.round((this.interop.value + this.assurance.value + this.adoption.value) / 3));

  // ---- mode ----
  setMode(m: Mode) { this.mode = m; }

  // ---- fields ----
  addField(f?: Partial<Field>) {
    this.fields = [
      ...this.fields,
      {
        id: newFieldId(),
        name: f?.name || 'new_field',
        title: f?.title || 'New field',
        type: f?.type || 'string',
        description: f?.description || '',
        required: f?.required ?? false,
        pii: f?.pii ?? false,
        specialCategory: f?.specialCategory ?? false,
        ...f,
      } as Field,
    ];
  }
  addTemplate(t: FieldTemplate) {
    // avoid duplicates by machine name
    if (this.fields.some((f) => f.name === t.name)) return;
    this.fields = [...this.fields, fieldFromTemplate(t)];
  }
  updateField(id: string, patch: Partial<Field>) {
    this.fields = this.fields.map((f) => (f.id === id ? { ...f, ...patch } : f));
  }
  removeField(id: string) {
    this.fields = this.fields.filter((f) => f.id !== id);
  }
  moveField(id: string, dir: -1 | 1) {
    const i = this.fields.findIndex((f) => f.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= this.fields.length) return;
    const next = [...this.fields];
    [next[i], next[j]] = [next[j], next[i]];
    this.fields = next;
  }

  // ---- providers / consumers ----
  addProvider(p?: Partial<ProviderEntry>) {
    this.brief.providers = [
      ...this.brief.providers,
      { id: newFieldId(), label: p?.label || '', sector: p?.sector || 'schools', ownership: p?.ownership || 'public', existingStandards: p?.existingStandards || [], systemsHeld: p?.systemsHeld || '', burdenSensitivity: p?.burdenSensitivity || 'medium' },
    ];
  }
  updateProvider(id: string, patch: Partial<ProviderEntry>) {
    this.brief.providers = this.brief.providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
  }
  removeProvider(id: string) {
    this.brief.providers = this.brief.providers.filter((p) => p.id !== id);
  }
  addConsumer(c?: Partial<ConsumerEntry>) {
    this.brief.consumers = [...this.brief.consumers, { id: newFieldId(), label: c?.label || '', sector: c?.sector || 'central-gov', use: c?.use || '' }];
  }
  updateConsumer(id: string, patch: Partial<ConsumerEntry>) {
    this.brief.consumers = this.brief.consumers.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }
  removeConsumer(id: string) {
    this.brief.consumers = this.brief.consumers.filter((c) => c.id !== id);
  }
  togglePurpose(p: string) {
    const has = this.brief.processingPurposes.includes(p);
    this.brief.processingPurposes = has ? this.brief.processingPurposes.filter((x) => x !== p) : [...this.brief.processingPurposes, p];
  }
  toggleLegalBasis(id: string) {
    if (!legalById(id)) return;
    const has = this.brief.legalBasisIds.includes(id);
    this.brief.legalBasisIds = has ? this.brief.legalBasisIds.filter((x) => x !== id) : [...this.brief.legalBasisIds, id];
  }
  // Human-readable summary of the structured legal basis, for exports.
  legalBasisSummary = $derived(summariseLegalBasis(this.brief.legalBasisIds));
  // A+B+C completeness of the legal basis given the data characteristics.
  legalBasisCheck = $derived(
    legalCompleteness(this.brief.legalBasisIds, {
      personal: this.brief.containsPersonalData,
      special: this.brief.containsSpecialCategory || this.brief.aboutChildren,
    }),
  );

  // ---- bulk ----
  applyRecommendedFields(templates: FieldTemplate[]) {
    for (const t of templates) this.addTemplate(t);
  }

  // ---- explore / ingest catalog standards ----
  openStandard(id: string) { this.exploreStandardId = id; }
  closeStandard() { this.exploreStandardId = null; }
  /** Append fields (e.g. ingested from a standard), skipping duplicate machine names. */
  ingestFields(fields: Field[]) {
    const existing = new Set(this.fields.map((f) => f.name));
    const add = fields.filter((f) => f.name && !existing.has(f.name)).map((f) => ({ ...f, id: f.id || newFieldId() }));
    this.fields = [...this.fields, ...add];
    return add.length;
  }
  loadDesign(d: { brief: Brief; fields: Field[]; version?: string }) {
    const b = d.brief || emptyBrief();
    this.brief = {
      ...emptyBrief(),
      ...b,
      // ensure every entity carries a unique key (presets ship with empty ids)
      providers: (b.providers || []).map((p) => ({ ...p, id: p.id || newFieldId() })),
      consumers: (b.consumers || []).map((c) => ({ ...c, id: c.id || newFieldId() })),
      legalBasisIds: (Array.isArray(b.legalBasisIds) ? b.legalBasisIds : []).filter((x: string) => legalById(x)),
    };
    this.fields = (d.fields || []).map((f) => ({ ...f, id: f.id || newFieldId() }));
    if (d.version) this.version = d.version;
  }
  reset() {
    this.brief = emptyBrief();
    this.fields = [];
    this.version = '0.1.0';
  }

  /** Apply an LLM assistant design/revision, defensively sanitised + clamped to
   *  the engine's valid vocabulary, with fresh ids assigned. */
  applyAssistantDesign(parsed: any) {
    if (!parsed || typeof parsed !== 'object') return;
    const DOMAINS: Sector[] = ['education', 'childrens-social-care', 'child-protection', 'health', 'local-gov', 'cross-gov', 'employment', 'justice', 'housing'];
    const TYPES: FieldType[] = ['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'enum', 'identifier', 'geo', 'currency', 'object', 'array'];
    const idOk = (v: any) => (IDENTIFIERS.some((i) => i.id === v) ? v : undefined);
    const clOk = (v: any) => (codelistById(v) ? v : undefined);
    const stdOk = (v: any) => (standardById(v) ? v : undefined);
    const b = parsed.brief || {};
    const next = emptyBrief();
    if (b.name) next.name = String(b.name).slice(0, 120);
    if (b.purpose) next.purpose = String(b.purpose).slice(0, 1000);
    if (DOMAINS.includes(b.domain)) next.domain = b.domain;
    if (Array.isArray(b.processingPurposes)) next.processingPurposes = b.processingPurposes.map((x: any) => String(x)).slice(0, 12);
    next.containsPersonalData = b.containsPersonalData !== false;
    next.containsSpecialCategory = !!b.containsSpecialCategory;
    next.aboutChildren = !!b.aboutChildren;
    if (b.geographicCoverage) next.geographicCoverage = String(b.geographicCoverage).slice(0, 120);
    if (b.legalBasis) next.legalBasis = String(b.legalBasis).slice(0, 300);
    if (Array.isArray(b.legalBasisIds)) next.legalBasisIds = b.legalBasisIds.filter((x: any) => legalById(x)).slice(0, 24);
    if (['low', 'medium', 'high'].includes(b.interopGoal)) next.interopGoal = b.interopGoal;
    next.providers = (Array.isArray(b.providers) ? b.providers : []).slice(0, 10).map((p: any) => ({
      id: newFieldId(),
      label: String(p?.label || '').slice(0, 120),
      sector: p?.sector || 'other',
      ownership: ['public', 'private', 'voluntary', 'mixed'].includes(p?.ownership) ? p.ownership : 'public',
      existingStandards: (Array.isArray(p?.existingStandards) ? p.existingStandards : []).map(stdOk).filter(Boolean),
      systemsHeld: String(p?.systemsHeld || '').slice(0, 160),
      burdenSensitivity: ['low', 'medium', 'high'].includes(p?.burdenSensitivity) ? p.burdenSensitivity : 'medium',
    }));
    next.consumers = (Array.isArray(b.consumers) ? b.consumers : []).slice(0, 10).map((c: any) => ({
      id: newFieldId(),
      label: String(c?.label || '').slice(0, 120),
      sector: c?.sector || 'central-gov',
      use: String(c?.use || '').slice(0, 200),
    }));
    this.brief = next;

    const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
    this.fields = fields.slice(0, 60).map((f: any) => ({
      id: newFieldId(),
      name: String(f?.name || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'field',
      title: String(f?.title || f?.name || 'Field').slice(0, 120),
      type: TYPES.includes(f?.type) ? f.type : 'string',
      description: String(f?.description || '').slice(0, 500),
      required: !!f?.required,
      pii: !!f?.pii,
      specialCategory: !!f?.specialCategory,
      identifier: idOk(f?.identifier),
      codelistId: clOk(f?.codelistId),
      codelist: clOk(f?.codelistId) ? undefined : (f?.codelist ? String(f.codelist).slice(0, 120) : undefined),
      sourceStandard: stdOk(f?.sourceStandard),
      format: f?.format ? String(f.format).slice(0, 120) : undefined,
    })) as Field[];
  }

  toExportInput(): ExportInput {
    return {
      brief: this.brief,
      fields: this.fields,
      rec: this.rec,
      scores: { interop: this.interop, assurance: this.assurance, adoption: this.adoption },
      crosswalk: this.crosswalkEdges,
      version: this.version,
    };
  }
}

export const app = new DesignerState();
