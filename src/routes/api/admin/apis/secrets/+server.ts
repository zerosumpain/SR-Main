import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isOwnerEmail } from '$lib/server/access';
import {
  amendSecretValueFields,
  deleteSecret,
  listRefSources,
  listSecrets,
  rotateSecretValue,
  updateSecretBinding,
  upsertSecret,
  SecretError,
  type SecretInjection,
  type SecretSource,
} from '$lib/secrets/registry';
import {
  buildCreatePlan,
  CREDENTIAL_REQUEST_SPECS,
  CredentialSpecError,
  type CreateWrite,
} from '$lib/secrets/credential-requests';
import { bindingAfterConfirmation, consumePendingUpdate } from '$lib/secrets/pending-updates';
import { consumePendingCreate, resolveCreateInput } from '$lib/secrets/pending-creates';

// There is deliberately NO endpoint that returns a secret value — not even for
// the owner, not even write-then-read. `listSecrets` returns SecretMeta, which
// has no value field, so "the admin UI leaked the key" is not a mistake this
// surface can make. Values are entered write-only and only ever leave the
// process attached to an outbound request to an owner-allowed host.
//
// MUTATIONS RE-CHECK THE OWNER SESSION HERE, deliberately not relying on
// hooks.server.ts. On homeserv `AUTH_BYPASS=1` short-circuits the auth handle
// for any private/loopback client address BEFORE any session check, so a
// cookieless `curl http://127.0.0.1:5173/api/admin/apis/secrets` returns 200 —
// verified. Anything that can make a loopback request in the site's own
// environment (notably Hermes' `terminal`/`execute_code`, which jkai does reach
// for) could otherwise rebind a credential's allowedHosts to its own host and
// then read it back through a normal api_call. Host binding is the whole
// security property, so the route that edits a binding cannot inherit an
// auth bypass. Reads stay bypass-friendly: they expose metadata only.

async function requireOwner(locals: App.Locals): Promise<Response | null> {
  const session = await locals.auth();
  const email = session?.user?.email;
  if (!email || !isOwnerEmail(email)) {
    return json(
      {
        error:
          'Changing a credential requires a signed-in owner session. The homeserv LAN auth bypass does not grant it — ' +
          'sign in at /login and retry. (Host bindings are the security boundary for keys jkai can use but not read.)',
      },
      { status: 403 },
    );
  }
  return null;
}

function errResponse(err: unknown) {
  // Both are "the owner can fix this by typing something different", so both
  // report as a 400 with the message unchanged — the modal renders it verbatim.
  if (err instanceof SecretError || err instanceof CredentialSpecError) {
    return json({ error: err.message }, { status: 400 });
  }
  return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 500 });
}

/**
 * Write a brand-new credential from the plan the chat gate parked under this
 * request id.
 *
 * The plan supplies the handle, source, injection, methods and path scoping. The
 * browser supplies the values the owner typed and — only where the plan says so
 * — the hostname:
 *
 *   * `hostEditable` is the `custom` path: the host began as a model suggestion,
 *     is rendered as an editable box, and is whatever the owner leaves in it.
 *   * `hostFromField` is for credentials that name their own endpoint (a Kafka
 *     bootstrap server issued per subscription); the host is read out of the
 *     field the owner filled in.
 *
 * Either way the hostname arrives from the owner's keyboard. A model suggestion
 * on its own writes nothing.
 */
async function writeNewCredential(plan: CreateWrite, body: Record<string, unknown>) {
  const { value, allowedHosts } = resolveCreateInput(plan, body);

  const meta = await upsertSecret({
    handle: plan.handle,
    label: plan.label,
    source: plan.source,
    value,
    refKey: plan.refKey,
    injection: plan.injection,
    allowedHosts,
    allowedPathPrefixes: plan.allowedPathPrefixes,
    allowedMethods: plan.allowedMethods,
    notes: plan.notes,
  });

  // Companion rows carry no value of their own — a `ref` row's value is minted
  // at call time from the vault row just written.
  for (const c of plan.companions) {
    await upsertSecret({
      handle: c.handle,
      label: `${plan.label} (token)`,
      source: c.source,
      refKey: c.refKey,
      injection: c.injection,
      allowedHosts: c.allowedHosts,
      allowedPathPrefixes: c.allowedPathPrefixes ?? [],
      allowedMethods: c.allowedMethods,
      notes: c.notes,
    });
  }

  return json({ secret: meta });
}

/** GET — registered secrets (metadata only) + the ref sources available. */
export const GET: RequestHandler = async () => {
  try {
    return json({ secrets: await listSecrets(), refSources: listRefSources() });
  } catch (err) {
    return errResponse(err);
  }
};

/**
 * POST { handle, label?, source, value?, refKey?, injection, allowedHosts,
 *        allowedPathPrefixes?, allowedMethods?, notes? }
 * Create or update. On update, omitting `value` keeps the stored one.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const denied = await requireOwner(locals);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Credential-modal paths, create and update alike. The browser sends a request
  // id, not a destination: the write was authored server-side by the chat gate
  // and parked before the form was ever shown. So the page decides WHAT VALUE
  // goes in, and nothing about where the credential may go.
  if (typeof body.requestId === 'string') {
    const create = consumePendingCreate(body.requestId);
    if (create) {
      const allowed = new Set(['requestId', 'value', 'fields', 'host']);
      const extra = Object.keys(body).filter((k) => !allowed.has(k));
      if (extra.length) {
        return json(
          { error: `a new credential accepts only ${[...allowed].join(', ')} — got unexpected ${extra.join(', ')}` },
          { status: 400 },
        );
      }
      try {
        return await writeNewCredential(create, body);
      } catch (err) {
        return errResponse(err);
      }
    }

    const allowed = new Set(['requestId', 'value', 'fields', 'confirmedHosts']);
    const extra = Object.keys(body).filter((k) => !allowed.has(k));
    if (extra.length) {
      return json(
        { error: `a credential update accepts only ${[...allowed].join(', ')} — got unexpected ${extra.join(', ')}` },
        { status: 400 },
      );
    }

    // The UPDATE path's one genuine browser contribution is `confirmedHosts` —
    // the hostnames the owner typed — and those are checked against the plan
    // rather than trusted. A host the plan never proposed cannot be added by
    // typing it, and a proposed host the owner did NOT type is dropped before
    // the write. Both directions therefore fail towards less reach.
    const plan = consumePendingUpdate(body.requestId);
    if (!plan) {
      return json(
        { error: 'that credential form has expired or was already submitted — ask jkai to try again' },
        { status: 409 },
      );
    }

    try {
      if (plan.mode === 'rebind') {
        // Every newly-reachable host needs the owner to have typed it; ones they
        // skipped are dropped rather than rejecting the proposal wholesale.
        const meta = await updateSecretBinding(
          plan.handle,
          bindingAfterConfirmation(plan, body.confirmedHosts),
        );
        return json({ secret: meta });
      }

      if (plan.mode === 'amend') {
        const raw = (body.fields ?? {}) as Record<string, unknown>;
        // Field keys come from the plan too, so the page cannot inject a key the
        // catalogue never declared into the stored credential set.
        const patch: Record<string, string> = {};
        for (const key of plan.allowedFieldKeys) {
          const v = String(raw[key] ?? '').trim();
          if (v) patch[key] = v;
        }
        if (Object.keys(patch).length === 0) {
          return json({ error: 'nothing to change — fill in at least one field' }, { status: 400 });
        }
        return json({ secret: await amendSecretValueFields(plan.handle, patch) });
      }

      if (typeof body.value !== 'string' || !body.value.trim()) {
        return json({ error: 'value is required' }, { status: 400 });
      }
      return json({ secret: await rotateSecretValue(plan.handle, body.value) });
    } catch (err) {
      return errResponse(err);
    }
  }

  // Quick-add from /admin/ai/apis. Same catalogue, same server-authored write as
  // the chat modal — the owner is typing directly into the admin page, so there
  // is no SSE round trip to park a plan against, and the provider key names the
  // spec instead. `custom` is deliberately not reachable here: it has no binding
  // of its own, and the generic form below already expresses anything it could.
  if (typeof body.provider === 'string') {
    const allowed = new Set(['provider', 'value', 'fields']);
    const extra = Object.keys(body).filter((k) => !allowed.has(k));
    if (extra.length) {
      return json(
        { error: `a catalogue credential accepts only ${[...allowed].join(', ')} — got unexpected ${extra.join(', ')}` },
        { status: 400 },
      );
    }
    const spec = CREDENTIAL_REQUEST_SPECS[body.provider];
    if (!spec) {
      return json(
        {
          error:
            `unknown provider "${body.provider}" — the quick-add form only writes catalogued providers ` +
            `(${Object.keys(CREDENTIAL_REQUEST_SPECS).join(', ')}). Use the form below for anything else.`,
        },
        { status: 400 },
      );
    }
    try {
      const { write } = buildCreatePlan({ requestId: 'admin-quick-add', spec, reason: '' });
      return await writeNewCredential(write, body);
    } catch (err) {
      return errResponse(err);
    }
  }

  try {
    const meta = await upsertSecret({
      handle: String(body.handle ?? ''),
      label: typeof body.label === 'string' ? body.label : undefined,
      source: String(body.source ?? 'vault') as SecretSource,
      value: typeof body.value === 'string' ? body.value : undefined,
      refKey: typeof body.refKey === 'string' ? body.refKey : undefined,
      injection: body.injection as SecretInjection,
      allowedHosts: Array.isArray(body.allowedHosts) ? (body.allowedHosts as string[]) : [],
      allowedPathPrefixes: Array.isArray(body.allowedPathPrefixes)
        ? (body.allowedPathPrefixes as string[])
        : [],
      allowedMethods: Array.isArray(body.allowedMethods) ? (body.allowedMethods as string[]) : [],
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });
    return json({ secret: meta });
  } catch (err) {
    return errResponse(err);
  }
};

/** DELETE ?handle=… — remove a secret. Catalogue entries referencing it then fail closed. */
export const DELETE: RequestHandler = async ({ url, locals }) => {
  const denied = await requireOwner(locals);
  if (denied) return denied;

  const handle = url.searchParams.get('handle') ?? '';
  if (!handle) return json({ error: 'handle is required' }, { status: 400 });
  try {
    const deleted = await deleteSecret(handle);
    if (!deleted) return json({ error: `no secret "${handle}"` }, { status: 404 });
    return json({ deleted: true });
  } catch (err) {
    return errResponse(err);
  }
};
