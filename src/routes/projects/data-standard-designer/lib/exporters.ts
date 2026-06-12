// Exporters — turn the designed standard into publishable artifacts.
//
// Every function is pure (state in, string out) so the Publish page can render
// previews and offer downloads with no side effects. The set is deliberately
// broad: machine-readable schemas providers can validate against, catalogue
// metadata for discovery, a publication-grade human specification, and a
// rationale/interoperability pack that evidences the design choices.

import type {
  Brief,
  Field,
  FieldType,
  Recommendation,
  Score,
  CrosswalkEdge,
} from './types';
import { identifierById, standardById, METHODS } from './knowledge';
import { codelistById } from './codelists';

export interface ExportInput {
  brief: Brief;
  fields: Field[];
  rec: Recommendation;
  scores: { interop: Score; assurance: Score; adoption: Score };
  crosswalk: CrosswalkEdge[];
  version: string;
}

export interface ExportArtifact {
  id: string;
  label: string;
  filename: string;
  mime: string;
  description: string;
  content: string;
}

const slug = (s: string) =>
  (s || 'data-standard')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'data-standard';

const machineName = (f: Field) =>
  (f.name || f.title || 'field')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

// ---- type maps ----
function jsonSchemaType(t: FieldType): { type: string; format?: string } {
  switch (t) {
    case 'integer': return { type: 'integer' };
    case 'number':
    case 'currency': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'date': return { type: 'string', format: 'date' };
    case 'datetime': return { type: 'string', format: 'date-time' };
    case 'object': return { type: 'object' };
    case 'array': return { type: 'array' };
    default: return { type: 'string' };
  }
}
function tableSchemaType(t: FieldType): string {
  switch (t) {
    case 'integer': return 'integer';
    case 'number':
    case 'currency': return 'number';
    case 'boolean': return 'boolean';
    case 'date': return 'date';
    case 'datetime': return 'datetime';
    case 'object': return 'object';
    case 'array': return 'array';
    case 'geo': return 'geopoint';
    default: return 'string';
  }
}
function csvwType(t: FieldType): string {
  switch (t) {
    case 'integer': return 'integer';
    case 'number':
    case 'currency': return 'decimal';
    case 'boolean': return 'boolean';
    case 'date': return 'date';
    case 'datetime': return 'dateTime';
    default: return 'string';
  }
}
const EU_FREQ: Record<string, string> = {
  'real-time': 'CONT', daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY',
  termly: 'ANNUAL_3', quarterly: 'QUARTERLY', annual: 'ANNUAL', biannual: 'ANNUAL_2',
  'ad-hoc': 'IRREG', 'one-off': 'NEVER',
};

// ---------------------------------------------------------------------------
// 1. JSON Schema (2020-12)
// ---------------------------------------------------------------------------
export function toJsonSchema(i: ExportInput): string {
  const { brief, fields, version } = i;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    const name = machineName(f);
    const base = jsonSchemaType(f.type);
    const prop: Record<string, unknown> = {
      title: f.title,
      description: f.description || undefined,
      ...base,
    };
    const cl = codelistById(f.codelistId);
    if (cl && f.type !== 'array') {
      prop.enum = cl.values.map((v) => v.code);
      prop['x-codelist-values'] = cl.values;
    }
    if (f.type === 'array') {
      prop.items = cl ? { type: 'string', enum: cl.values.map((v) => v.code) } : { type: 'string' };
    }
    if (f.codelistId) prop['x-codelist'] = cl ? `${cl.name} (${cl.source})` : f.codelist;
    else if (f.codelist) prop['x-codelist'] = f.codelist;
    if (f.identifier) prop['x-identifier'] = f.identifier;
    if (f.sourceStandard) prop['x-source-standard'] = f.sourceStandard;
    if (f.pii) prop['x-personal-data'] = true;
    if (f.specialCategory) prop['x-special-category'] = true;
    if (f.example) prop.examples = [f.example];
    properties[name] = prop;
    if (f.required) required.push(name);
  }
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://standards.example.gov.uk/${slug(brief.name)}/v${version}/record.schema.json`,
    title: brief.name || 'Data Standard',
    description: brief.purpose,
    type: 'object',
    properties,
    required,
    additionalProperties: false,
    'x-standard': {
      version,
      domain: brief.domain,
      lawfulBasis: brief.legalBasis || null,
      containsPersonalData: brief.containsPersonalData,
      containsSpecialCategory: brief.containsSpecialCategory,
    },
  };
  return JSON.stringify(schema, null, 2);
}

// ---------------------------------------------------------------------------
// 2. Frictionless Data Package (datapackage.json with an embedded Table Schema)
// ---------------------------------------------------------------------------
export function toDataPackage(i: ExportInput): string {
  const { brief, fields, version, rec } = i;
  const tableFields = fields.map((f) => {
    const tf: Record<string, unknown> = {
      name: machineName(f),
      title: f.title,
      type: tableSchemaType(f.type),
      description: f.description || undefined,
    };
    const constraints: Record<string, unknown> = {};
    if (f.required) constraints.required = true;
    const cl = codelistById(f.codelistId);
    if (cl) constraints.enum = cl.values.map((v) => v.code);
    if (Object.keys(constraints).length) tf.constraints = constraints;
    if (f.format) tf.format = /iso|8601/i.test(f.format) ? 'default' : f.format;
    if (cl) tf['dsd:codelist'] = { name: cl.name, source: cl.source, values: cl.values };
    else if (f.codelist) tf['dsd:codelist'] = f.codelist;
    if (f.identifier) tf['dsd:identifier'] = f.identifier;
    return tf;
  });
  const primaryKey = fields.filter((f) => f.required && (f.type === 'identifier' || f.identifier)).map(machineName);
  const pkg = {
    name: slug(brief.name),
    title: brief.name || 'Data Standard',
    description: brief.purpose,
    version,
    profile: 'tabular-data-package',
    keywords: [brief.domain, ...brief.processingPurposes].filter(Boolean),
    licenses: [{ name: 'OGL-UK-3.0', title: 'Open Government Licence v3.0', path: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/' }],
    created: '',
    resources: [
      {
        name: `${slug(brief.name)}-records`,
        profile: 'tabular-data-resource',
        path: `${slug(brief.name)}.csv`,
        format: 'csv',
        mediatype: 'text/csv',
        schema: {
          fields: tableFields,
          ...(primaryKey.length ? { primaryKey: primaryKey.length === 1 ? primaryKey[0] : primaryKey } : {}),
          missingValues: [''],
        },
      },
    ],
    'dsd:collection': rec.collection.value,
    'dsd:frequency': rec.frequency.value,
  };
  return JSON.stringify(pkg, null, 2);
}

// ---------------------------------------------------------------------------
// 3. CSVW metadata (CSV on the Web)
// ---------------------------------------------------------------------------
export function toCsvw(i: ExportInput): string {
  const { brief, fields, version } = i;
  const columns = fields.map((f) => {
    const col: Record<string, unknown> = {
      name: machineName(f),
      titles: f.title,
      datatype: csvwType(f.type),
      required: !!f.required,
      'dc:description': f.description || undefined,
    };
    if (f.type === 'date') col.datatype = { base: 'date', format: 'yyyy-MM-dd' };
    return col;
  });
  const meta = {
    '@context': 'http://www.w3.org/ns/csvw',
    'url': `${slug(brief.name)}.csv`,
    'dc:title': brief.name || 'Data Standard',
    'dc:description': brief.purpose,
    'schema:version': version,
    tableSchema: {
      columns,
      primaryKey: fields.filter((f) => f.required && (f.type === 'identifier' || f.identifier)).map(machineName),
    },
  };
  return JSON.stringify(meta, null, 2);
}

// ---------------------------------------------------------------------------
// 4. DCAT-AP catalogue record (JSON-LD)
// ---------------------------------------------------------------------------
export function toDcat(i: ExportInput): string {
  const { brief, version, rec } = i;
  const publisher = brief.providers[0]?.label || 'Publishing organisation';
  const doc = {
    '@context': {
      dcat: 'http://www.w3.org/ns/dcat#',
      dct: 'http://purl.org/dc/terms/',
      foaf: 'http://xmlns.com/foaf/0.1/',
    },
    '@type': 'dcat:Dataset',
    'dct:title': brief.name || 'Data Standard',
    'dct:description': brief.purpose,
    'dct:identifier': slug(brief.name),
    'dcat:version': version,
    'dct:publisher': { '@type': 'foaf:Agent', 'foaf:name': publisher },
    'dcat:keyword': [brief.domain, ...brief.processingPurposes].filter(Boolean),
    'dct:accrualPeriodicity': `http://publications.europa.eu/resource/authority/frequency/${EU_FREQ[rec.frequency.value] || 'IRREG'}`,
    'dct:accessRights': brief.containsPersonalData ? 'NON_PUBLIC' : 'PUBLIC',
    'dcat:distribution': [
      {
        '@type': 'dcat:Distribution',
        'dct:title': `${brief.name} — ${rec.format.value.toUpperCase()} distribution`,
        'dcat:mediaType': mediaTypeFor(rec.format.value),
      },
    ],
    'dct:conformsTo': rec.standards.slice(0, 6).map((s) => ({ '@type': 'dct:Standard', 'dct:title': s.name, 'foaf:page': (s.urls || [])[0] })),
  };
  return JSON.stringify(doc, null, 2);
}
function mediaTypeFor(f: string): string {
  return { csv: 'text/csv', json: 'application/json', xml: 'application/xml', fhir: 'application/fhir+json', rdf: 'application/rdf+xml', parquet: 'application/vnd.apache.parquet', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[f] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// 5. Data dictionary CSV
// ---------------------------------------------------------------------------
export function toDataDictionaryCsv(i: ExportInput): string {
  const head = ['field_name', 'title', 'type', 'required', 'personal_data', 'special_category', 'identifier', 'codelist', 'format', 'source_standard', 'description'];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = i.fields.map((f) =>
    [machineName(f), f.title, f.type, f.required, f.pii, f.specialCategory, f.identifier || '', f.codelist || '', f.format || '', f.sourceStandard || '', f.description || ''].map(esc).join(','),
  );
  return [head.join(','), ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// 6. Publication-grade Markdown specification
// ---------------------------------------------------------------------------
export function toMarkdownSpec(i: ExportInput): string {
  const { brief, fields, rec, version } = i;
  const L: string[] = [];
  L.push(`# ${brief.name || 'Data Standard'}`);
  L.push('');
  L.push(`**Version:** ${version}  ·  **Status:** Draft  ·  **Domain:** ${brief.domain}`);
  L.push('');
  L.push('## 1. Purpose');
  L.push(brief.purpose || '_Not yet stated._');
  if (brief.processingPurposes.length) {
    L.push('');
    L.push('**This data will be processed for:**');
    for (const p of brief.processingPurposes) L.push(`- ${p}`);
  }
  L.push('');
  L.push('## 2. Scope and stakeholders');
  L.push(`- **Geographic coverage:** ${brief.geographicCoverage || 'not stated'}`);
  L.push('');
  L.push('**Information providers (upstream):**');
  if (brief.providers.length) for (const p of brief.providers) {
    L.push(`- **${p.label}** — ${p.sector}, ${p.ownership} sector. ${p.existingStandards.length ? `Already holds this in: ${p.existingStandards.map((s) => standardById(s)?.name || s).join(', ')}.` : 'No existing standard recorded.'} ${p.systemsHeld ? `Systems: ${p.systemsHeld}.` : ''}`);
  } else L.push('- _None captured._');
  L.push('');
  L.push('**Information consumers (downstream):**');
  if (brief.consumers.length) for (const c of brief.consumers) L.push(`- **${c.label}** — ${c.use || 'use not stated'}.`);
  else L.push('- _None captured._');
  L.push('');
  L.push('## 3. Legal and ethical basis');
  L.push(`- **Contains personal data:** ${brief.containsPersonalData ? 'Yes' : 'No'}`);
  L.push(`- **Contains special-category data:** ${brief.containsSpecialCategory ? 'Yes' : 'No'}`);
  L.push(`- **About children:** ${brief.aboutChildren ? 'Yes' : 'No'}`);
  L.push(`- **Lawful basis:** ${brief.legalBasis || '_to be confirmed_'}`);
  if (brief.containsSpecialCategory || brief.aboutChildren) L.push('- A Data Protection Impact Assessment (DPIA) is required before collection.');
  L.push('');
  L.push('## 4. Recommended identifiers');
  if (rec.identifiers.length) for (const id of rec.identifiers) {
    L.push(`- **${id.name}** — ${id.scope}. Format: ${id.format}. ${id.caveat ? `_Caveat: ${id.caveat}_` : ''}`);
  } else L.push('- _None._');
  L.push('');
  L.push('## 5. Data dictionary');
  L.push('');
  L.push('| Field | Title | Type | Required | Personal | Codelist / format | Source standard |');
  L.push('|---|---|---|---|---|---|---|');
  for (const f of fields) {
    L.push(`| \`${machineName(f)}\` | ${f.title} | ${f.type} | ${f.required ? '✓' : ''} | ${f.pii ? (f.specialCategory ? 'special' : 'yes') : ''} | ${f.codelist || f.format || ''} | ${f.sourceStandard ? standardById(f.sourceStandard)?.name || f.sourceStandard : ''} |`);
  }
  L.push('');
  L.push('### Field definitions');
  for (const f of fields) {
    L.push('');
    L.push(`#### \`${machineName(f)}\` — ${f.title}`);
    L.push(f.description || '_No definition yet._');
    if (f.constraints) L.push(`- Constraints: ${f.constraints}`);
    if (f.example) L.push(`- Example: \`${f.example}\``);
    const cl = codelistById(f.codelistId);
    if (cl) {
      L.push(`- Permissible values (${cl.name}${cl.partial ? ', subset' : ''} — ${cl.source}):`);
      for (const v of cl.values) L.push(`  - \`${v.code}\` — ${v.label}`);
    }
  }
  L.push('');
  L.push('## 6. Format, collection and frequency');
  L.push(`- **Serialisation:** ${rec.format.value.toUpperCase()} — ${rec.format.rationale}`);
  L.push(`- **Collection method:** ${rec.collection.value} — ${rec.collection.rationale}`);
  L.push(`- **Frequency:** ${rec.frequency.value} — ${rec.frequency.rationale}`);
  L.push(`- **Metadata standard:** ${rec.metadataStandard}`);
  L.push('');
  L.push('## 7. Conformance');
  L.push('- A submission conforms to this standard if every mandatory field is present and every field validates against the published JSON Schema / Table Schema.');
  L.push('- Validate before submission using the machine-readable schema shipped alongside this document.');
  L.push('');
  L.push('## 8. Versioning and governance');
  L.push(`- This is version **${version}**, managed under Semantic Versioning with a documented change log and deprecation window.`);
  L.push('- Name an owning body and a change/challenge process before adoption.');
  L.push('');
  L.push('---');
  L.push('_Generated by the Data Standard Designer — strangeramblings.com/projects/data-standard-designer_');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 7. Rationale & interoperability pack (the "why" + adoption case)
// ---------------------------------------------------------------------------
export function toRationalePack(i: ExportInput): string {
  const { brief, rec, scores, crosswalk: cw } = i;
  const L: string[] = [];
  L.push(`# ${brief.name || 'Data Standard'} — design rationale & interoperability pack`);
  L.push('');
  L.push('This pack evidences why the standard is shaped the way it is, how it connects to existing standards, and the case for adoption.');
  L.push('');
  L.push('## Assessment scores');
  const sline = (label: string, s: Score) => `- **${label}: ${s.value}/100 (${s.band})** — ${s.items.filter((it) => !it.met).slice(0, 2).map((it) => it.label.toLowerCase()).join('; ') || 'no major gaps'}`;
  L.push(sline('Interoperability', scores.interop));
  L.push(sline('Assurance', scores.assurance));
  L.push(sline('Adoption', scores.adoption));
  L.push('');
  L.push('## Why these choices');
  if (rec.rationaleLines.length) for (const r of rec.rationaleLines) L.push(`- ${r}`);
  else L.push('- _Complete the brief to generate rationale._');
  L.push('');
  L.push('## Interoperability crosswalk');
  if (cw.length) {
    L.push('| Your field | Connects to | Via | Relationship |');
    L.push('|---|---|---|---|');
    for (const e of cw) L.push(`| ${e.fieldName} | ${e.standardName} | ${e.via} | ${e.nature} |`);
  } else L.push('_No crosswalk yet — reuse identifiers and existing data items to create one._');
  L.push('');
  L.push('## Recommended standards to align with');
  for (const s of rec.standards) L.push(`- **${s.name}** (${s.owner}) — ${s.description}${(s.urls || [])[0] ? ` [${(s.urls || [])[0]}]` : ''}`);
  L.push('');
  L.push('## Frequency and sympathetic datasets');
  L.push(rec.frequency.rationale);
  if (rec.frequency.sympathetic.length) { L.push(''); for (const s of rec.frequency.sympathetic) L.push(`- ${s}`); }
  L.push('');
  L.push('## Methods applied');
  for (const m of METHODS.slice(0, 8)) L.push(`- **${m.title}** — ${m.summary}`);
  L.push('');
  L.push('---');
  L.push('_Generated by the Data Standard Designer._');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 8. Round-trippable design file
// ---------------------------------------------------------------------------
export function toDesignJson(i: ExportInput): string {
  return JSON.stringify({ kind: 'data-standard-design', version: i.version, brief: i.brief, fields: i.fields }, null, 2);
}

// ---------------------------------------------------------------------------
// Assemble the full export set
// ---------------------------------------------------------------------------
export function buildExports(i: ExportInput): ExportArtifact[] {
  const base = slug(i.brief.name);
  return [
    { id: 'spec', label: 'Specification (Markdown)', filename: `${base}-standard-v${i.version}.md`, mime: 'text/markdown', description: 'The full, publication-grade human specification: purpose, scope, legal basis, data dictionary, conformance and governance.', content: toMarkdownSpec(i) },
    { id: 'rationale', label: 'Rationale & interoperability pack', filename: `${base}-rationale-v${i.version}.md`, mime: 'text/markdown', description: 'The evidence pack: scores, why each choice was made, the crosswalk to other standards, and the adoption case.', content: toRationalePack(i) },
    { id: 'jsonschema', label: 'JSON Schema (2020-12)', filename: `${base}.schema.json`, mime: 'application/json', description: 'Machine-readable validation contract for JSON / API delivery.', content: toJsonSchema(i) },
    { id: 'datapackage', label: 'Frictionless Data Package', filename: `datapackage.json`, mime: 'application/json', description: 'datapackage.json with an embedded Table Schema — the publishing-grade tabular standard, widely tooled and validatable.', content: toDataPackage(i) },
    { id: 'csvw', label: 'CSV on the Web (CSVW)', filename: `${base}-metadata.json`, mime: 'application/json', description: 'W3C CSVW metadata so a plain CSV return becomes typed, validatable and self-describing.', content: toCsvw(i) },
    { id: 'dcat', label: 'DCAT-AP catalogue record', filename: `${base}-dcat.jsonld`, mime: 'application/ld+json', description: 'Catalogue metadata (JSON-LD) so the dataset is discoverable across government catalogues.', content: toDcat(i) },
    { id: 'dictionary', label: 'Data dictionary (CSV)', filename: `${base}-data-dictionary.csv`, mime: 'text/csv', description: 'The field list as a spreadsheet for business analysts and review.', content: toDataDictionaryCsv(i) },
    { id: 'design', label: 'Design file (re-importable JSON)', filename: `${base}-design.json`, mime: 'application/json', description: 'The complete brief + schema, so the design can be reloaded and iterated later.', content: toDesignJson(i) },
  ];
}
