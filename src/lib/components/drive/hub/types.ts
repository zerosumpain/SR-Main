/** The shapes the four /drive sections pass between them. */

export type IndexStatus = 'indexed' | 'pending' | 'no-text' | 'failed' | 'skipped';

export interface FileRow {
  id: string;
  name: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  permissions: { read?: boolean; write?: boolean; append?: boolean; delete?: boolean } | null;
  uploadedBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  indexError?: string | null;
  indexChunks?: number;
  indexModality?: string | null;
  indexStatus?: IndexStatus;
}

export interface ShareRow {
  id: string;
  fileId: string;
  fileName: string;
  label: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  active: boolean;
}

export interface EditDraft {
  name: string;
  description: string;
  permissions: { read: boolean; write: boolean; append: boolean; delete: boolean };
}

export type ViewMode = 'list' | 'grid';

/** What the last completed move can put back, and what to call it. */
export interface UndoableMove {
  summary: string;
  restore: { id: string; name: string }[];
}
