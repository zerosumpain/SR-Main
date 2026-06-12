// The recommendation + scoring engine.
//
// Pure functions over a Brief and the working Field[]. Everything here is
// deterministic so it can run live in a $derived and re-score on every edit —
// which is what lets a designer "play with the schema and see the impact".

import type {
  Brief,
  Field,
  EngineHeuristic,
  Recommendation,
  Score,
  ScoreBreakdownItem,
  CrosswalkEdge,
  StakeholderRow,
  AvailabilityRow,
  SerializationFormat,
  CollectionMethod,
  Cadence,
  StandardEntry,
  IdentifierEntry,
} from './types';
import { CATALOG, IDENTIFIERS, RELATIONSHIPS, standardById, identifierById } from './knowledge';
import { legalCompleteness } from './legalBasis';

// ---------------------------------------------------------------------------
// Heuristics — map a brief to recommendations
// ---------------------------------------------------------------------------

const isChildContext = (b: Brief) =>
  b.aboutChildren ||
  b.domain === 'childrens-social-care' ||
  b.domain === 'child-protection' ||
  b.domain === 'education';

const hasPrivateProvider = (b: Brief) => b.providers.some((p) => p.ownership === 'private' || p.ownership === 'mixed');
const purposeIncludes = (b: Brief, kw: string) =>
  b.processingPurposes.some((p) => p.toLowerCase().includes(kw)) || b.purpose.toLowerCase().includes(kw);

export const HEURISTICS: EngineHeuristic[] = [
  {
    id: 'h-children-cross-domain',
    when: 'The dataset is about children across services',
    match: (b) => b.domain === 'childrens-social-care' || b.domain === 'child-protection',
    recommendStandards: ['ssda903', 'cin-census', 'cp-is', 'digital-child-health-fhir'],
    recommendIdentifiers: ['consistent-child-identifier', 'nhs-number'],
    metadata: 'DCAT-AP for cataloguing; ISO/IEC 11179 for the data dictionary',
    format: 'json',
    collection: 'statutory-return',
    frequency: 'annual',
    rationale:
      'Children\'s data is fragmented because no identifier spans services. Anchor on NHS Number (near-universal for children) and align to SSDA903/CIN so it integrates with what LAs already return. Borrow the CP-IS event pattern for anything operational.',
    weight: 1.4,
  },
  {
    id: 'h-education-pupil',
    when: 'Pupil-level education data',
    match: (b) => b.domain === 'education' && b.containsPersonalData,
    recommendStandards: ['cbds', 'school-census', 'gias', 'npd'],
    recommendIdentifiers: ['upn', 'urn'],
    metadata: 'CSV on the Web (CSVW) + CBDS data items',
    format: 'csv',
    collection: 'mis-extract',
    frequency: 'termly',
    rationale:
      'Reuse the Common Basic Data Set items and the UPN so the data lines up with the school census and the NPD. Prefer an automated MIS extract over a new manual return. Remember UPN is education-purpose-limited.',
    weight: 1.3,
  },
  {
    id: 'h-education-establishment',
    when: 'Education data about establishments, not individuals',
    match: (b) => b.domain === 'education' && !b.containsPersonalData,
    recommendStandards: ['gias', 'ees'],
    recommendIdentifiers: ['urn', 'ukprn'],
    metadata: 'DCAT-AP; publish via an EES-style API',
    format: 'csv',
    collection: 'register-sync',
    frequency: 'annual',
    rationale:
      'Join to GIAS by URN/UKPRN rather than carrying school names. Publishing through an EES-style open API maximises reuse with no personal-data risk.',
    weight: 1.1,
  },
  {
    id: 'h-health',
    when: 'Health or care data',
    match: (b) => b.domain === 'health',
    recommendStandards: ['fhir-uk-core', 'snomed-ct', 'nhs-data-dictionary'],
    recommendIdentifiers: ['nhs-number', 'ods-code'],
    metadata: 'FHIR UK Core profiles + the NHS Data Model and Dictionary',
    format: 'fhir',
    collection: 'rest-api',
    frequency: 'real-time',
    rationale:
      'Health interoperability is a solved-shape problem: profile FHIR UK Core, code clinical content in SNOMED CT, key on NHS Number and ODS. Do not invent a parallel model.',
    weight: 1.4,
  },
  {
    id: 'h-local-property',
    when: 'Local-government or property / place data',
    match: (b) => b.domain === 'local-gov' || b.domain === 'housing',
    recommendStandards: ['uprn-usrn-llpg', 'esd-lgsl', 'open-referral-uk', 'gss-geography'],
    recommendIdentifiers: ['uprn', 'usrn', 'gss-code'],
    metadata: 'DCAT-AP; ESD controlled vocabularies for services',
    format: 'json',
    collection: 'rest-api',
    frequency: 'monthly',
    rationale:
      'Anchor on UPRN/USRN and GSS codes so place data joins cleanly, and reuse the LGSL / Open Referral vocabularies instead of bespoke service lists.',
    weight: 1.2,
  },
  {
    id: 'h-cross-gov',
    when: 'Cross-government / statistical data',
    match: (b) => b.domain === 'cross-gov',
    recommendStandards: ['dsa-catalogue', 'govuk-registers', 'gss-geography', 'dcat-ap'],
    recommendIdentifiers: ['gss-code', 'companies-house-number'],
    metadata: 'DCAT-AP catalogue metadata; reuse GOV.UK Registers for reference data',
    format: 'csv',
    collection: 'statutory-return',
    frequency: 'quarterly',
    rationale:
      'Start from the Data Standards Authority catalogue, reuse GOV.UK Registers for reference data, and describe the dataset with DCAT-AP so it is discoverable across government.',
    weight: 1.1,
  },
  {
    id: 'h-employment',
    when: 'Employment / skills data',
    match: (b) => b.domain === 'employment',
    recommendStandards: ['ilr', 'gias'],
    recommendIdentifiers: ['uln', 'ukprn'],
    metadata: 'ILR specification; DCAT-AP for publication',
    format: 'xml',
    collection: 'statutory-return',
    frequency: 'monthly',
    rationale: 'Reuse the ULN and the ILR shape so skills data is continuous and fundable.',
    weight: 1.1,
  },
  {
    id: 'h-private-providers',
    when: 'Some providers are private or mixed-sector',
    match: hasPrivateProvider,
    metadata: 'Publish a JSON Schema + an OpenAPI contract so vendors can integrate',
    format: 'json',
    collection: 'rest-api',
    rationale:
      'Private providers adopt fastest when you meet them at an API with a clear JSON Schema, and design the standard as a mapping/profile of what their systems already export rather than a new manual return.',
    weight: 1.0,
  },
  {
    id: 'h-operational-realtime',
    when: 'Used operationally or for safeguarding',
    match: (b) => purposeIncludes(b, 'operational') || purposeIncludes(b, 'safeguard') || purposeIncludes(b, 'real'),
    format: 'json',
    collection: 'event-stream',
    frequency: 'real-time',
    rationale:
      'Operational and safeguarding uses need event-based, near-real-time exchange (the CP-IS / Digital Child Health pattern), not an annual return.',
    weight: 1.0,
  },
  {
    id: 'h-open-publishing',
    when: 'Consumers include the public or researchers',
    match: (b) => b.consumers.some((c) => /public|research|citizen|press|analy/i.test(`${c.label} ${c.use} ${c.sector}`)),
    recommendStandards: ['dcat-ap', 'schema-org-dataset', 'csvw'],
    metadata: 'DCAT-AP + schema.org Dataset for discoverability',
    rationale:
      'For open/research consumers, wrap the dataset in DCAT-AP and schema.org Dataset metadata and publish open, validated CSV (CSVW) so it is findable and reusable (FAIR).',
    weight: 0.9,
  },
  {
    id: 'h-high-interop',
    when: 'Interoperability is a stated priority',
    match: (b) => b.interopGoal === 'high',
    recommendStandards: ['dcat-ap', 'iso-11179'],
    metadata: 'ISO/IEC 11179 data-element definitions + DCAT-AP',
    rationale:
      'With interoperability as a priority, be rigorous about data-element definitions (ISO 11179), reuse identifiers and codelists everywhere, and publish a crosswalk to adjacent standards.',
    weight: 0.9,
  },
];

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

function matched(b: Brief): EngineHeuristic[] {
  return HEURISTICS.filter((h) => {
    try {
      return h.match(b);
    } catch {
      return false;
    }
  });
}

function defaultIdentifiersFor(b: Brief): string[] {
  return IDENTIFIERS.filter((i) => i.sectors.includes(b.domain)).map((i) => i.id);
}

export function recommend(b: Brief): Recommendation {
  const hs = matched(b);

  // Identifiers — heuristic picks first, then domain defaults, deduped.
  const idIds = uniq([...hs.flatMap((h) => h.recommendIdentifiers || []), ...defaultIdentifiersFor(b)]);
  const identifiers = idIds.map((id) => identifierById(id)).filter(Boolean) as IdentifierEntry[];

  // Standards — heuristic picks, then catalog entries in the same sector.
  const stdIds = uniq([
    ...hs.flatMap((h) => h.recommendStandards || []),
    ...CATALOG.filter((s) => s.sector === b.domain).map((s) => s.id),
  ]);
  const standards = stdIds.map((id) => standardById(id)).filter(Boolean).slice(0, 10) as StandardEntry[];

  // Format / collection / frequency — highest-weight matching heuristic wins.
  const byWeight = [...hs].sort((a, b2) => (b2.weight || 1) - (a.weight || 1));
  const format = (byWeight.find((h) => h.format)?.format || 'csv') as SerializationFormat;
  const collection = (byWeight.find((h) => h.collection)?.collection || 'bulk-upload') as CollectionMethod;
  const frequency = (byWeight.find((h) => h.frequency)?.frequency || 'annual') as Cadence;
  const metadataStandard = byWeight.find((h) => h.metadata)?.metadata || 'DCAT-AP catalogue metadata';

  // Sympathetic datasets — catalog entries in the same sector that carry a
  // cadence; aligning to their rhythm is what makes joins line up.
  const sympathetic = CATALOG.filter((s) => s.sector === b.domain && s.cadence).map(
    (s) => `${s.name} (${s.cadence})`,
  );

  const formatRationale = formatReason(format, b);
  const collectionRationale = collectionReason(collection, b);
  const frequencyRationale = frequencyReason(frequency, b, sympathetic);

  const rationaleLines = uniq(hs.map((h) => h.rationale));

  return {
    standards,
    identifiers,
    metadataStandard,
    format: { value: format, rationale: formatRationale },
    collection: { value: collection, rationale: collectionRationale },
    frequency: { value: frequency, rationale: frequencyRationale, sympathetic },
    rationaleLines,
  };
}

function formatReason(f: SerializationFormat, b: Brief): string {
  const map: Record<SerializationFormat, string> = {
    fhir: 'Clinical/care data exchanges on FHIR UK Core — the NHS interoperability standard.',
    csv: 'Tabular returns are best as CSV described with a Table Schema / CSVW so they are typed and validatable.',
    json: 'JSON with a published JSON Schema suits API delivery and mixed-sector providers integrating programmatically.',
    xml: 'XML matches the existing DfE collection toolchain (COLLECT) where providers already produce it.',
    rdf: 'RDF / linked data suits reference registers that other datasets will link to.',
    parquet: 'Parquet suits large analytical extracts consumed by data platforms.',
    xlsx: 'Spreadsheet delivery only where recipients cannot consume anything richer — pair with a machine-readable copy.',
  };
  return map[f];
}
function collectionReason(c: CollectionMethod, b: Brief): string {
  const map: Record<CollectionMethod, string> = {
    'mis-extract': 'Pull from the systems providers already keep the data in (an automated MIS extract) — lowest burden, highest quality.',
    'statutory-return': 'A statutory return gives completeness, but design it from an existing extract so it is not re-keyed.',
    'rest-api': 'A REST API with a published schema lets providers (including private vendors) integrate once and stay current.',
    'event-stream': 'Event/message exchange suits operational and safeguarding use where timeliness matters.',
    'bulk-upload': 'A validated bulk upload is the pragmatic default where no automated feed exists yet.',
    'manual-form': 'Manual entry only for low-volume data with no system of record — it carries the highest burden and error rate.',
    'register-sync': 'Sync against the authoritative register rather than collecting the data again.',
  };
  return map[c];
}
function frequencyReason(c: Cadence, b: Brief, sympathetic: string[]): string {
  const base = `A ${c} cadence is proposed`;
  if (sympathetic.length) {
    return `${base} to harmonise with sympathetic datasets in this domain — ${sympathetic
      .slice(0, 3)
      .join(', ')} — so records line up in time and can be joined without interpolation.`;
  }
  return `${base}; align it with the cadence of the datasets you will join to, so periods match.`;
}

// ---------------------------------------------------------------------------
// Crosswalk — which existing standards this schema connects to, and how
// ---------------------------------------------------------------------------

export function crosswalk(fields: Field[]): CrosswalkEdge[] {
  const edges: CrosswalkEdge[] = [];
  const seen = new Set<string>();
  const push = (e: CrosswalkEdge) => {
    const k = `${e.standardId}|${e.fieldName}|${e.nature}`;
    if (!seen.has(k)) {
      seen.add(k);
      edges.push(e);
    }
  };

  for (const f of fields) {
    if (f.identifier) {
      const idef = identifierById(f.identifier);
      const via = idef?.name || f.identifier;
      for (const s of CATALOG) {
        if (s.identifiers?.includes(f.identifier)) {
          push({ standardId: s.id, standardName: s.name, via, fieldName: f.title || f.name, nature: 'shares-identifier' });
        }
      }
    }
    if (f.sourceStandard) {
      const s = standardById(f.sourceStandard);
      if (s) {
        push({ standardId: s.id, standardName: s.name, via: 'data item', fieldName: f.title || f.name, nature: 'reuses-field-from' });
        for (const cid of s.connectsTo || []) {
          const cs = standardById(cid);
          if (cs) push({ standardId: cs.id, standardName: cs.name, via: s.name, fieldName: f.title || f.name, nature: 'aligns-with' });
        }
      }
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Crosswalk graph — the relationship map: your standard at the centre, the
// standards your fields join (inner ring), the relationships between those
// (cross-links), and the standards one hop further out (2nd-order neighbours).
// ---------------------------------------------------------------------------

export interface CrosswalkGraph {
  inner: { id: string; name: string; linkCount: number; vias: string[]; colorKey: string }[];
  crossLinks: { a: string; b: string; nature: string; note?: string }[];
  secondOrder: { id: string; name: string; throughId: string; throughName: string }[];
}

/** Stable colour-bucket (0..N) for an identifier/via key, so a given shared
 *  identifier always paints the same spoke colour across renders. */
export function crosswalkColorKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 6;
}

export function crosswalkGraph(fields: Field[]): CrosswalkGraph {
  const edges = crosswalk(fields);

  // Inner ring: one node per standard your fields directly touch.
  const innerMap = new Map<string, { id: string; name: string; vias: Set<string> }>();
  for (const e of edges) {
    if (!innerMap.has(e.standardId)) innerMap.set(e.standardId, { id: e.standardId, name: e.standardName, vias: new Set() });
    innerMap.get(e.standardId)!.vias.add(e.via);
  }
  const inner = [...innerMap.values()]
    .map((v) => ({
      id: v.id,
      name: v.name,
      linkCount: edges.filter((e) => e.standardId === v.id).length,
      vias: [...v.vias],
      colorKey: [...v.vias][0] || v.id,
    }))
    .sort((a, b) => b.linkCount - a.linkCount)
    .slice(0, 8);
  const innerIds = new Set(inner.map((i) => i.id));

  // Helper: every relationship neighbour of a standard (both directions + connectsTo).
  const neighboursOf = (id: string): { to: string; nature: string; note?: string }[] => {
    const out: { to: string; nature: string; note?: string }[] = [];
    for (const cid of standardById(id)?.connectsTo || []) out.push({ to: cid, nature: 'connects-to' });
    for (const r of RELATIONSHIPS) {
      if (r.from === id) out.push({ to: r.to, nature: r.nature, note: r.note });
      else if (r.to === id) out.push({ to: r.from, nature: r.nature, note: r.note });
    }
    return out;
  };

  // Cross-links: relationships where BOTH endpoints are inner standards.
  const crossLinks: CrosswalkGraph['crossLinks'] = [];
  const seenCL = new Set<string>();
  for (const i of inner) {
    for (const n of neighboursOf(i.id)) {
      if (!innerIds.has(n.to) || n.to === i.id) continue;
      const k = [i.id, n.to].sort().join('|');
      if (seenCL.has(k)) continue;
      seenCL.add(k);
      crossLinks.push({ a: i.id, b: n.to, nature: n.nature, note: n.note });
    }
  }

  // 2nd-order: neighbours of inner standards that are not themselves inner.
  const secondOrder: CrosswalkGraph['secondOrder'] = [];
  const seenSO = new Set<string>();
  for (const i of inner) {
    for (const n of neighboursOf(i.id)) {
      if (innerIds.has(n.to) || n.to === i.id || seenSO.has(n.to)) continue;
      const s = standardById(n.to);
      if (!s) continue;
      seenSO.add(n.to);
      secondOrder.push({ id: n.to, name: s.name, throughId: i.id, throughName: i.name });
    }
  }

  return { inner, crossLinks, secondOrder: secondOrder.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Scores — interoperability, assurance, adoption (all 0..100, live)
// ---------------------------------------------------------------------------

function band(v: number): Score['band'] {
  if (v >= 80) return 'strong';
  if (v >= 60) return 'good';
  if (v >= 40) return 'developing';
  return 'low';
}

function compose(items: (ScoreBreakdownItem & { weight: number; raw: number })[]): Score {
  const totalW = items.reduce((a, i) => a + i.weight, 0) || 1;
  const value = Math.round(
    (items.reduce((a, i) => a + clamp01(0.5 + i.delta / 2) * i.weight, 0) / totalW) * 100,
  );
  return {
    value,
    band: band(value),
    items: items.map(({ weight, raw, ...rest }) => rest),
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ratio = (n: number, d: number) => (d <= 0 ? 0 : n / d);

export function interoperabilityScore(b: Brief, fields: Field[]): Score {
  const idFields = fields.filter((f) => f.type === 'identifier' || f.identifier);
  const knownIds = idFields.filter((f) => f.identifier && identifierById(f.identifier));
  const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
  const datesIso = dateFields.filter((f) => /iso|8601/i.test(f.format || ''));
  const enumFields = fields.filter((f) => f.type === 'enum' || f.type === 'array');
  const enumCoded = enumFields.filter((f) => f.codelist || f.codelistId);
  const provenanced = fields.filter((f) => f.sourceStandard);
  const edges = crosswalk(fields);

  const items: (ScoreBreakdownItem & { weight: number; raw: number })[] = [
    mk('Identifiers reused', 1.6, idFields.length ? ratio(knownIds.length, idFields.length) : (fields.length ? 0.2 : 0.5),
      knownIds.length
        ? `${knownIds.length} field(s) reuse a recognised identifier (e.g. ${knownIds.map((f) => identifierById(f.identifier!)?.name).filter(Boolean).slice(0,2).join(', ')}).`
        : 'No standard identifier reused — joins to other datasets will rely on fragile matching.'),
    mk('Dates in ISO 8601', 0.8, dateFields.length ? ratio(datesIso.length, dateFields.length) : 0.7,
      dateFields.length ? `${datesIso.length}/${dateFields.length} date fields specify ISO 8601.` : 'No date fields to format.'),
    mk('Controlled vocabularies', 1.1, enumFields.length ? ratio(enumCoded.length, enumFields.length) : 0.6,
      enumFields.length ? `${enumCoded.length}/${enumFields.length} enumerated fields point to a codelist.` : 'No enumerated fields requiring a codelist.'),
    mk('Built on existing standards', 1.3, ratio(provenanced.length, Math.max(1, fields.length)),
      `${provenanced.length}/${fields.length} fields are drawn from an existing standard.`),
    mk('Crosswalk to other standards', 1.2, clamp01(edges.length / 6),
      edges.length ? `Connects to ${uniq(edges.map((e) => e.standardName)).length} existing standard(s).` : 'No crosswalk yet — nothing to join against.'),
    mk('Interoperability ambition set', 0.5, b.interopGoal === 'high' ? 1 : b.interopGoal === 'medium' ? 0.6 : 0.3,
      `Stated goal: ${b.interopGoal}.`),
  ];
  return compose(items);
}

export function assuranceScore(b: Brief, fields: Field[]): Score {
  const personal = b.containsPersonalData;
  const sensitive = b.containsSpecialCategory || b.aboutChildren;
  const described = fields.filter((f) => (f.description || '').trim().length > 8);
  const validatable = fields.filter((f) => f.format || f.codelist || f.constraints || f.type !== 'string');
  const hasRequired = fields.some((f) => f.required);
  const scFields = fields.filter((f) => f.specialCategory);
  const ids = b.legalBasisIds || [];
  const check = legalCompleteness(ids, { personal, special: sensitive });
  const dpiaSelected = ids.includes('dpia');
  // free-text fallbacks so older briefs without structured picks aren't penalised
  const a9text = /art(icle)?\s*9|special|condition|substantial public interest|safeguard/i.test(`${b.legalBasis} ${b.notes}`);
  const dpiaText = /dpia|impact assessment/i.test(`${b.notes} ${b.legalBasis}`);
  const a6met = !personal || check.hasA || !!b.legalBasis.trim();
  const a9met = !sensitive || check.hasA9 || a9text;
  const dpiaMet = !sensitive || dpiaSelected || dpiaText;

  const items: (ScoreBreakdownItem & { weight: number; raw: number })[] = [
    mk('Data-protection lawful basis (Art 6)', 1.5, a6met ? 1 : 0,
      !personal ? 'No personal data — an Article 6 basis is not required.' : check.hasA ? 'An Article 6 lawful basis is selected.' : b.legalBasis.trim() ? `Recorded as free text: "${b.legalBasis.slice(0, 60)}".` : 'No Article 6 lawful basis selected for personal data — pick one on the Legal basis tab.'),
    mk('Legal power / gateway to share (vires)', 1.3, check.hasB ? 1 : personal ? (b.legalBasis.trim() ? 0.4 : 0) : 0.5,
      check.hasB ? 'A statutory gateway or legal power to share is selected.' : 'No legal power/gateway selected — for a public body a lawful basis ALONE does not authorise sharing. Choose the specific power on the Legal basis tab.'),
    mk('Special-category condition (Art 9)', 1.2, a9met ? 1 : 0.2,
      !sensitive ? 'No special-category or children\'s data flagged.' : check.hasA9 ? 'An Article 9 / Schedule 1 condition is selected.' : a9text ? 'A condition is referenced in notes.' : 'Special-category or children\'s data without an Article 9 condition — add one (e.g. Sch 1 para 18 safeguarding).'),
    mk('DPIA for sensitive data', 1.0, dpiaMet ? 1 : 0.3,
      !sensitive ? 'A DPIA is not mandatory here.' : dpiaSelected ? 'A DPIA is recorded as a governance instrument.' : dpiaText ? 'A DPIA is noted.' : 'Sensitive/children\'s data normally requires a DPIA — add it under governance on the Legal basis tab.'),
    mk('Field definitions complete', 1.1, ratio(described.length, Math.max(1, fields.length)),
      `${described.length}/${fields.length} fields have a usable definition.`),
    mk('Fields are validatable', 1.0, ratio(validatable.length, Math.max(1, fields.length)),
      `${validatable.length}/${fields.length} fields carry a type, format, codelist or constraint a validator can check.`),
    mk('Mandatory core defined', 0.7, hasRequired ? 1 : 0,
      hasRequired ? 'At least one mandatory field anchors the record.' : 'No required fields — the record has no guaranteed content.'),
    mk('Data minimisation', 0.8, fields.length ? clamp01(1 - ratio(scFields.length, fields.length) * 1.2) : 0.6,
      scFields.length ? `${scFields.length} special-category field(s) — keep these to the minimum the purpose needs.` : 'No special-category fields — minimisation is in good shape.'),
  ];
  return compose(items);
}

export function adoptionScore(b: Brief, fields: Field[]): Score {
  const avail = availability(b, fields);
  const alreadyHeld = avail.filter((a) => a.availability === 'already-held');
  const newCollection = avail.filter((a) => a.availability === 'new-collection');
  const providersMapped = b.providers.filter((p) => p.existingStandards.length > 0);
  const highBurden = b.providers.filter((p) => p.burdenSensitivity === 'high');
  const requiredCount = fields.filter((f) => f.required).length;
  const rec = recommend(b);
  const automated = ['mis-extract', 'event-stream', 'register-sync', 'rest-api'].includes(rec.collection.value);

  const items: (ScoreBreakdownItem & { weight: number; raw: number })[] = [
    mk('Reuses data providers already hold', 1.5, ratio(alreadyHeld.length, Math.max(1, avail.length)),
      `${alreadyHeld.length}/${avail.length} fields are already held by providers.`),
    mk('Meets existing provider standards', 1.2, b.providers.length ? ratio(providersMapped.length, b.providers.length) : 0.4,
      b.providers.length ? `${providersMapped.length}/${b.providers.length} providers have an existing standard to map from.` : 'No providers captured yet.'),
    mk('Low new-collection burden', 1.3, fields.length ? clamp01(1 - ratio(newCollection.length, avail.length)) : 0.5,
      `${newCollection.length} field(s) would be net-new collection.`),
    mk('Automated collection', 1.0, automated ? 1 : 0.4,
      `Proposed collection: ${rec.collection.value} — ${automated ? 'low-burden / automated.' : 'consider an automated feed instead.'}`),
    mk('Lean mandatory core', 0.9, clamp01(1 - Math.max(0, requiredCount - 6) / 10),
      `${requiredCount} mandatory field(s) — a lean core is easier to adopt.`),
    mk('Burden-sensitive providers considered', 0.7, b.providers.length ? clamp01(1 - ratio(highBurden.length, b.providers.length) * (newCollection.length ? 1 : 0.3)) : 0.6,
      highBurden.length ? `${highBurden.length} high-burden-sensitivity provider(s) — keep their ask minimal.` : 'No high-burden providers flagged.'),
  ];
  return compose(items);
}

function mk(label: string, weight: number, raw: number, detail: string): ScoreBreakdownItem & { weight: number; raw: number } {
  const r = clamp01(raw);
  return { label, weight, raw: r, delta: r * 2 - 1, detail, met: r >= 0.66 };
}

// ---------------------------------------------------------------------------
// Stakeholder impact & data availability
// ---------------------------------------------------------------------------

export function stakeholders(b: Brief, fields: Field[]): StakeholderRow[] {
  const rows: StakeholderRow[] = [];
  const newish = availability(b, fields).filter((a) => a.availability === 'new-collection').length;
  const piiCount = fields.filter((f) => f.pii).length;
  const scCount = fields.filter((f) => f.specialCategory).length;

  for (const p of b.providers) {
    const burden: StakeholderRow['burden'] = p.existingStandards.length && newish < 3 ? 'low' : newish > 6 ? 'high' : 'medium';
    rows.push({
      stakeholder: p.label || 'Provider',
      kind: 'provider',
      burden,
      value: 'medium',
      risk: p.ownership === 'private' ? 'medium' : 'low',
      note: p.existingStandards.length
        ? `Already holds data in ${p.existingStandards.length} known standard(s); map rather than re-collect.`
        : `No existing standard mapped — ${newish} field(s) may be new effort.`,
    });
  }
  for (const c of b.consumers) {
    rows.push({
      stakeholder: c.label || 'Consumer',
      kind: 'consumer',
      burden: 'low',
      value: 'high',
      risk: 'low',
      note: c.use ? `Gains: ${c.use}.` : 'Downstream user of the dataset.',
    });
  }
  if (b.containsPersonalData) {
    rows.push({
      stakeholder: b.aboutChildren ? 'Children / data subjects' : 'Data subjects',
      kind: 'data-subject',
      burden: 'low',
      value: 'medium',
      risk: scCount > 0 || b.aboutChildren ? 'high' : piiCount > 4 ? 'medium' : 'low',
      note: `${piiCount} personal and ${scCount} special-category field(s). ${b.aboutChildren ? 'Children\'s data — heightened duty of care.' : ''}`.trim(),
    });
    rows.push({
      stakeholder: 'Regulator (ICO)',
      kind: 'regulator',
      burden: 'low',
      value: 'medium',
      risk: scCount > 0 && !/art(icle)?\s*9|condition|safeguard/i.test(`${b.legalBasis} ${b.notes}`) ? 'high' : 'low',
      note: 'Expects a clear lawful basis, minimisation, and a DPIA for sensitive or children\'s data.',
    });
  }
  return rows;
}

export function availability(b: Brief, fields: Field[]): AvailabilityRow[] {
  const sector = providerSector(b);
  return fields.map((f) => {
    let avail: AvailabilityRow['availability'] = 'new-collection';
    let heldBy = 'To be collected';
    if (f.identifier) {
      const idef = identifierById(f.identifier);
      avail = 'already-held';
      heldBy = idef?.heldBy || 'Provider systems';
    } else if (f.sourceStandard) {
      const s = standardById(f.sourceStandard);
      // already held if a provider maps to that standard, else partial.
      const mappedByProvider = b.providers.some((p) => p.existingStandards.includes(f.sourceStandard!));
      avail = mappedByProvider ? 'already-held' : 'partially-held';
      heldBy = s ? `${s.owner} (${s.name})` : 'An existing standard';
    } else if (f.codelist || f.format) {
      avail = 'partially-held';
      heldBy = 'Likely derivable from provider systems';
    }
    return {
      fieldName: f.title || f.name,
      heldBy,
      availability: avail,
      sector,
      note:
        avail === 'already-held'
          ? 'Reused — no new collection burden.'
          : avail === 'partially-held'
            ? 'Probably derivable from systems providers already run.'
            : 'Net-new — justify against the purpose and the burden it creates.',
    };
  });
}

function providerSector(b: Brief): AvailabilityRow['sector'] {
  const owners = new Set(b.providers.map((p) => p.ownership));
  if (owners.size === 0) return 'mixed';
  if (owners.size === 1) {
    const only = [...owners][0];
    if (only === 'private') return 'private';
    if (only === 'public') return 'public';
  }
  return 'mixed';
}

// ---------------------------------------------------------------------------

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
