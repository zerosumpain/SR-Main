import { allTypes, byType, CANVAS_NODE_GROUPS, mapTypeToKind, type NodeTypeOption } from '$lib/canvas/adapter';
import { getDefinition } from '$lib/workflows/registry-client';
import { isDisplayOnlyType, type NodeDefinition } from '$lib/workflows/types';
import { deriveFormFields, type FieldDTO } from './dto';

/**
 * The iPhone's "Add step" catalogue — the canvas "+ node" palette, minus what a
 * phone cannot place.
 *
 * Starts from the palette's own list (`allTypes()`, curated entries merged over
 * registry-derived ones) and applies the palette's own two exclusions —
 * `Annotations` (inert decoration) and `deskOnly` (Research Desk nodes with no
 * workflow executor) — so the two never disagree about what exists. Then drops
 * what only makes sense on a canvas: display-only panels (stats, post-its),
 * hidden legacy defs, and `trigger`, which every canvas is born with and which
 * the phone edits through `/trigger` rather than by adding a second.
 */

export interface NodeTypeDTO {
  type: string;
  label: string;
  description: string;
  icon: string | null;
  defaultConfig: Record<string, unknown>;
  form: FieldDTO[];
}

export interface NodeCategoryDTO {
  id: string;
  label: string;
  types: NodeTypeDTO[];
}

/** 'Trigger & Flow' → 'trigger-flow'. Stable: the phone may key on it. */
export function categoryId(group: string): string {
  return group
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The palette group a node type sits in, as a category id — the same one `/node-types` files it under. */
export function categoryOfType(type: string): string {
  return categoryId(byType(type)?.group ?? 'Integrations');
}

export function isPhonePlaceable(
  option: NodeTypeOption,
  def: Pick<NodeDefinition, 'hidden'> | undefined,
): boolean {
  if (option.group === 'Annotations') return false;
  if (option.deskOnly) return false;
  if (option.type === 'trigger') return false;
  if (isDisplayOnlyType(option.type)) return false;
  if (mapTypeToKind(option.type) === 'stats') return false;
  if (def?.hidden) return false;
  return true;
}

export function nodeTypeCatalogue(): NodeCategoryDTO[] {
  const byGroup = new Map<string, NodeTypeDTO[]>();
  for (const option of allTypes()) {
    const def = getDefinition(option.type);
    if (!isPhonePlaceable(option, def)) continue;
    const list = byGroup.get(option.group) ?? [];
    list.push({
      type: option.type,
      label: option.label,
      description: def?.description ?? option.description,
      icon: null,
      defaultConfig: { ...option.defaultConfig },
      form: deriveFormFields(def),
    });
    byGroup.set(option.group, list);
  }
  const order: string[] = [...CANVAS_NODE_GROUPS];
  return [...byGroup.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    })
    .map(([group, types]) => ({ id: categoryId(group), label: group, types }));
}
