// Integrity suite for the commitments dataset — every record research-backed,
// every cross-reference valid. Runs against whatever data exists (bites hard once B1 lands).
import { describe, it, expect } from 'vitest';
import {
  DOCUMENTS,
  COMMITMENTS,
  DOCUMENTS_BY_ID,
  COMMITMENTS_BY_DOC,
  THEME_META,
  STATUS_META,
  ROLE_META,
} from '../commitments';
import { ORGS, ORG_BY_ID } from '../orgs';
import { CAPABILITY_IDS } from '../capabilities';
import { PRESSURES } from '$lib/dfe-data-strategy/pressures';

const PRESSURE_IDS = new Set(PRESSURES.map((p) => p.id));
const CAP_IDS = new Set(CAPABILITY_IDS);
const ORG_IDS = new Set(ORGS.map((o) => o.id));
const DOC_IDS = new Set(DOCUMENTS.map((d) => d.id));

describe('orgs registry', () => {
  it('has unique ids and a lookup that matches', () => {
    expect(ORG_IDS.size).toBe(ORGS.length);
    for (const o of ORGS) expect(ORG_BY_ID[o.id]).toBe(o);
  });
  it('places the department at the centre (ring 0)', () => {
    expect(ORGS.filter((o) => o.ring === 0).map((o) => o.id)).toEqual(['dfe']);
  });
  it('keeps angles within 0–360 and rings 0–3', () => {
    for (const o of ORGS) {
      expect(o.angle).toBeGreaterThanOrEqual(0);
      expect(o.angle).toBeLessThan(360);
      expect([0, 1, 2, 3]).toContain(o.ring);
    }
  });
});

describe('documents', () => {
  it('has unique ids and a matching lookup', () => {
    expect(DOC_IDS.size).toBe(DOCUMENTS.length);
    for (const d of DOCUMENTS) expect(DOCUMENTS_BY_ID[d.id]).toBe(d);
  });
  it('every document has a real url, date and one-liner', () => {
    for (const d of DOCUMENTS) {
      expect(d.url, d.id).toMatch(/^https?:\/\//);
      expect(d.date, d.id).toMatch(/^\d{4}-\d{2}$/);
      expect(d.oneLiner.length, d.id).toBeGreaterThan(10);
      expect(d.shortName.length, d.id).toBeGreaterThan(1);
    }
  });
});

describe('commitments', () => {
  it('has unique ids', () => {
    expect(new Set(COMMITMENTS.map((c) => c.id)).size).toBe(COMMITMENTS.length);
  });
  it('every docId resolves to a document, and the by-doc index covers all', () => {
    for (const c of COMMITMENTS) expect(DOC_IDS.has(c.docId), `${c.id} → ${c.docId}`).toBe(true);
    const indexed = Object.values(COMMITMENTS_BY_DOC).flat().length;
    expect(indexed).toBe(COMMITMENTS.length);
  });
  it('every flow endpoint is a registered org', () => {
    for (const c of COMMITMENTS)
      for (const f of c.flows) {
        expect(ORG_IDS.has(f.from), `${c.id} flow.from ${f.from}`).toBe(true);
        expect(ORG_IDS.has(f.to), `${c.id} flow.to ${f.to}`).toBe(true);
        expect(f.what.length, `${c.id} flow.what`).toBeGreaterThan(4);
      }
  });
  it('every capability/pressure reference is valid', () => {
    for (const c of COMMITMENTS) {
      expect(c.capabilityIds.length, `${c.id} capabilityIds`).toBeGreaterThan(0);
      for (const id of c.capabilityIds) expect(CAP_IDS.has(id), `${c.id} cap ${id}`).toBe(true);
      for (const id of c.pressureIds ?? []) expect(PRESSURE_IDS.has(id), `${c.id} pressure ${id}`).toBe(true);
    }
  });
  it('every commitment is sourced, themed and implication-bearing', () => {
    for (const c of COMMITMENTS) {
      expect(c.sourceUrls.length, `${c.id} sources`).toBeGreaterThan(0);
      for (const u of c.sourceUrls) expect(u, c.id).toMatch(/^https?:\/\//);
      expect(THEME_META[c.theme], `${c.id} theme ${c.theme}`).toBeTruthy();
      expect(STATUS_META[c.status], `${c.id} status ${c.status}`).toBeTruthy();
      expect(ROLE_META[c.dfeRole], `${c.id} role ${c.dfeRole}`).toBeTruthy();
      expect(c.strategyImplication.length, `${c.id} implication`).toBeGreaterThan(20);
      expect(c.what.length, `${c.id} what`).toBeGreaterThan(30);
      expect(c.aliases.length, `${c.id} aliases`).toBeGreaterThan(0);
    }
  });
  it('timeframeDate, when present, is YYYY-MM', () => {
    for (const c of COMMITMENTS) if (c.timeframeDate) expect(c.timeframeDate, c.id).toMatch(/^\d{4}-\d{2}$/);
  });
  it('quotes stay short (fair-dealing discipline)', () => {
    for (const c of COMMITMENTS) if (c.quote) expect(c.quote.split(/\s+/).length, c.id).toBeLessThanOrEqual(30);
  });
});
