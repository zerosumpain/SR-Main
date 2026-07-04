// authorState.svelte.ts — the shared, reactive state for the Author workspace.
// A single rune-backed store imported by the /author page and its components.
// Holds the strategy document being written, the plan (roadmap/risks/measures),
// snapshots, and UI state. Persistence lives here (guarded by `mounted`, set by
// the page after hydration) — keys: keystone-author-v1 / -snaps-v1 / -plan-v1.

import { newDoc, TEMPLATE_BY_ID, type StrategyDoc, type StrategySection } from './templates';
import { sanitizeHtml } from './sanitize';
import { runCoverage, type CoverageResult } from './coverage';
import { runHeuristics, type HeuristicResult } from './heuristics';
import { htmlToText } from './serialize';

export type AuthorTab = 'diagnose' | 'interview' | 'draft' | 'verify' | 'plan' | 'export';

export interface Snapshot {
  id: string;
  name: string;
  at: number;
  doc: StrategyDoc;
}

export interface Milestone {
  id: string;
  title: string;
  quarter: string; // e.g. '2026-Q4'
  owner: string;
  sectionId?: string;
  commitmentId?: string;
  done?: boolean;
}

export interface Risk {
  id: string;
  title: string;
  likelihood: number; // 1–5
  impact: number; // 1–5
  mitigation: string;
  sectionId?: string;
}

export interface MeasureChoice {
  id: string; // measure library id or custom
  name: string;
  source: string;
  sectionId?: string;
  baseline?: string;
  target?: string;
}

export interface StakeholderCheck {
  name: string;
  status: 'not-started' | 'planned' | 'consulted';
}

export interface DeepReview {
  at: number;
  sections: { id: string; score: number; verdict: string; strengths: string[]; weaknesses: string[]; suggestions: string[] }[];
  document: { score: number; verdict: string; contradictions: string[]; topFixes: string[]; missingComponents: string[] };
}

const DOC_KEY = 'keystone-author-v1';
const SNAP_KEY = 'keystone-author-snaps-v1';
const PLAN_KEY = 'keystone-author-plan-v1';

let counter = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(++counter).toString(36)}`;

class AuthorState {
  doc = $state<StrategyDoc>(newDoc());
  activeId = $state<string>(SECTION_FALLBACK());
  tab = $state<AuthorTab>('draft');
  snapshots = $state<Snapshot[]>([]);

  /** Switch workspace tab AND sync the URL's ?tab= param. The layout swaps between the
   *  levers shell and the plain main around the Diagnose tab, which remounts the page —
   *  onMount then re-applies ?tab from the URL, so the URL must never lag the store. */
  setTab(t: AuthorTab) {
    this.tab = t;
    if (typeof location === 'undefined' || !/\/author\/?$/.test(location.pathname)) return;
    try {
      const url = new URL(location.href);
      if (t === 'draft') url.searchParams.delete('tab');
      else url.searchParams.set('tab', t);
      history.replaceState(history.state, '', url);
    } catch {
      /* ignore */
    }
  }
  milestones = $state<Milestone[]>([]);
  risks = $state<Risk[]>([]);
  measures = $state<MeasureChoice[]>([]);
  stakeholders = $state<StakeholderCheck[]>([]);
  review = $state<DeepReview | null>(null);
  mounted = $state(false);

  // ---- derived diagnostics (instant, deterministic) ----
  coverage: CoverageResult = $derived(runCoverage(this.doc));
  heuristicsBySection: Record<string, HeuristicResult[]> = $derived.by(() => {
    const out: Record<string, HeuristicResult[]> = {};
    for (const s of this.doc.sections) out[s.id] = runHeuristics(s, s.templateId ? (TEMPLATE_BY_ID[s.templateId] ?? null) : null);
    return out;
  });
  wordCounts: Record<string, number> = $derived.by(() => {
    const out: Record<string, number> = {};
    for (const s of this.doc.sections) {
      const t = htmlToText(s.html);
      out[s.id] = t ? t.split(/\s+/).filter(Boolean).length : 0;
    }
    return out;
  });
  totalWords = $derived(Object.values(this.wordCounts).reduce((a, b) => a + b, 0));
  active = $derived(this.doc.sections.find((s) => s.id === this.activeId) ?? this.doc.sections[0]);

  // ---- document mutations ----
  private touch() {
    this.doc = { ...this.doc, updatedAt: Date.now() };
  }
  setTitle(title: string) {
    this.doc = { ...this.doc, title: title.trim() || 'DfE data strategy — working draft', updatedAt: Date.now() };
  }
  setHtml(sectionId: string, html: string) {
    const i = this.doc.sections.findIndex((s) => s.id === sectionId);
    if (i < 0) return;
    const sections = [...this.doc.sections];
    sections[i] = { ...sections[i], html: sanitizeHtml(html) };
    this.doc = { ...this.doc, sections, updatedAt: Date.now() };
  }
  appendHtml(sectionId: string, html: string) {
    const i = this.doc.sections.findIndex((s) => s.id === sectionId);
    if (i < 0) return;
    const sections = [...this.doc.sections];
    sections[i] = { ...sections[i], html: sanitizeHtml(sections[i].html + html) };
    this.doc = { ...this.doc, sections, updatedAt: Date.now() };
  }
  renameSection(sectionId: string, title: string) {
    const i = this.doc.sections.findIndex((s) => s.id === sectionId);
    if (i < 0 || !title.trim()) return;
    const sections = [...this.doc.sections];
    sections[i] = { ...sections[i], title: title.trim() };
    this.doc = { ...this.doc, sections, updatedAt: Date.now() };
  }
  addSection(title: string, templateId: string | null = null) {
    const s: StrategySection = { id: uid('s'), templateId, title: title.trim() || 'New section', html: '' };
    this.doc = { ...this.doc, sections: [...this.doc.sections, s], updatedAt: Date.now() };
    this.activeId = s.id;
  }
  removeSection(sectionId: string) {
    if (this.doc.sections.length <= 1) return;
    this.doc = { ...this.doc, sections: this.doc.sections.filter((s) => s.id !== sectionId), updatedAt: Date.now() };
    if (this.activeId === sectionId) this.activeId = this.doc.sections[0].id;
  }
  moveSection(sectionId: string, dir: -1 | 1) {
    const i = this.doc.sections.findIndex((s) => s.id === sectionId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.doc.sections.length) return;
    const sections = [...this.doc.sections];
    [sections[i], sections[j]] = [sections[j], sections[i]];
    this.doc = { ...this.doc, sections, updatedAt: Date.now() };
  }
  resetDoc() {
    this.doc = newDoc();
    this.activeId = this.doc.sections[0].id;
    this.review = null;
  }
  importDoc(doc: StrategyDoc) {
    // defensive: sanitize + revalidate every section
    const sections = (doc.sections ?? [])
      .filter((s) => s && typeof s.html === 'string' && typeof s.title === 'string')
      .map((s) => ({
        id: typeof s.id === 'string' && s.id ? s.id : uid('s'),
        templateId: typeof s.templateId === 'string' ? s.templateId : null,
        title: s.title.slice(0, 120),
        html: sanitizeHtml(s.html),
      }));
    if (!sections.length) return false;
    this.doc = { title: String(doc.title ?? 'Imported strategy').slice(0, 160), sections, updatedAt: Date.now() };
    this.activeId = sections[0].id;
    this.review = null;
    return true;
  }

  // ---- snapshots ----
  takeSnapshot(name: string) {
    const snap: Snapshot = {
      id: uid('snap'),
      name: name.trim() || `Snapshot ${new Date().toLocaleDateString('en-GB')}`,
      at: Date.now(),
      doc: JSON.parse(JSON.stringify($state.snapshot(this.doc))),
    };
    this.snapshots = [snap, ...this.snapshots].slice(0, 20);
  }
  restoreSnapshot(id: string) {
    const snap = this.snapshots.find((s) => s.id === id);
    if (snap) {
      this.doc = JSON.parse(JSON.stringify(snap.doc));
      this.activeId = this.doc.sections[0]?.id ?? this.activeId;
      this.touch();
    }
  }
  deleteSnapshot(id: string) {
    this.snapshots = this.snapshots.filter((s) => s.id !== id);
  }

  // ---- plan ----
  addMilestone(m: Omit<Milestone, 'id'>) {
    this.milestones = [...this.milestones, { ...m, id: uid('m') }];
  }
  updateMilestone(id: string, patch: Partial<Milestone>) {
    this.milestones = this.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m));
  }
  removeMilestone(id: string) {
    this.milestones = this.milestones.filter((m) => m.id !== id);
  }
  addRisk(r: Omit<Risk, 'id'>) {
    this.risks = [...this.risks, { ...r, id: uid('r') }];
  }
  updateRisk(id: string, patch: Partial<Risk>) {
    this.risks = this.risks.map((r) => (r.id === id ? { ...r, ...patch } : r));
  }
  removeRisk(id: string) {
    this.risks = this.risks.filter((r) => r.id !== id);
  }
  addMeasure(m: MeasureChoice) {
    if (!this.measures.some((x) => x.id === m.id && x.sectionId === m.sectionId)) this.measures = [...this.measures, m];
  }
  updateMeasure(id: string, patch: Partial<MeasureChoice>) {
    this.measures = this.measures.map((m) => (m.id === id ? { ...m, ...patch } : m));
  }
  removeMeasure(id: string) {
    this.measures = this.measures.filter((m) => m.id !== id);
  }
  setStakeholder(name: string, status: StakeholderCheck['status']) {
    const i = this.stakeholders.findIndex((s) => s.name === name);
    if (i >= 0) this.stakeholders = this.stakeholders.map((s) => (s.name === name ? { ...s, status } : s));
    else this.stakeholders = [...this.stakeholders, { name, status }];
  }

  // ---- persistence (called from the page) ----
  load() {
    try {
      const raw = localStorage.getItem(DOC_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.doc?.sections?.length) {
          this.importDoc(p.doc);
          if (typeof p.activeId === 'string') this.activeId = p.activeId;
        }
      }
    } catch {
      /* corrupt state — keep the fresh doc */
    }
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (raw) this.snapshots = JSON.parse(raw) ?? [];
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(PLAN_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        this.milestones = p?.milestones ?? [];
        this.risks = p?.risks ?? [];
        this.measures = p?.measures ?? [];
        this.stakeholders = p?.stakeholders ?? [];
        this.review = p?.review ?? null;
      }
    } catch {
      /* ignore */
    }
    this.mounted = true;
  }
  persist() {
    if (!this.mounted) return;
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify({ doc: $state.snapshot(this.doc), activeId: this.activeId }));
      localStorage.setItem(SNAP_KEY, JSON.stringify($state.snapshot(this.snapshots)));
      localStorage.setItem(
        PLAN_KEY,
        JSON.stringify({
          milestones: $state.snapshot(this.milestones),
          risks: $state.snapshot(this.risks),
          measures: $state.snapshot(this.measures),
          stakeholders: $state.snapshot(this.stakeholders),
          review: $state.snapshot(this.review),
        }),
      );
    } catch {
      /* quota */
    }
  }
}

function SECTION_FALLBACK(): string {
  return 'vision';
}

export const author = new AuthorState();
