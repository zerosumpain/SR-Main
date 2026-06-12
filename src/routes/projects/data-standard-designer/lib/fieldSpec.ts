// Field-spec knowledge layer.
//
// Turns a Field into a concrete, teachable specification: the recommended
// format, an applyable regex pattern, an example value, and a plain-language
// validation rule. Grounded two ways — by the identifier the field reuses
// (canonical pattern from the catalog's IDENTIFIERS), or by the field's type
// (sensible defaults: ISO 8601 dates, etc.) with light name-based hints.
//
// Pure + deterministic so the schema inspector can show guidance live. The
// patterns mirror the formats recorded on IDENTIFIERS in knowledge.ts and the
// format-plausible shapes the synthetic-data generator (synth.ts) produces.

import type { Field, FieldType } from './types';
import { identifierById } from './knowledge';
import { codelistById } from './codelists';

export interface FieldSpec {
  /** Human-readable recommended format, e.g. "ISO 8601 (YYYY-MM-DD)". */
  recommendedFormat: string;
  /** An applyable regex (string form, no delimiters), or null when free-form. */
  pattern: string | null;
  /** A concrete, valid example value. */
  example: string;
  /** Plain-language validation rule. */
  rule: string;
  /** Permissible values, for codelist-backed fields. */
  permissible?: { code: string; label: string }[];
  /** Legal/practical caveat carried from the identifier, where relevant. */
  caveat?: string;
}

/** Canonical patterns per identifier id — keyed to IDENTIFIERS[].id in knowledge.ts. */
const IDENTIFIER_PATTERNS: Record<string, { pattern: string; example: string; rule: string }> = {
  'nhs-number': { pattern: '^\\d{3} ?\\d{3} ?\\d{4}$', example: '943 476 5919', rule: '10 digits with a Modulus-11 check digit, conventionally grouped 3-3-4.' },
  upn: { pattern: '^[A-Za-z]\\d{12}$', example: 'B838203001054', rule: '13 characters: a check letter followed by 12 digits. Education-purpose-limited.' },
  uln: { pattern: '^\\d{10}$', example: '1000000019', rule: '10-digit Unique Learner Number.' },
  urn: { pattern: '^\\d{6}$', example: '140235', rule: '6-digit DfE establishment URN.' },
  ukprn: { pattern: '^\\d{8}$', example: '10001234', rule: '8-digit UK Provider Reference Number.' },
  'la-estab': { pattern: '^\\d{3}/?\\d{4}$', example: '938/4001', rule: '3-digit LA code + 4-digit establishment code.' },
  trn: { pattern: '^\\d{7}$', example: '1234567', rule: '7-digit Teacher Reference Number.' },
  'ods-code': { pattern: '^[A-Z][A-Z0-9]{2,6}$', example: 'A81001', rule: 'Alphanumeric ODS code (organisation / GP practice).' },
  uprn: { pattern: '^\\d{1,12}$', example: '100023336956', rule: 'Numeric, up to 12 digits. Property-level; no spaces.' },
  usrn: { pattern: '^\\d{8}$', example: '20902956', rule: '8-digit Unique Street Reference Number.' },
  'gss-code': { pattern: '^[A-Z]\\d{8}$', example: 'E09000007', rule: '9-character ONS GSS geography code (one letter + 8 digits).' },
  'companies-house-number': { pattern: '^(\\d{8}|[A-Z]{2}\\d{6})$', example: '01234567', rule: '8 characters: 8 digits, or a 2-letter prefix + 6 digits.' },
  'ni-number': { pattern: '^[A-Z]{2}\\d{6}[A-D]$', example: 'QQ123456C', rule: '2 letters, 6 digits, 1 suffix letter (A–D).' },
};

const TYPE_DEFAULTS: Partial<Record<FieldType, Omit<FieldSpec, 'caveat' | 'permissible'>>> = {
  date: { recommendedFormat: 'ISO 8601 (YYYY-MM-DD)', pattern: '^\\d{4}-\\d{2}-\\d{2}$', example: '2018-09-01', rule: 'A calendar date; for a date of birth, not in the future.' },
  datetime: { recommendedFormat: 'ISO 8601 date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?(Z|[+-]\\d{2}:\\d{2})?$', example: '2024-09-01T09:30:00Z', rule: 'Timestamp with timezone (UTC "Z" or offset).' },
  integer: { recommendedFormat: 'Whole number', pattern: '^-?\\d+$', example: '42', rule: 'No decimal point.' },
  number: { recommendedFormat: 'Decimal number', pattern: null, example: '3.14', rule: 'Decimal allowed; state units separately.' },
  boolean: { recommendedFormat: 'Boolean (true / false)', pattern: '^(true|false)$', example: 'true', rule: 'Exactly true or false — avoid Y/N or 1/0.' },
  currency: { recommendedFormat: 'Decimal, 2 dp', pattern: '^-?\\d+\\.\\d{2}$', example: '1250.00', rule: 'Two decimal places; record the currency (e.g. GBP) once at dataset level.' },
  geo: { recommendedFormat: 'lat,lon (WGS84)', pattern: '^-?\\d{1,2}\\.\\d+,-?\\d{1,3}\\.\\d+$', example: '51.50735,-0.12776', rule: 'Decimal degrees, WGS84; latitude then longitude.' },
};

const NAME_HINTS: { test: RegExp; spec: Omit<FieldSpec, 'caveat' | 'permissible'> }[] = [
  { test: /post_?code/, spec: { recommendedFormat: 'UK postcode', pattern: '^[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}$', example: 'SW1A 1AA', rule: 'Uppercase; a single space before the 3-character inward code.' } },
  { test: /e_?mail/, spec: { recommendedFormat: 'Email address', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', example: 'name@example.gov.uk', rule: 'One address per value.' } },
  { test: /url|website|link/, spec: { recommendedFormat: 'URL', pattern: '^https?://\\S+$', example: 'https://www.gov.uk', rule: 'Absolute http(s) URL.' } },
  { test: /phone|mobile|telephone/, spec: { recommendedFormat: 'UK phone (E.164 preferred)', pattern: '^\\+?\\d[\\d ]{7,}$', example: '+44 20 7946 0958', rule: 'Prefer E.164 (+44…); store one number per value.' } },
];

/** Compute the recommended specification + guidance for a single field. */
export function specForField(field: Field): FieldSpec {
  // 1) A reused identifier has the most authoritative spec.
  if (field.identifier) {
    const idef = identifierById(field.identifier);
    const p = IDENTIFIER_PATTERNS[field.identifier];
    if (p) return { recommendedFormat: idef?.format || 'Recognised identifier', pattern: p.pattern, example: p.example, rule: p.rule, caveat: idef?.caveat };
    if (idef) return { recommendedFormat: idef.format, pattern: null, example: '', rule: `Reuses ${idef.name} — ${idef.scope}.`, caveat: idef.caveat };
  }

  // 2) Codelist-backed enumerations point at their permissible values.
  if ((field.type === 'enum' || field.type === 'array') && field.codelistId) {
    const cl = codelistById(field.codelistId);
    if (cl) {
      return {
        recommendedFormat: `Codelist: ${cl.name}${cl.partial ? ' (subset)' : ''}`,
        pattern: null,
        example: cl.values[0]?.code ?? '',
        rule: 'Value must be one of the permissible codes below.',
        permissible: cl.values.slice(0, 24).map((v) => ({ code: v.code, label: v.label })),
      };
    }
  }

  // 3) Type defaults.
  const td = TYPE_DEFAULTS[field.type];
  if (td) return { ...td };

  // 4) Name hints for plain strings.
  if (field.type === 'string') {
    const hit = NAME_HINTS.find((h) => h.test.test((field.name || '').toLowerCase()));
    if (hit) return { ...hit.spec };
  }

  // 5) Fallback — genuinely free text.
  return {
    recommendedFormat: 'Free text',
    pattern: null,
    example: '',
    rule: 'No structural constraint — if the values are actually constrained, add a codelist or a pattern.',
  };
}

/** A minimal JSON-Schema fragment for one field — used for the "Published as →"
 *  preview in the inspector. Mirrors the shape the JSON-Schema exporter emits. */
export function publishedFragment(field: Field): Record<string, unknown> {
  const spec = specForField(field);
  const JSON_TYPE: Partial<Record<FieldType, string>> = {
    string: 'string', integer: 'integer', number: 'number', boolean: 'boolean',
    date: 'string', datetime: 'string', enum: 'string', identifier: 'string',
    geo: 'string', currency: 'number', object: 'object', array: 'array',
  };
  const out: Record<string, unknown> = { type: JSON_TYPE[field.type] || 'string' };
  if (field.type === 'date') out.format = 'date';
  if (field.type === 'datetime') out.format = 'date-time';
  if (spec.pattern && field.type !== 'date' && field.type !== 'datetime') out.pattern = spec.pattern;
  if (spec.permissible?.length) out.enum = spec.permissible.map((v) => v.code);
  if ((field.description || '').trim()) out.description = field.description.trim().slice(0, 120);
  return out;
}
