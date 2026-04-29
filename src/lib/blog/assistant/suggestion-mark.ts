import { Mark, mergeAttributes } from '@tiptap/core';

export const SuggestionMark = Mark.create({
  name: 'suggestion',

  addAttributes() {
    return {
      id: { default: null },
      // 'add' wraps the proposed insertion; 'remove' wraps the original (about to be removed).
      type: { default: 'add' },
    };
  },

  parseHTML() {
    return [
      { tag: 'ins[data-suggestion-id]', attrs: { type: 'add' } },
      { tag: 'del[data-suggestion-id]', attrs: { type: 'remove' } },
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
