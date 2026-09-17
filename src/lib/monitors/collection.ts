/**
 * The datastore collection monitors live in, on its own.
 *
 * It is a string, and `/api/jkai/hub-status` imports it to count rows. It used
 * to live in `monitors.server.ts`, which creates and edits monitors and
 * therefore reaches the workflow orchestrator — and through it the engine, the
 * node registry and all 139 node modules. So one constant put the whole workflow
 * engine on the chat hub's runtime graph.
 *
 * Third time this shape has appeared while untangling the chat boundary, after
 * `getChatHistory` (SR-Main #868, fourteen lines of SELECT costing 449 files)
 * and `JKAI_EXTENDED_TOOL`. A value that NAMES something does not need the code
 * that operates on it, and keeping them together makes every reader of the first
 * pay for the second.
 */
export const MONITORS_COLLECTION = 'monitors';
