// src/lib/selfimprove/chat-tools.ts
//
// `solution_run` (workflow knit 2026-11-11): the one-press solution on a
// daydream note. It lives here rather than in $lib/daydream/chat-tools because
// it needs the backlog ports from $lib/selfimprove, which daydream may not
// import (selfimprove already imports daydream).
import { register } from '$lib/tools/registry-internal';
// Registered from here (src/hooks.server.ts imports this module at boot).
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';

const idParam = { id: { type: 'string', description: 'The note id, from daydream_inbox or a /jkai/daydreams?note= link.' } };
const noteId = (args: Record<string, unknown>) => (typeof args.id === 'string' ? args.id.trim().slice(0, 200) : '');
const failed = (err: unknown, fallback: string) => ({ success: false as const, error: (err instanceof Error ? err.message : fallback).slice(0, 300) });

register({
  name: 'solution_run',
  effect: 'mutate',
  // Always: a press is the owner's verdict and acts with the owner's reach
  // (a build, the house), so nothing unattended may make it.
  confirm: 'always',
  description:
    'Carry out a daydream note\'s one-press solution, as the button on the note does: start the tracker, queue the build or run the fix the note proposes. Takes the note id; daydream_note_get shows whether the note has a solution. Nothing is sent to anyone. Use only when John asks for it.',
  parameters: { type: 'object', properties: { ...idParam }, required: ['id'] },
  category: 'Daydream',
  toolset: 'daydream',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('solution_run', ctx);
    if (refused) return refused;
    const id = noteId(args);
    if (!id) return { success: false, error: 'id is required' };
    try {
      const [{ thinkNoteKind }, { runSolution }, { backlogPorts }] = await Promise.all([
        import('$lib/daydream/think/notes.server'),
        import('$lib/daydream/act/solution.server'),
        import('$lib/selfimprove/follow-ports.server'),
      ]);
      if (!(await thinkNoteKind(id))) return { success: false, error: 'No such note' };
      const out = await runSolution(id, backlogPorts);
      if (!out.ok) return { success: false, error: (out.reason ?? 'That solution could not be run.').slice(0, 300) };
      return { success: true, data: { id, message: out.message ?? 'Done.', ...(out.href ? { url: out.href } : {}), ...(out.already ? { already: true } : {}) } };
    } catch (err) {
      return failed(err, 'That solution could not be run.');
    }
  },
});
