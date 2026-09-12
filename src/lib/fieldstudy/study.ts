/**
 * The Field Study content model — the TypeScript face of
 * `field-study-system/content.schema.json`.
 *
 * A study is authored as DATA. Each beat names a template; the template
 * decides the markup. That separation is the whole reason the system is
 * automatable: choosing a template and filling slots is a decision a machine
 * can make and a checklist can audit, whereas "design this page" is not.
 *
 * These types are hand-kept in step with the schema, and
 * `fieldstudy/validate.ts` re-checks the invariants the type system cannot
 * express — a risk column at least as long as its benefit column, a total that
 * reconciles to its rows, three findings before beat 01. A schema failure is a
 * CONTENT failure: fix the content, never loosen the schema.
 */

export type Confidence = 'fact' | 'hypothesis' | 'contested';

/** The depth control's three registers. Technical falls back to research. */
export type Depth = 'plain' | 'research' | 'technical';

/**
 * A string that may carry more than one register.
 *
 * The shell ships a Research / ELI5 control, but only `prose` ever honoured it,
 * and only T1 and T2 were handed the depth at all — so on a ledger or a
 * position beat the control moved nothing, and even on an argument beat the
 * claim, the standfirst, the so-what and every caption stayed in research
 * register. A reader who asked for plain English got the same page back.
 *
 * A bare string is research-only and falls back at every depth, so existing
 * content keeps working untouched. Anything a reader actually reads should
 * grow the object form.
 */
export type Dual = string | { research: string; plain?: string; technical?: string };

/** Resolve a Dual at a depth. Technical → research → plain, never empty. */
export function say(v: Dual | undefined, depth: Depth = 'research'): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (depth === 'plain') return v.plain ?? v.research;
  if (depth === 'technical') return v.technical ?? v.research;
  return v.research;
}

/** Does this carry a plain register of its own? Used by the coverage tests. */
export function hasPlain(v: Dual | undefined): boolean {
  return typeof v === 'object' && v !== null && typeof v.plain === 'string' && v.plain.length > 0;
}

export type TemplateId = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';

/** The categorical hues, licensed inside a legend and the marks it labels —
 *  never in chrome, never on a claim. */
export type CategoryTag =
  | 'identifier' | 'operational' | 'standards' | 'trust' | 'infrastructure';

/** An index into `study.sources`, 1-based, as printed in the citation. */
export type SourceRef = number;

export interface Claim {
  /** Inline <b> permitted on the load-bearing noun only. */
  text: Dual;
  confidence: Confidence;
  cites?: SourceRef[];
  /**
   * In a T4 ledger: the lenses this claim bites hardest for. The template
   * re-ranks by it — a tagged claim rises to the top of its column when that
   * lens is active — and never filters, because a row vanishing when you
   * change whose eyes you are looking through is how a ledger stops being one.
   *
   * A lens nobody tags and no actor row carries is a control that does
   * nothing, so T4 does not render a button for it.
   */
  lenses?: string[];
}

export interface Prose {
  /** The depth control's three registers. Technical falls back to research. */
  plain?: string;
  research: string;
  technical?: string;
  dropCap?: boolean;
}

export interface MarginNote {
  label?: string;
  text: Dual;
}

export interface Figure {
  /** `n.m` — beat number, then figure number within the beat. */
  no: string;
  /** Italic serif. Where the author admits what the chart leaves out. */
  caption: Dual;
  chart: string;
  /** What the numbers are counted in, printed on the axis. */
  unit?: string;
  data?: unknown;
  cites?: SourceRef[];
}

export interface OpenQuestion {
  text: Dual;
  /** What would change the author's mind. Mandatory — this is the point. */
  falsifier: string;
}

export type SourceKind =
  | 'white paper' | 'hansard' | 'regulator' | 'market data'
  | 'technical' | 'press' | 'legislation' | 'research';

export interface Source {
  n: number;
  org: string;
  what: string;
  url: string;
  kind: SourceKind;
  asOf?: string;
  /** What this source does NOT settle. Printed with the citation, not hidden. */
  caveat?: string;
}

export interface SurveyRow {
  /** `undefined` is a cell the source genuinely does not carry — printed as a
   *  dash rather than a zero, because a missing count and a count of nothing
   *  are different claims. */
  cells: (string | number | undefined)[];
  basis: 'census' | 'estimate' | 'reported' | 'derived';
  pick?: boolean;
}

export interface Survey {
  columns: string[];
  rows: SurveyRow[];
  /** Must reconcile to the rows, excluding anything with basis 'estimate'. */
  total: { label: string; value: string | number; reconciles?: true };
  provenance: string;
  asOf: string;
  /** What the survey cannot answer. One line per gap. */
  cannotTellYou?: string[];
}

export interface Position {
  /** The call itself, in 90 characters or fewer. */
  statement: Dual;
  elaboration?: Dual;
  confidence?: Confidence;
  /** Exactly three. */
  because: { headline: string; detail: string }[];
  /** Named, and stated fairly. Never a strawman. */
  rejected: { name: string; why: string }[];
  conditions?: string[];
  /** One paragraph. What would end this recommendation, stated plainly. */
  sinkers: Dual;
  /** What to build first. Five at most. */
  phases?: { label: string; name: string; detail: string }[];
}

export interface Ledger {
  lenses: string[];
  activeLens?: string;
  benefits: Claim[];
  /** At least as long as benefits — if it is not, the study has not looked hard enough. */
  risks: Claim[];
  balance: Dual;
  byActor?: {
    actor: string;
    gains: number;
    loses: number;
    net: 'positive' | 'negative' | 'even';
    quote?: string;
  }[];
}

export interface AnatomyLayer {
  no: string;
  name: string;
  question: string;
  today: string;
  withIt: string;
  /** Every layer names its fight. A layer with no fight is a layer nobody argued about. */
  theFight: string;
  tag?: CategoryTag;
}

export interface ChronicleEntry {
  date: string;
  title: string;
  detail: string;
  tag: CategoryTag;
  /** The "you are here" entry. At most one, and it takes the accent. */
  present?: boolean;
  cites?: SourceRef[];
}

export interface PrecedentCase {
  place: string;
  year: string;
  name: string;
  what: string;
  archetype: string;
  /** Never a case with no fate. */
  fate: string;
  /** What KIND of fate, so the cases can be read as a pattern rather than as
   *  eight anecdotes. */
  fateKind?: 'live' | 'cancelled' | 'degraded';
  /** One sentence, and transferable — otherwise it is trivia. */
  lesson: string;
  cites?: SourceRef[];
}

/** T6, T7 and T8 are section-scale: they sit inside a T1 or T2 beat. */
export interface Section {
  template: 'T6' | 'T7' | 'T8';
  title?: string;
  claim?: Claim;
  layers?: AnatomyLayer[];
  leastDesigned?: string;
  /** Exactly two, named. One undifferentiated thread is a Wikipedia table. */
  threads?: { name: string; detail: string; tag?: CategoryTag }[];
  entries?: ChronicleEntry[];

  archetypes?: { id: string; label: string }[];
  cases?: PrecedentCase[];
  /** T7's closing line: why the two threads do not net off. */
  balance?: string;
  /** Two or three columns — what holds across the cases. */
  pattern?: string[];
}

export interface Beat {
  /** Zero-padded: '00' is the front matter, '01'–'07' the arc. */
  no: string;
  /** Route segment under the study. Absent on the front matter and beat 01. */
  slug?: string;
  name: string;
  template: TemplateId;
  minutes?: number;
  /** Exactly one. If two are needed, this is two beats. */
  question?: string;
  claim?: Claim;
  standfirst?: Dual;
  marginNotes?: MarginNote[];
  prose?: Prose[];
  figures?: Figure[];
  pullQuote?: string;
  sections?: Section[];
  survey?: Survey;
  position?: Position;
  ledger?: Ledger;
  /** In the author's voice. Never end on a chart. */
  soWhat?: Dual;
  openQuestion?: OpenQuestion;
}

/** The four lever archetypes an instrument may offer. Five levers maximum. */
export type LeverKind = 'B1' | 'B2' | 'B3' | 'B4';

export interface Lever {
  id: string;
  label: string;
  kind: LeverKind;
  /** Every lever shows where it started. A lever with no baseline cannot be
   *  read as a change, only as a position. */
  baseline?: string | number | boolean;
  min?: number;
  max?: number;
  unit?: string;
}

export interface Instrument {
  id: string;
  name: string;
  href: string;
  kind: '2d-staged' | '3d-network' | 'matrix' | 'model';
  reachedFrom?: string[];
  scenarios?: { id: string; label: string; difficulty?: string }[];
  levers?: Lever[];
  /** Mandatory. An instrument that cannot state its own limits does not ship. */
  limits: string;
}

export interface Study {
  slug: string;
  number: number;
  title: string;
  subject?: string;
  statusStamp?: string;
  thesis: string;
  private?: boolean;
  updated?: string;
  status: { headline: string; detail: string; confidence: Confidence };
  /** Three or four, stated in the front matter BEFORE beat 01. */
  findings: Claim[];
  asks: string[];
  /** `plain`, not `definition`: the glossary exists to say the thing without
   *  the jargon, which is a different job from defining the jargon. */
  glossary?: { term: string; plain: string }[];
  sources: Source[];
  instruments?: Instrument[];
  beats: Beat[];
}

/** The beat a route segment belongs to, or undefined. */
export function beatBySlug(study: Study, slug: string): Beat | undefined {
  return study.beats.find((b) => b.slug === slug);
}

/** The arc, front matter excluded — what the contents list and progress count. */
export function arcBeats(study: Study): Beat[] {
  return study.beats.filter((b) => b.no !== '00');
}

/** Previous / next in the arc, for the beat close's pagination. */
export function neighbours(study: Study, no: string): { prev?: Beat; next?: Beat } {
  const arc = arcBeats(study);
  const i = arc.findIndex((b) => b.no === no);
  if (i === -1) return {};
  return { prev: arc[i - 1], next: arc[i + 1] };
}

/** Where a beat lives. Beat 01 is the study's own index page. */
export function beatHref(study: Study, beat: Beat): string {
  const root = `/projects/${study.slug}`;
  return beat.slug ? `${root}/${beat.slug}` : root;
}
