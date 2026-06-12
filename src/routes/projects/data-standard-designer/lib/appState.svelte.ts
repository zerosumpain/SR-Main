// Shared reactive state for the Data Standard Designer (Svelte 5 runes).
//
// One store, imported by every sub-route, so the brief and schema persist as
// the user moves between Brief → Schema → Interoperability → Impact → Publish.
// All the heavy thinking is derived, so editing a field re-scores everything
// live — the core "play with it and see the impact" experience.

import type { Brief, Field, ProviderEntry, ConsumerEntry, FieldTemplate, StandardEntry } from './types';
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

  // ---- bulk ----
  applyRecommendedFields(templates: FieldTemplate[]) {
    for (const t of templates) this.addTemplate(t);
  }
  loadDesign(d: { brief: Brief; fields: Field[]; version?: string }) {
    const b = d.brief || emptyBrief();
    this.brief = {
      ...emptyBrief(),
      ...b,
      // ensure every entity carries a unique key (presets ship with empty ids)
      providers: (b.providers || []).map((p) => ({ ...p, id: p.id || newFieldId() })),
      consumers: (b.consumers || []).map((c) => ({ ...c, id: c.id || newFieldId() })),
    };
    this.fields = (d.fields || []).map((f) => ({ ...f, id: f.id || newFieldId() }));
    if (d.version) this.version = d.version;
  }
  reset() {
    this.brief = emptyBrief();
    this.fields = [];
    this.version = '0.1.0';
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
