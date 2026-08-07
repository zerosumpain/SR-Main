// automation.ts — content for the Automation section: the workflow engine, its node
// catalogue, and the collision that eats data where two branches converge.

export const NODE_COUNT = 88;

export const CATEGORIES = [
  { id: 'trigger', name: 'Triggers', what: 'What starts a run: a schedule, an arriving message, a webhook, a person pressing go.' },
  { id: 'core', name: 'Core', what: 'The everyday verbs — call a model, call an API, send mail, read and write records, transform data.' },
  { id: 'control', name: 'Control', what: 'Shape: branch, loop, wait, dedupe, handle an error, hand off to another workflow.' },
  { id: 'integration', name: 'Integration', what: 'The outside world — mail, calendar, home automation, health data, search, scraping, messaging.' },
  { id: 'agentic', name: 'Agentic', what: 'Nodes that delegate judgement: run an agent, route with a model, research a question, ask a person.' },
  { id: 'custom', name: 'Custom', what: 'Tools the system wrote for itself, registered live once they clear the gate.' },
];

export const ENGINE_FACTS = [
  { k: 'Node types', v: '88', why: 'Counted from the registrations in the registry, not from the palette — the palette is a view of it.' },
  { k: 'Registry parity', v: 'Tested', why: 'A node that exists in the registry but not the palette is invisible; the reverse is a dead entry. A test asserts they agree.' },
  { k: 'Scheduling', v: 'Cron, in a named zone', why: 'A schedule that does not name its own timezone now defaults to the owner’s, not the server’s. It did not always, and that cost an hour for half of every year.' },
  { k: 'Palette', v: 'Smaller than the registry', why: 'Not every registered type belongs on a menu: a handful are legacy and deliberately hidden, so the palette is a curated view of the registry rather than a dump of it.' },
  { k: 'Resumability', v: 'Runs survive restarts', why: 'A workflow paused on a human approval has to still be there tomorrow.' },
  { k: 'New node types', v: 'Need a worker rebuild', why: 'The runner is a separately built bundle. Add a node type without rebuilding it and the canvas offers something the runner cannot execute.' },
];

/** The fan-in collision, as a runnable demonstration. */
export interface Branch { id: string; label: string; keys: string[]; wrapped?: string }

export const BRANCHES: Branch[] = [
  { id: 'accounts', label: 'Fetch accounts', keys: ['success', 'api', 'status', 'url', 'json'], wrapped: 'accounts' },
  { id: 'cards', label: 'Fetch cards', keys: ['success', 'api', 'status', 'url', 'json'], wrapped: 'cards' },
];

export const FANIN_STORY = {
  what: 'When several nodes feed one node, the engine builds that node’s input by merging each upstream in turn — flat, with no namespacing by source. Two nodes declaring the same top-level key means the one processed last silently wins, and the other’s data is gone before the target node ever sees it.',
  worst: 'Two API-call nodes are the worst case, because every API call emits the same key names. Wiring both straight into one node therefore throws away one of them, every time.',
  incident: 'The symptom is never at the join. The node that lost its input carries on with nothing where it expected data, and the run fails several nodes later with an error about something else entirely — which is exactly why the check below is static and runs before anything executes, rather than being left to whoever reads the eventual error.',
  trap: 'A merge node does NOT fix it. A merge node is a flat spread of its input — it collapses in exactly the same way. Reaching for the node named after the problem is the natural move and it is wrong.',
  fix: 'Give each branch its own key BEFORE the branches converge, with a small transform on each. Then nothing overlaps and nothing is lost.',
  now: 'The collision is now detected statically: the engine compares the declared output keys of every upstream and reports overlaps by name, with the fix, before a run is ever started.',
};

export const DOCTOR = [
  { k: 'Runs nightly', why: 'It reads the day’s failed runs and tries to work out which are configuration faults, which are wiring faults, and which are the environment being unreachable.' },
  { k: 'A circuit breaker is on', why: 'It stops itself if it starts doing too much. An automated repairer without a limit is a way to break everything at once, quietly, at five in the morning.' },
  { k: 'Config edits are off', why: 'It can diagnose and report, but it is not permitted to rewrite a workflow’s configuration unattended. That line was drawn deliberately, and it is the same line as everywhere else in this system.' },
];
