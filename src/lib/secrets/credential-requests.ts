// src/lib/secrets/credential-requests.ts
//
// The catalogue of credentials jkai is allowed to ASK the owner for.
//
// THIS FILE IS THE SECURITY BOUNDARY. Everything that determines where a
// credential ends up and where it may be sent — the handle, the source, the
// injection, the allowed hosts, methods and path prefixes — is declared here in
// code. None of it is ever taken from model arguments.
//
// The reason is specific rather than theoretical. `upsertSecret` is an UPSERT
// that rewrites `allowedHosts` unconditionally while the value is optional, so a
// model that could choose a handle plus a host list could re-point an EXISTING
// credential at a host it controls and then read it back through an ordinary
// `api_call`. The `request_credential` tool therefore has no handle, source,
// host or injection parameter at all; it names a provider from this table, and
// the modal shows the owner what the binding will be before anything is written.
//
// Background: on 2026-08-01 the owner pasted a TrueLayer client_secret and a
// PayPal client_secret straight into jkai chat because there was no other way to
// hand them over. They ended up in ten places including an LLM provider. This
// table plus the modal is the supported alternative.

import type { SecretInjection } from './registry';
import { OAUTH_PROVIDERS } from './oauth-refresh';

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  required: boolean;
  placeholder?: string;
  /** Shown under the input. Plain guidance, never model-authored. */
  help?: string;
}

/** One row that will be written to `api_secrets`. */
export interface CredentialBinding {
  handle: string;
  source: 'vault' | 'ref';
  refKey?: string;
  injection: SecretInjection;
  allowedHosts: string[];
  allowedMethods: string[];
  allowedPathPrefixes?: string[];
  notes?: string;
}

export interface CredentialRequestSpec {
  provider: string;
  title: string;
  /** Where the owner goes to find these values. */
  helpUrl?: string;
  fields: CredentialField[];
  /**
   * 'single' — one field, stored as the raw value.
   * 'json'   — several fields, stored as one JSON object. This is what makes
   *            "capture whatever data is required" work, and it is exactly the
   *            shape `oauth-refresh.ts` reads back (`StoredOAuthCredential`).
   */
  assemble: 'single' | 'json';
  /** The row that holds the value the owner types. */
  binding: CredentialBinding;
  /**
   * Extra rows created alongside — e.g. the `ref` row a canvas node references,
   * whose value is minted from the vault row rather than stored.
   */
  companions?: CredentialBinding[];
}

const tl = OAUTH_PROVIDERS.truelayer;
const pp = OAUTH_PROVIDERS.paypal;

export const CREDENTIAL_REQUEST_SPECS: Record<string, CredentialRequestSpec> = {
  truelayer: {
    provider: 'truelayer',
    title: 'TrueLayer (open banking)',
    helpUrl: 'https://console.truelayer.com/',
    assemble: 'json',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true, placeholder: 'yourapp-1a2b3c' },
      { key: 'client_secret', label: 'Client secret', type: 'password', required: true },
      {
        key: 'refresh_token',
        label: 'Refresh token',
        type: 'password',
        required: true,
        help: 'Rotates on every refresh — jkai writes the new one back automatically, so you only enter this once.',
      },
    ],
    binding: {
      handle: tl.vaultHandle,
      source: 'vault',
      injection: { kind: 'none' },
      allowedHosts: [tl.tokenHost],
      allowedMethods: ['POST'],
      notes: 'Credential set read only by $lib/secrets/oauth-refresh to mint access tokens.',
    },
    companions: [
      {
        handle: 'truelayer',
        source: 'ref',
        refKey: 'truelayer',
        injection: { kind: 'bearer' },
        allowedHosts: [tl.dataHost],
        allowedMethods: ['GET', 'HEAD'],
        allowedPathPrefixes: ['/data/v1'],
        notes: 'Access token minted per request from the truelayer-oauth credential set.',
      },
    ],
  },

  paypal: {
    provider: 'paypal',
    title: 'PayPal',
    helpUrl: 'https://developer.paypal.com/dashboard/applications/live',
    assemble: 'json',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true },
      { key: 'client_secret', label: 'Secret key', type: 'password', required: true },
    ],
    binding: {
      handle: pp.vaultHandle,
      source: 'vault',
      injection: { kind: 'none' },
      allowedHosts: [pp.tokenHost],
      allowedMethods: ['POST'],
      notes: 'Credential set read only by $lib/secrets/oauth-refresh to mint access tokens.',
    },
    companions: [
      {
        handle: 'paypal',
        source: 'ref',
        refKey: 'paypal',
        injection: { kind: 'bearer' },
        allowedHosts: [pp.dataHost],
        allowedMethods: ['GET', 'HEAD'],
        allowedPathPrefixes: ['/v1/reporting', '/v1/billing'],
        notes: 'Access token minted per request from the paypal-oauth credential set.',
      },
    ],
  },
};

/**
 * The shape used when the model asks for a credential this table doesn't know.
 *
 * The model supplies a label and a SUGGESTED host and handle; the modal renders
 * them as an unaccepted proposal the owner must look at, because a suggested
 * host is the one thing here a prompt-injected model could use to point a key
 * somewhere it controls. Defaults are the tightest that still work: a single
 * bearer value, GET+HEAD only.
 */
export function customSpec(input: {
  label?: string;
  suggestedHost?: string;
  suggestedHandle?: string;
}): CredentialRequestSpec {
  const handle = String(input.suggestedHandle ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48);
  return {
    provider: 'custom',
    title: String(input.label ?? 'API credential').slice(0, 80),
    assemble: 'single',
    fields: [{ key: 'value', label: 'API key / token', type: 'password', required: true }],
    binding: {
      handle: handle || 'new-credential',
      source: 'vault',
      injection: { kind: 'bearer' },
      allowedHosts: [String(input.suggestedHost ?? '').trim()].filter(Boolean),
      allowedMethods: ['GET', 'HEAD'],
    },
  };
}

/**
 * The `secret_request` SSE payload, as the browser receives it. Every field is
 * derived server-side from a spec above — the model contributes only the
 * provider key (validated) and `reason`. There is deliberately no field here
 * capable of carrying a credential value.
 */
export interface SecretRequestEvent {
  requestId: string;
  provider: string;
  title: string;
  reason: string;
  helpUrl?: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    help?: string;
  }>;
  destination: { handle: string; store: string; hosts: string[]; methods: string[]; storeOnly: boolean };
  companions: Array<{ handle: string; hosts: string[]; methods: string[] }>;
  assemble: 'single' | 'json';
}

/** Provider keys the tool's enum offers, plus `custom`. */
export function credentialProviderKeys(): string[] {
  return [...Object.keys(CREDENTIAL_REQUEST_SPECS), 'custom'];
}
