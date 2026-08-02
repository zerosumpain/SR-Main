// src/lib/workflows/site-tools/tools/update-credential.ts
//
// `update_credential` — change a credential that already exists, out of band.
//
// The sibling of `request_credential`. That tool creates; this one rotates an
// expired key, amends one field of a credential set, or changes where a
// credential may be sent. Same reason for existing: without it the model's only
// way to help with "my TrueLayer key rotated" is to ask the owner to paste the
// new one into the chat, which is exactly the 2026-08-01 leak.
//
// Why this one DOES take a handle
// -------------------------------
// `request_credential` deliberately has no handle parameter, because pairing a
// handle with a host list would let a prompt-injected model re-point an existing
// credential at a host it controls. An update cannot avoid naming its target, so
// the protection is placed differently — four layers, none of them "the model
// will behave":
//
//  1. It can only name a row that ALREADY EXISTS. There is no create path here,
//     so the model cannot conjure a row bound to its own host.
//  2. It cannot change `injection`, `source` or `refKey`. The registry's update
//     primitives have no parameter for them, so a store-only credential SET can
//     never be flipped to `bearer` and pasted into an Authorization header.
//  3. A binding change is a PROPOSAL. The server re-reads the row, computes the
//     diff, and registers the write under the request id; the browser posts a
//     request id, not a host list.
//  4. Any host the credential could not previously reach must be TYPED by the
//     owner into the form. A suggestion alone gets a prompt-injected model
//     nowhere — it needs the owner to type `evil.example` themselves.
//
// And as on the create path, the value itself never touches the model: it goes
// from the form straight to the owner-gated secrets endpoint.

import { register } from '../registry-internal';
import type { ToolDefinition, ToolExecContext, ToolResult } from '../registry-internal';
import { requestSecretFromUser } from '$lib/jkai/tool-step-bus';
import { hasSensitive } from '$lib/security/sensitive';
import { looksLikeCredential } from './request-credential';

/** Every string the model can get back. A fixed table, for the same reason as
 *  the create tool's: an error built from input is a channel, and this one sits
 *  next to a plaintext credential. */
const NOTES = {
  timeout:
    'the owner may still be fetching it — call api_secrets_list on your next turn to check whether it changed',
  unattended:
    'no browser session is attached, so no form could be shown. Ask the owner to open /jkai and try again.',
  declined: 'the owner closed the form without saving, or the change did not land as proposed',
} as const;

export async function handleUpdateCredential(
  args: Record<string, unknown>,
  ctx?: ToolExecContext,
): Promise<ToolResult> {
  // The MCP dispatcher publishes args to the tool-step SSE stream BEFORE the
  // handler runs, so a key in `reason` would be in the transcript already.
  // Refuse rather than sanitise — continuing would teach the model it works.
  //
  // `handle` is deliberately EXEMPT from the length heuristic, and only from
  // that one. `looksLikeCredential` fires on any unbroken 25-character run of
  // [A-Za-z0-9_-], which a perfectly ordinary handle reaches — `normaliseHandle`
  // permits 64 such characters, so `companies-house-production` would have been
  // rejected outright and that credential could never have been updated at all.
  // (Found by probing the deployed tool with the handle
  // `definitely-not-registered`: exactly 25 characters, refused as a secret.)
  //
  // Exempting it is safe because a handle is not secret — `api_secrets_list`
  // already returns every one of them to the model — and because it is checked
  // against the registry below, so a key smuggled in as a handle matches nothing
  // and is refused anyway. `hasSensitive` still covers it, and every other
  // argument keeps the full scan.
  const { handle: rawHandle, ...rest } = args ?? {};
  const argText = JSON.stringify(args ?? {});
  const scannable = JSON.stringify(rest);
  if (hasSensitive(argText) || looksLikeCredential(scannable)) {
    return {
      success: false,
      error:
        'that call contained something credential-shaped. Do NOT put a key, token or password in the arguments — ' +
        'this tool exists so the owner types it directly and you never see it. Call it again with only a handle, a change and a reason.',
    };
  }

  const handle = String(rawHandle ?? '').trim();
  if (!handle) {
    return { success: false, error: 'handle is required — call api_secrets_list to see which handles exist.' };
  }
  // Structural check on the exempted field: a registry handle is lower-case
  // letters, digits, dash and underscore. Anything else is not a handle, so it
  // is refused before it can be looked up.
  if (!/^[a-z0-9_-]{1,64}$/.test(handle)) {
    return {
      success: false,
      error:
        `"${handle.slice(0, 24)}…" is not a registry handle — handles are lower-case letters, digits, dash and ` +
        `underscore. Call api_secrets_list to see the real ones.`,
    };
  }

  const change = String(args.change ?? 'value');
  if (change !== 'value' && change !== 'binding') {
    return { success: false, error: 'change must be "value" or "binding".' };
  }

  const { getSecretMeta } = await import('$lib/secrets/registry');
  const meta = await getSecretMeta(handle);
  if (!meta) {
    return {
      success: false,
      error:
        `no secret registered under the handle "${handle}". This tool only changes credentials that already exist — ` +
        `use api_secrets_list to see the handles, or request_credential to add a new one.`,
    };
  }

  // A `ref` row has no value in the registry: it resolves from keys.json or an
  // env var on this host at call time. Rotating one through a form would write a
  // plaintext keys.json — a file that is gitignored AND outside the backup set —
  // so this refuses and says where the value actually lives.
  if (meta.source === 'ref' && change === 'value') {
    return {
      success: true,
      data: {
        status: 'refused',
        note:
          `"${meta.handle}" is a ref row — its value is not stored in the registry, it resolves from the ` +
          `"${meta.refKey}" source (an env var or keys.json) on this host. Rotate it where it lives; ` +
          `the binding can still be changed here.`,
      },
    };
  }

  const delta = (args.binding ?? {}) as Record<string, unknown>;
  const list = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : undefined;

  if (change === 'binding') {
    const anyChange =
      ['addHosts', 'removeHosts', 'addMethods', 'removeMethods', 'addPathPrefixes', 'removePathPrefixes'].some(
        (k) => (list(delta[k]) ?? []).length > 0,
      );
    if (!anyChange) {
      return {
        success: false,
        error:
          'change="binding" needs a `binding` object saying what to add or remove, e.g. ' +
          '{"addMethods":["POST"]} or {"addHosts":["api-v2.example.com"]}.',
      };
    }
  }

  const outcome = await requestSecretFromUser(String(ctx?.busKey ?? ''), {
    reason: String(args.reason ?? '').slice(0, 200),
    update: {
      handle: meta.handle,
      change,
      delta: {
        addHosts: list(delta.addHosts),
        removeHosts: list(delta.removeHosts),
        addMethods: list(delta.addMethods),
        removeMethods: list(delta.removeMethods),
        addPathPrefixes: list(delta.addPathPrefixes),
        removePathPrefixes: list(delta.removePathPrefixes),
      },
    },
  });

  if (outcome.status === 'stored') {
    // Re-read so the model is told what the binding ACTUALLY is now, not what
    // was proposed. The owner may have narrowed the proposal in the form.
    const after = await getSecretMeta(meta.handle);
    return {
      success: true,
      data: {
        status: 'updated',
        handle: meta.handle,
        change,
        // Binding facts only. No value, no hint, no length, no character class.
        allowedHosts: after?.allowedHosts ?? meta.allowedHosts,
        allowedMethods: after?.allowedMethods ?? meta.allowedMethods,
        allowedPathPrefixes: after?.allowedPathPrefixes ?? meta.allowedPathPrefixes,
        injection: meta.injection.kind,
        storeOnly: meta.injection.kind === 'none',
      },
    };
  }

  return { success: true, data: { status: outcome.status, note: NOTES[outcome.status] } };
}

const def: ToolDefinition = {
  name: 'update_credential',
  category: 'apis',
  toolset: 'apis',
  description:
    'Change a credential the owner has ALREADY stored: rotate an expired key, amend one field of a ' +
    'credential set (e.g. a refresh token that rolled), or change which hosts/methods/paths it may be ' +
    'used for. Opens a secure form in their browser; values go straight into the encrypted registry and ' +
    'are NEVER returned to you. NEVER ask the owner to paste a new key into the chat — that stores it in ' +
    'plaintext in the conversation and sends it to the model provider. Use api_secrets_list first to find ' +
    'the handle; use request_credential instead when no credential exists yet.',
  parameters: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description:
          'The existing registry handle to change, exactly as api_secrets_list reports it. Must already exist — ' +
          'this tool never creates a credential.',
      },
      change: {
        type: 'string',
        enum: ['value', 'binding'],
        description:
          '"value" to replace or amend what is stored (the usual case — a key expired or rotated). ' +
          '"binding" to change where the credential may be sent.',
      },
      reason: {
        type: 'string',
        description:
          'One sentence shown to the owner explaining why, e.g. "the TrueLayer refresh token expired". ' +
          'Never put a credential value in here.',
      },
      binding: {
        type: 'object',
        description:
          'Only when change="binding". A DELTA against the current binding, shown to the owner as a ' +
          'before/after diff. Adding a host the credential cannot currently reach requires the owner to ' +
          'type that hostname themselves, so propose one only when you are sure it is the vendor\'s.',
        properties: {
          addHosts: { type: 'array', items: { type: 'string' }, description: 'Hostnames to allow, e.g. ["api-v2.example.com"]. Widens access.' },
          removeHosts: { type: 'array', items: { type: 'string' }, description: 'Hostnames to stop allowing.' },
          addMethods: { type: 'array', items: { type: 'string' }, description: 'HTTP methods to allow, e.g. ["POST"]. Widens access.' },
          removeMethods: { type: 'array', items: { type: 'string' }, description: 'HTTP methods to stop allowing.' },
          addPathPrefixes: { type: 'array', items: { type: 'string' }, description: 'Path prefixes to scope to, e.g. ["/v1/reporting"].' },
          removePathPrefixes: { type: 'array', items: { type: 'string' }, description: 'Path prefixes to stop scoping to.' },
        },
      },
    },
    required: ['handle', 'change', 'reason'],
  },
  // NOT destructive, for the same reason as request_credential: the MCP
  // destructive gate blocks up to 240s on its own banner BEFORE the handler
  // runs, and stacking that in front of the 180s form wait would exceed Hermes'
  // 300s read timeout and strand the turn before the form appeared. The modal IS
  // the human gate — it shows the before/after and requires an explicit save.
  destructive: false,
  handler: handleUpdateCredential,
};

register(def);

export default def;
