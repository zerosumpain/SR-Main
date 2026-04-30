import { Mark, mergeAttributes } from '@tiptap/core';

export const SuggestionMark = Mark.create({
  name: 'suggestion',

  addAttributes() {
    return {
      id: {
        default: null,
        // The DOM attr is `data-suggestion-id`, not `id`. Without this
        // explicit parseHTML the round-trip loses ids and every other
        // pending proposal becomes unanchorable.
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-suggestion-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-suggestion-id': attrs.id } : {}),
      },
      // 'add' wraps the proposed insertion; 'remove' wraps the original (about to be removed).
      type: {
        default: 'add',
        parseHTML: (el) => ((el as HTMLElement).tagName.toLowerCase() === 'del' ? 'remove' : 'add'),
        // type is reflected via the tag name in renderHTML, not as an attr.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'ins[data-suggestion-id]' },
      { tag: 'del[data-suggestion-id]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const tag = HTMLAttributes.type === 'remove' ? 'del' : 'ins';
    const attrs = mergeAttributes(
      {
        'data-suggestion-id': HTMLAttributes.id,
        class: HTMLAttributes.type === 'remove' ? 'sg-remove' : 'sg-add',
      },
    );
    return [tag, attrs, 0];
  },

  // Suggestions are inclusive — marks expand as the user types inside them
  // (relevant for the "modify" interaction).
  inclusive: true,
});
