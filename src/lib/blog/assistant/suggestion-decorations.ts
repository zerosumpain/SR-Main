import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Each pending suggestion is represented by a Range over the live document
 * plus the text that would replace it on accept. Ranges are tracked outside
 * the document content as ProseMirror decorations — they render as inline
 * spans for visual highlighting but are never persisted into the saved HTML.
 *
 * Why not document marks? Marks live inside the doc and survive `setContent`
 * by being parsed/serialised, which is fragile (attributes get dropped,
 * adjacent text nodes are coalesced, accept-of-one mangles the others).
 * Decorations sit beside the doc and are mapped through every transaction by
 * ProseMirror itself, so they always point at the right text without any
 * string surgery on our part.
 */
export type SuggestionRange = { from: number; to: number; replace: string };

type PluginState = { ranges: Map<string, SuggestionRange>; activeId: string | null };

export const suggestionPluginKey = new PluginKey<PluginState>('suggestion-decorations');

type Meta =
  | { add: { id: string; from: number; to: number; replace: string } }
  | { remove: string }
  | { clear: true }
  | { activeId: string | null };

export const SuggestionDecorations = Extension.create({
  name: 'suggestionDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: suggestionPluginKey,
        state: {
          init: () => ({ ranges: new Map(), activeId: null }),
          apply(tr, prev) {
            // 1) Map every range forward through this transaction so the
            //    highlight follows its text as the user types around it.
            const next = new Map<string, SuggestionRange>();
            for (const [id, r] of prev.ranges) {
              const from = tr.mapping.map(r.from, 1);
              const to = tr.mapping.map(r.to, -1);
              if (from < to) next.set(id, { from, to, replace: r.replace });
            }

            // 2) Apply any meta operation we attached.
            let activeId = prev.activeId;
            const meta = tr.getMeta(suggestionPluginKey) as Meta | undefined;
            if (meta) {
              if ('add' in meta) {
                next.set(meta.add.id, { from: meta.add.from, to: meta.add.to, replace: meta.add.replace });
              } else if ('remove' in meta) {
                next.delete(meta.remove);
                if (activeId === meta.remove) activeId = null;
              } else if ('clear' in meta) {
                next.clear();
                activeId = null;
              } else if ('activeId' in meta) {
                activeId = meta.activeId;
              }
            }

            return { ranges: next, activeId };
          },
        },
        props: {
          decorations(state) {
            const ps = suggestionPluginKey.getState(state);
            if (!ps) return null;
            const decos: Decoration[] = [];
            for (const [id, r] of ps.ranges) {
              decos.push(
                Decoration.inline(r.from, r.to, {
                  class: ps.activeId === id ? 'sg-remove sg-active' : 'sg-remove',
                  'data-suggestion-id': id,
                }),
              );
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
