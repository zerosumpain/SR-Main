import type { NodeHandles } from './handles';

/**
 * The Research Desk's node palette.
 *
 * This file used to be the whole workflow canvas palette: every curated node
 * type plus the ones generated from Main's copy of the workflow node registry.
 * The workflow canvas and its node registry belong to SR-Workflows, and on
 * 2026-10-02 Main's copy was deleted. What remains is the only palette Main
 * still renders: the three live, session-scoped desk nodes, which have no
 * workflow executor and are never persisted to the workflow tables.
 */

export type NodeKind = 'research-chat' | 'research-report' | 'webpage';

export type NodeTypeOption = {
  type: string;
  label: string;
  kind: NodeKind;
  group: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  handles: NodeHandles;
  defaultWeight?: number;
  /** Desk-only node types: live interactive nodes with no workflow executor. */
  deskOnly?: boolean;
};

const DESK_NODE_TYPES: readonly NodeTypeOption[] = Object.freeze([
  {
    type: 'research-chat',
    label: 'Research Chat',
    kind: 'research-chat',
    group: 'Intelligence',
    description: 'Chat grounded in this research session — answers cite the session\'s facts and sources.',
    defaultConfig: { size: { w: 380, h: 460 } },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'intel-session'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
    deskOnly: true,
  },
  {
    type: 'research-report',
    label: 'Research Report',
    kind: 'research-report',
    group: 'Intelligence',
    description: 'Expandable report preview for this session, with regenerate + docx/markdown export.',
    defaultConfig: { size: { w: 420, h: 520 } },
    handles: {
      inputs: [{ id: 'in', kinds: ['text', 'research-result', 'intel-session'] }],
      outputs: [{ id: 'out', kinds: ['text'] }],
    },
    deskOnly: true,
  },
  {
    type: 'webpage',
    label: 'Webpage',
    kind: 'webpage',
    group: 'Intel & Web',
    description: 'Render a live webpage inside the canvas (falls back to a proxy for sites that block framing).',
    defaultConfig: { url: '', mode: null, size: { w: 720, h: 480 } },
    handles: {
      inputs: [{ id: 'src', kinds: ['url', 'research-result', 'text'] }],
      outputs: [
        { id: 'currentUrl', kinds: ['url'] },
        { id: 'selectedText', kinds: ['text'] },
        { id: 'extractedText', kinds: ['text'] },
      ],
    },
    defaultWeight: 0.3,
    deskOnly: true,
  },
]);

export function allTypes(): readonly NodeTypeOption[] {
  return DESK_NODE_TYPES;
}

export function byType(type: string): NodeTypeOption | undefined {
  return DESK_NODE_TYPES.find((t) => t.type === type);
}

/** The visual kind of a desk node type. */
export function mapTypeToKind(type: string): NodeKind {
  return byType(type)?.kind ?? 'webpage';
}
