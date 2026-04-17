-- Fix scheduled workflows that were broken by the `input.output.X` docs bug
-- and, for the Family Departure Detector, add the missing data-store(set)
-- so `previous` states can persist between runs.
--
-- Bugs being fixed:
--   Bug A: node definitions used to say downstream inputs are at `input.output.X`,
--          but the engine merges upstream outputs directly into the downstream
--          input (see engine.ts:140-146 / nodeOutputs.set(nodeId, result.output)).
--          Fields are therefore at `input.X`, not `input.output.X`.
--   Bug C: the Family Departure Detector reads `previous` from data-store but has
--          no matching `set` node, so `previous` is always null and the node
--          can never detect a departure.
--
-- Workflows touched:
--   Family Departure Detector: 75bd5bc5-3297-4509-956e-3851b3811491
--   Poll UK Coffee Research:   f5b80e72-66f2-45c6-9bf9-51c0ead59d65
--
-- Review carefully before applying. Does not run any engine code — pure SQL.

BEGIN;

-- ============================================================================
-- 1. Family Departure Detector (75bd5bc5-3297-4509-956e-3851b3811491)
-- ============================================================================

-- 1a. Replace the code-execute node's code so it reads `input.value` / `input.data`
--     instead of `input.output?.value` / `input.output?.data`. The new JS wrapper
--     supports top-level `return`, so the function body below ends with a return.
UPDATE workflow_nodes
SET config = jsonb_set(
  config,
  '{code}',
  to_jsonb($js$
// Detect departures by comparing current Home Assistant states against the
// previously-stored snapshot in the data store.
//
// Upstream inputs (merged directly — no `.output` wrapper):
//   input.value  — stored snapshot from data-store(get), or null on first run
//   input.data   — HA render_template result: { result: '{"jemima":"home",...}' }
//                  (HA /api/template returns plain text, service wraps as { result: text })

const previous = (input && input.value) || {};

// Parse the HA template result — it's a JSON string inside data.result
let currentStates = {};
try {
  const raw = input && input.data;
  if (raw && typeof raw.result === 'string') {
    currentStates = JSON.parse(raw.result);
  } else if (raw && typeof raw === 'object') {
    currentStates = raw;
  }
} catch (e) {
  currentStates = {};
}

const names = {
  jemima: 'Jemima',
  fintan: 'Fintan',
  katie: 'Katie',
  john: 'John',
  john_kelly: 'John Kelly'
};

// On first run (no saved data), assume everyone was home
const prev = previous || {};
Object.keys(names).forEach(k => {
  if (!(k in prev)) prev[k] = 'home';
});

// Detect departures: was home, now not_home
const departures = [];
Object.keys(names).forEach(k => {
  if (prev[k] === 'home' && currentStates[k] === 'not_home') {
    departures.push(names[k]);
  }
});

let message = '';
if (departures.length > 0) {
  message = departures.map(n => '\ud83d\udeaa ' + n + ' has left home').join('\n');
}

return { departures, message, currentStates };
$js$::text)
)
WHERE id = 'code-execute-2739a9eb-5'
  AND workflow_id = '75bd5bc5-3297-4509-956e-3851b3811491';

-- 1b. Insert the missing data-store(set) node so the current snapshot is
--     persisted for the next scheduled run.
INSERT INTO workflow_nodes (id, workflow_id, type, position, config, label)
VALUES (
  'data-store-2739a9eb-8',
  '75bd5bc5-3297-4509-956e-3851b3811491',
  'data-store',
  '{"x": 1200, "y": 200}'::jsonb,
  '{"operation":"set","key":"family_presence_states","valuePath":"currentStates"}'::jsonb,
  'Save current states'
);

-- 1c. Connect code-execute -> data-store(set). No source handle so it runs
--     regardless of any conditional downstream — we always want the latest
--     snapshot saved.
INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_handle, target_handle)
VALUES (
  '75bd5bc5-3297-4509-956e-3851b3811491',
  'code-execute-2739a9eb-5',
  'data-store-2739a9eb-8',
  NULL,
  NULL
);

-- ============================================================================
-- 2. Poll UK Coffee Research (f5b80e72-66f2-45c6-9bf9-51c0ead59d65)
-- ============================================================================
-- Fix the conditional node's expression: remove the `.output` wrapper.
-- Old expression: input.output && input.output.data && input.output.data.status === 'complete'
-- New expression: input.data && input.data.status === 'complete'
--
-- This is done generically via regexp_replace against the node's config->>'expression'
-- for all conditional nodes in this workflow whose expression mentions `input.output`.
-- If there's only one conditional node, this is equivalent to a targeted UPDATE; if
-- there are more, we want them all fixed anyway.

UPDATE workflow_nodes
SET config = jsonb_set(
  config,
  '{expression}',
  to_jsonb(
    regexp_replace(
      config->>'expression',
      'input\.output(\.|\s|$)',
      'input\1',
      'g'
    )
  )
)
WHERE workflow_id = 'f5b80e72-66f2-45c6-9bf9-51c0ead59d65'
  AND type = 'conditional'
  AND config ? 'expression'
  AND config->>'expression' LIKE '%input.output%';

COMMIT;
