import { describe, it, expect } from 'vitest';
import { byType, mapTypeToKind, type NodeKind } from './adapter';

describe('research desk node types', () => {
  it('registers research-chat in CANVAS_NODE_TYPES', () => {
    const t = byType('research-chat');
    expect(t).toBeDefined();
    expect(t!.kind).toBe<NodeKind>('research-chat');
    expect(t!.group).toBe('Intelligence');
    expect(t!.label).toBe('Research Chat');
    // chat node: one text input (a trigger/wire), one text output
    expect(t!.handles.inputs.length).toBe(1);
    expect(t!.handles.outputs.length).toBe(1);
  });

  it('registers research-report in CANVAS_NODE_TYPES', () => {
    const t = byType('research-report');
    expect(t).toBeDefined();
    expect(t!.kind).toBe<NodeKind>('research-report');
    expect(t!.group).toBe('Intelligence');
    expect(t!.label).toBe('Research Report');
    expect(t!.handles.inputs.length).toBe(1);
    expect(t!.handles.outputs.length).toBe(1);
  });

  it('maps the new types to their dedicated kinds', () => {
    expect(mapTypeToKind('research-chat')).toBe<NodeKind>('research-chat');
    expect(mapTypeToKind('research-report')).toBe<NodeKind>('research-report');
  });

  it('exposes the new types via byType with a defaultConfig object', () => {
    expect(byType('research-chat')!.defaultConfig).toBeTypeOf('object');
    expect(byType('research-report')!.defaultConfig).toBeTypeOf('object');
  });
});
