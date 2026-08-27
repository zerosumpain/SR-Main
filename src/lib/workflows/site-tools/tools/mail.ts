// Searching the mail that was allowed into the graph.
//
// Sibling of `file_search` over $lib/file-index — same vector space, same
// ranking — but over admitted email threads and their attachments' text rather
// than /drive documents. Registered separately because the two answer different
// questions and a caller usually knows which it wants: "what did we agree" is
// mail, "what does the report say" is files.
//
// Only ADMITTED threads are indexed, so this cannot reach mail the owner has
// not approved. That is enforced in the index and again in the query.
import { register } from '../registry-internal';
import { searchMail, readMail } from '$lib/mail-index/search';

register({
  name: 'mail_search',
  description:
    'Semantic search over email threads that have been admitted to the knowledge graph, including the text of their attachments. Returns ranked passages with the thread subject, who was on it, when it was received, and a link into Gmail. Use this for "what did X say about Y", "what did we agree", or anything whose answer is a sentence inside an email. Only threads the owner approved are searchable — held or rejected mail is invisible here. For documents in /drive use file_search instead.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What you are looking for, in natural language' },
      limit: { type: 'number', description: 'Max passages to return (default 8, max 30)' },
      minScore: { type: 'number', description: 'Minimum cosine similarity 0–1 (default 0.2)' },
    },
    required: ['query'],
  },
  category: 'Intel',
  toolset: 'intel',
  handler: async (args) => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return { success: false, error: 'mail_search needs a query.' };
    const hits = await searchMail(query, {
      topK: Number(args.limit) || undefined,
      minSim: Number.isFinite(Number(args.minScore)) ? Number(args.minScore) : undefined,
    });
    return {
      success: true,
      data: {
        query,
        count: hits.length,
        // Said explicitly rather than left as an empty array. "No admitted mail
        // matched" and "no mail has been admitted" are different answers, and a
        // model that cannot tell them apart will report the wrong one.
        note: hits.length
          ? undefined
          : 'No admitted email matched. Threads must be approved at /jkai/intel/mail before they are searchable.',
        hits,
      },
    };
  },
});

register({
  name: 'mail_read',
  description:
    'Read every indexed passage of one admitted email thread, in order. Use after mail_search when a single passage is not enough. Takes the noteId from a mail_search hit.',
  parameters: {
    type: 'object',
    properties: {
      noteId: { type: 'string', description: 'The noteId from a mail_search hit' },
    },
    required: ['noteId'],
  },
  category: 'Intel',
  toolset: 'intel',
  handler: async (args) => {
    const noteId = typeof args.noteId === 'string' ? args.noteId.trim() : '';
    if (!noteId) return { success: false, error: 'mail_read needs a noteId.' };
    const thread = await readMail(noteId);
    if (!thread) {
      return { success: false, error: 'No admitted thread with that id — it may be held or rejected.' };
    }
    return { success: true, data: thread };
  },
});
