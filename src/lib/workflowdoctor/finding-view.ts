// src/lib/workflowdoctor/finding-view.ts
//
// What the owner's doctor controls are allowed to know about a finding.
// Moved from the retired /admin/ai/doctor page (2026-10-02) when its switches
// and undo list folded into /jkai/develop/doctor.

import { FIX_KIND_LABELS, type DoctorFindingData } from './types';

export interface FindingView {
  key: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  fixKind: DoctorFindingData['fixKind'];
  /** Resolved here so the page never has to import the engine's constants. */
  fixKindLabel: string;
  status: DoctorFindingData['status'];
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  updatedAt: string;
  symptom: string;
  cause: string;
  causeSource: DoctorFindingData['causeSource'];
  fix: string;
  sensitiveFields?: string[];
  /** null = nothing to undo. Drives which revert path the API will take. */
  revertKind: 'node' | 'schedule' | null;
  /** Field NAMES from the before-image. The values never leave the server. */
  changedFields: string[];
  verifyBefore?: number;
  verifyAfter?: number;
}

/**
 * A before-image holds the OLD VALUES of the config keys the doctor changed —
 * i.e. exactly the payload the whole feature refuses to republish. The page
 * needs to say *which fields* moved so a human can judge the undo; it never
 * needs the values, so they are dropped here rather than in the template.
 */
export function toFindingView(row: { key: string; data: DoctorFindingData }): FindingView {
  const before = row.data.beforeImage;
  return {
    key: row.key,
    workflowId: row.data.workflowId,
    workflowName: row.data.workflowName,
    canvasSlug: row.data.canvasSlug,
    nodeId: row.data.nodeId,
    nodeType: row.data.nodeType,
    nodeLabel: row.data.nodeLabel,
    fixKind: row.data.fixKind,
    fixKindLabel: FIX_KIND_LABELS[row.data.fixKind] ?? row.data.fixKind,
    status: row.data.status,
    occurrences: row.data.occurrences ?? 0,
    firstSeen: row.data.firstSeen,
    lastSeen: row.data.lastSeen,
    updatedAt: row.data.updatedAt,
    symptom: row.data.symptom,
    cause: row.data.cause,
    causeSource: row.data.causeSource,
    fix: row.data.fix,
    sensitiveFields: row.data.sensitiveFields,
    revertKind: before ? (before.scheduleId ? 'schedule' : 'node') : null,
    changedFields: Object.keys(before?.changedFields ?? {}),
    verifyBefore: row.data.verifyBefore,
    verifyAfter: row.data.verifyAfter,
  };
}
