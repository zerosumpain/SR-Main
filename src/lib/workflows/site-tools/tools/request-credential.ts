// src/lib/workflows/site-tools/tools/request-credential.ts
//
// `request_credential` — ask the owner for a credential, out of band.
//
// The model calls this INSTEAD of asking the owner to paste a key into the
// chat. A form opens in the owner's browser; the value goes straight from there
// to the owner-gated secrets endpoint and into `api_secrets` encrypted at rest.
// The model gets back a status and a handle. It never sees the value, and there
// is no read-back path anywhere in the registry.
//
// Why this tool has almost no parameters
// --------------------------------------
// `upsertSecret` is an UPSERT that rewrites `allowedHosts` unconditionally while
// the value stays optional. A tool that let the model choose a handle plus a
// host list could therefore re-point an EXISTING credential at a host the model
// controls, then read it back with an ordinary `api_call`. So the tool takes a
// PROVIDER KEY validated against a code table, and every binding decision comes
// from $lib/secrets/credential-requests. There is no handle, source, injection
// or allowedHosts parameter to abuse.

import { register } from '../registry-internal';
import type { ToolDefinition, ToolExecContext, ToolResult } from '../registry-internal';
import {
  CREDENTIAL_REQUEST_SPECS,
  credentialProviderKeys,
  customSpec,
  type CredentialRequestSpec,
} from '$lib/secrets/credential-requests';
import { requestSecretFromUser } from '$lib/jkai/tool-step-bus';
import { hasSensitive } from '$lib/security/sensitive';

/**
 * Every string the model can ever get back. Deliberately a fixed table: an
 * error built from user input is a channel, and this tool sits next to a
 * plaintext credential.
 */
const NOTES = {
  timeout:
    'the owner may still be fetching it — call api_secrets_list on your next turn to check whether it arrived',
  unattended:
    'no browser session is attached, so no form could be shown. Ask the owner to open /jkai and try again.',
  declined: 'the owner closed the form without saving',
} as const;

export function specForRequest(args: Record<string, unknown>): CredentialRequestSpec | null {
  const provider = String(args.provider ?? '').trim();
  if (provider === 'custom') {
    const c = (args.custom ?? {}) as Record<string, unknown>;
    return customSpec({
      label: c.label ? String(c.label) : undefined,
      suggestedHost: c.suggestedHost ? String(c.suggestedHost) : undefined,
      suggestedHandle: c.suggestedHandle ? String(c.suggestedHandle) : undefined,
    });
  }
  return CREDENTIAL_REQUEST_SPECS[provider] ?? null;
}

/**
 * A credential-shaped run of characters.
 *
 * `hasSensitive` only knows vendor prefixes (sk-, ghp_, AIza…) — it would NOT
 * have caught the TrueLayer `tlcs_live_…` secret that caused the 2026-08-01
 * incident, which is exactly the case this tool exists for. That list is too
 * narrow to widen safely site-wide (false positives on ordinary prose), but
 * here the legitimate argument surface is tiny: a provider key from a fixed
 * enum, a one-sentence reason, and a short label/host/handle. An unbroken
 * 25-character token in any of those is not something a correct call contains.
 */
export function looksLikeCredential(text: string): boolean {
  return /[A-Za-z0-9_\-]{25,}/.test(text);
}

export async function handleRequestCredential(
  args: Record<string, unknown>,
  ctx?: ToolExecContext,
): Promise<ToolResult> {
  // The args are published to the tool-step SSE stream by the MCP dispatcher
  // BEFORE the handler runs, so a model that put a key in `reason` would leak it
  // to the transcript. Refuse rather than sanitise: a model doing this has
  // misunderstood the tool, and continuing would teach it the pattern works.
  const argText = JSON.stringify(args ?? {});
  if (hasSensitive(argText) || looksLikeCredential(argText)) {
    return {
      success: false,
      error:
        'that call contained something credential-shaped. Do NOT put a key, token or password in the arguments — ' +
        'this tool exists so the owner types it directly and you never see it. Call it again with only a provider and a reason.',
    };
  }

  const spec = specForRequest(args);
  if (!spec) {
    return {
      success: false,
      error: `unknown provider "${String(args.provider ?? '')}". Use one of: ${credentialProviderKeys().join(', ')}.`,
    };
  }

  // CREATE ONLY. `upsertSecret` writes the whole row, so letting this path run
  // against an existing handle silently rewrites that credential's allowedHosts,
  // methods and injection from the spec — and on the `custom` path the spec is
  // built from a MODEL-SUGGESTED host. That is the re-pointing attack this
  // file's header describes, reachable by nothing more than suggesting a handle
  // that sanitises onto one already in the registry.
  //
  // So an existing handle is refused here and sent to `update_credential`, where
  // a binding change is a reviewed diff and a newly-reachable host has to be
  // typed by the owner.
  const { getSecretMeta } = await import('$lib/secrets/registry');
  const clash = await getSecretMeta(spec.binding.handle);
  if (clash) {
    return {
      success: false,
      error:
        `a credential is already registered under the handle "${clash.handle}" and this tool only creates new ones. ` +
        `To rotate its value or change what it may reach, call update_credential with handle="${clash.handle}". ` +
        `To store a DIFFERENT credential, suggest a handle that is not already taken.`,
    };
  }

  const reason = String(args.reason ?? '').slice(0, 200);
  const outcome = await requestSecretFromUser(String(ctx?.busKey ?? ''), {
    provider: spec.provider,
    reason,
    custom: spec.provider === 'custom' ? (args.custom as never) : undefined,
  });

  if (outcome.status === 'stored') {
    return {
      success: true,
      data: {
        status: 'stored',
        handle: outcome.handle ?? spec.binding.handle,
        // Binding facts, so the model knows what it may now do. No value, no
        // hint, no length, no character class.
        allowedHosts: spec.binding.allowedHosts,
        injection: spec.binding.injection.kind,
        storeOnly: spec.binding.injection.kind === 'none',
        companions: (spec.companions ?? []).map((c) => c.handle),
      },
    };
  }

  return { success: true, data: { status: outcome.status, note: NOTES[outcome.status] } };
}

const def: ToolDefinition = {
  name: 'request_credential',
  category: 'apis',
  toolset: 'apis',
  description:
    'Ask the owner for a credential you need (an API key, client secret, or OAuth credential set). ' +
    'Opens a secure form in their browser; the value goes straight into the encrypted secret registry ' +
    'and is NEVER returned to you — you get back only a handle to reference. ' +
    'NEVER ask the owner to paste a key, token or password into the chat: that stores it in plaintext ' +
    'in the conversation and sends it to the model provider. Use this instead, every time.',
  parameters: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        enum: credentialProviderKeys(),
        description:
          'Which credential. Use a known provider where one fits; "custom" for anything else, ' +
          'with the `custom` object filled in.',
      },
      reason: {
        type: 'string',
        description:
          'One sentence shown to the owner explaining why you need it, e.g. "to read your bank balance". ' +
          'Never put a credential value in here.',
      },
      custom: {
        type: 'object',
        description: 'Only when provider="custom". These are SUGGESTIONS the owner reviews before saving.',
        properties: {
          label: { type: 'string', description: 'Human name for the service, e.g. "Companies House"' },
          suggestedHost: { type: 'string', description: 'API hostname the key is for, e.g. api.company-information.service.gov.uk' },
          suggestedHandle: { type: 'string', description: 'Short handle, e.g. companies-house' },
        },
      },
    },
    required: ['provider', 'reason'],
  },
  // NOT destructive. The MCP destructive gate blocks up to 240s on its own
  // confirm banner BEFORE the handler runs; stacking that in front of a 180s
  // form wait would exceed Hermes' 300s read timeout and strand the turn before
  // the form ever appeared. The modal IS the human gate — it shows the
  // destination and binding and requires an explicit save.
  destructive: false,
  handler: handleRequestCredential,
};

register(def);

export default def;
