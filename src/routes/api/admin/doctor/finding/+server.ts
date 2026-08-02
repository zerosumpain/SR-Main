import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  NodeNotFoundError,
  SensitiveRefusalError,
  VersionConflictError,
  revertNodeConfig,
} from '$lib/canvas/mutate.server';
import { getFinding, setFindingStatus } from '$lib/workflowdoctor/findings';
import { releaseQuarantine } from '$lib/workflowdoctor/fix';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). The ONLY human
// write path into `doctor_findings`, and the manual undo behind every fix the
// doctor applied on its own.
//
// `accept` / `dismiss` are verdicts: `upsertFinding` treats both as sticky, so a
// dismissed finding is not re-proposed every night — which is the whole point of
// having a verdict.
//
// `revert` is a real mutation and takes one of two paths, chosen by the
// before-image: a quarantined schedule is re-enabled through the breaker's own
// release function, and a node fix is replayed through `revertNodeConfig` — the
// same adapter the doctor and the canvas PATCH route write through, so the
// revert cannot skip the version check or the audit redaction.

const ACTIONS = ['accept', 'dismiss', 'revert'] as const;
type Action = (typeof ACTIONS)[number];

const OWNER = 'owner';

/** POST { key, action } — record a verdict, or undo an applied fix. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { key?: unknown; action?: unknown };

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) return json({ error: '`key` is required' }, { status: 400 });

  const action = body.action as Action;
  if (!ACTIONS.includes(action)) {
    return json({ error: `\`action\` must be one of: ${ACTIONS.join(', ')}` }, { status: 400 });
  }

  const finding = await getFinding(key);
  if (!finding) return json({ error: 'No such finding.' }, { status: 404 });

  if (action !== 'revert') {
    const status = action === 'accept' ? 'accepted' : 'dismissed';
    const updated = await setFindingStatus(key, status);
    if (!updated) return json({ error: 'No such finding.' }, { status: 404 });
    return json({ ok: true, status: updated.status });
  }

  const before = finding.beforeImage;
  if (!before) {
    return json(
      { error: 'This finding has no before-image — there is nothing to undo.' },
      { status: 400 },
    );
  }
  // Only a fix that is currently IN EFFECT can be undone. Without this, a second
  // click on a schedule revert re-enables a cron the owner may have stopped by
  // hand in between, and a second click on a node revert would 409 anyway.
  if (finding.status !== 'auto_fixed') {
    return json(
      { error: `Only an applied fix can be reverted (this one is "${finding.status}").` },
      { status: 409 },
    );
  }

  if (before.scheduleId) {
    const released = await releaseQuarantine(before.scheduleId);
    // `false` means the row was already enabled — someone re-armed it by hand.
    // The quarantine is not in effect either way, so the finding is honestly
    // 'reverted'; the response says which of the two happened.
    await setFindingStatus(key, 'reverted');
    return json({
      ok: true,
      status: 'reverted',
      released,
      message: released
        ? 'Schedule re-enabled.'
        : 'Schedule was already enabled — finding marked reverted.',
    });
  }

  try {
    const result = await revertNodeConfig(before, OWNER);
    await setFindingStatus(key, 'reverted');
    return json({
      ok: true,
      status: 'reverted',
      version: result.after.version,
      message: 'Node config restored.',
    });
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return json(
        {
          error:
            `The node has been edited since the fix (expected v${err.expectedVersion}, ` +
            `stored v${err.currentVersion}). Refusing to overwrite that edit.`,
        },
        { status: 409 },
      );
    }
    if (err instanceof SensitiveRefusalError) {
      // 422, not 409: nothing to retry. Restoring the old value would republish
      // the credential through workflow_audit_log.details. Field names only.
      return json(
        {
          error:
            `That node now holds a credential in: ${err.fields.join(', ')}. ` +
            'Reverting would republish the value through the workflow audit log. ' +
            'Delete the node and recreate it, keeping the secret in /admin/ai/apis.',
          sensitiveFields: err.fields,
        },
        { status: 422 },
      );
    }
    if (err instanceof NodeNotFoundError) {
      return json({ error: 'That node no longer exists.' }, { status: 404 });
    }
    throw err;
  }
};
