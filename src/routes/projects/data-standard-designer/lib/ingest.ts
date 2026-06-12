// Ingest a catalog standard into the user's own design — turning a real
// published standard (its identifiers + key data items) into editable Fields,
// so a team can start their standard from an existing one rather than a blank
// page, or fold an existing standard's fields into what they're building.

import type { Field, Sector, StandardEntry, FieldType } from './types';
import { identifierById } from './knowledge';
import { FIELD_TEMPLATES } from './fieldLibrary';
import { emptyBrief, newFieldId } from './appState.svelte';

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'field';

const DESIGN_DOMAINS: Sector[] = ['education', 'childrens-social-care', 'child-protection', 'health', 'local-gov', 'cross-gov', 'employment', 'justice', 'housing'];

function guessType(s: string): FieldType {
  const t = s.toLowerCase();
  if (/\bdate\b|\bdob\b|birth|date of/.test(t)) return 'date';
  if (/\bflag\b|indicator|eligib|whether|\bis_/.test(t)) return 'boolean';
  if (/\bcode\b|status|\btype\b|ethnic|\bsex\b|category|provision|placement|reason/.test(t)) return 'enum';
  if (/number|count|amount|total|\bage\b/.test(t)) return 'number';
  return 'string';
}

/** Match a free-text key-field name to a library template (so it inherits a
 *  proper type, codelist, identifier, etc.), else build a sensible generic field. */
function fieldForKeyField(name: string, std: StandardEntry): Omit<Field, 'id'> {
  const n = name.toLowerCase().trim();
  const tpl = FIELD_TEMPLATES.find((t) => {
    const tt = `${t.name} ${t.title}`.toLowerCase();
    return tt.includes(n) || n.includes(t.name.replace(/_/g, ' ')) || n.includes(t.title.toLowerCase());
  });
  if (tpl) {
    const { domains, why, ...rest } = tpl;
    return { ...rest, sourceStandard: std.id };
  }
  const type = guessType(name);
  return {
    name: slug(name),
    title: name.replace(/\b\w/g, (c) => c.toUpperCase()),
    type,
    description: `From ${std.name}.`,
    required: false,
    pii: /name|dob|birth|address|pupil|child|person|nhs/i.test(n),
    specialCategory: /ethnic|health|disab|religion|sexual|sen\b|protection|offence/i.test(n),
    sourceStandard: std.id,
    ...(type === 'enum' ? { codelist: `${std.name} ${name}` } : {}),
    ...(type === 'date' ? { format: 'ISO 8601 (YYYY-MM-DD)' } : {}),
  };
}

/** Build editable fields from a standard: its identifiers first, then its key data items. */
export function fieldsFromStandard(std: StandardEntry): Field[] {
  const out: Field[] = [];
  const seen = new Set<string>();
  const push = (f: Omit<Field, 'id'>) => {
    const name = slug(f.name || f.title);
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ ...f, name, id: newFieldId() } as Field);
  };

  for (const idId of std.identifiers || []) {
    const idef = identifierById(idId);
    if (!idef) continue;
    push({
      name: idId.replace(/-/g, '_'),
      title: idef.name.replace(/\s*\(.*\)/, ''),
      type: 'identifier',
      description: idef.scope,
      required: false,
      pii: /pupil|learner|person|child|patient|individual/i.test(idef.scope),
      specialCategory: false,
      identifier: idId,
      format: idef.format,
      sourceStandard: std.id,
      ...(idef.caveat ? { constraints: idef.caveat } : {}),
    });
  }
  for (const kf of std.keyFields || []) push(fieldForKeyField(kf, std));
  return out;
}

/** Whether a standard has anything worth ingesting as fields. */
export function canIngest(std: StandardEntry): boolean {
  return !!((std.identifiers && std.identifiers.length) || (std.keyFields && std.keyFields.length));
}

/** A complete starter design seeded from a standard (for "use as a starting point"). */
export function designFromStandard(std: StandardEntry): { brief: import('./types').Brief; fields: Field[] } {
  const fields = fieldsFromStandard(std);
  const brief = emptyBrief();
  brief.name = `${std.name} — working standard`;
  brief.purpose = std.dataCovered ? `${std.description} Covers: ${std.dataCovered}.` : std.description;
  brief.domain = DESIGN_DOMAINS.includes(std.sector) ? std.sector : 'cross-gov';
  brief.containsPersonalData = fields.some((f) => f.pii);
  brief.containsSpecialCategory = fields.some((f) => f.specialCategory);
  brief.notes = `Started from the published standard "${std.name}" (${std.owner}).`;
  return { brief, fields };
}
