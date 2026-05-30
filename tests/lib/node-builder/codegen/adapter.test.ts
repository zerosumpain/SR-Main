import { describe, it, expect } from 'vitest';
import { emitAdapter, adapterFileName } from '$lib/node-builder/codegen/adapter';
import { appleCalendarSpec } from '../../../__fixtures__/node-builder-codegen/apple-calendar.spec';
import type { NodeSpec } from '$lib/node-builder/spec/types';

describe('emitAdapter', () => {
  it('returns null when spec has no integrationType', () => {
    const noIntegration: NodeSpec = { ...appleCalendarSpec, integrationType: undefined };
    expect(emitAdapter(noIntegration)).toBeNull();
  });

  it('emits a registerIntegrationAdapter call with the correct integrationType', () => {
    const out = emitAdapter(appleCalendarSpec)!;
    expect(out).toContain("registerIntegrationAdapter({");
    expect(out).toContain('integrationType: "apple-calendar",');
    expect(out).toContain("from '$lib/integrations/registry'");
  });

  it('emits a resolveOptions switch with one case per optionsResolvers entry', () => {
    const out = emitAdapter(appleCalendarSpec)!;
    expect(out).toContain('resolveOptions: async (fieldName: string, credentialId: string) =>');
    expect(out).toContain('case "calendar":');
    expect(out).toContain('client.fetchCalendars');
    expect(out).toContain('default:');
  });

  it('emits testCredential when testCredentialBody is set', () => {
    const out = emitAdapter(appleCalendarSpec)!;
    expect(out).toContain('testCredential: async (credentialId: string) =>');
    expect(out).toContain('Credential not found');
  });

  it('omits resolveOptions when optionsResolvers is empty', () => {
    const noResolvers: NodeSpec = { ...appleCalendarSpec, optionsResolvers: [] };
    const out = emitAdapter(noResolvers)!;
    expect(out).not.toContain('resolveOptions:');
  });

  it('omits testCredential when testCredentialBody is unset', () => {
    const noTest: NodeSpec = { ...appleCalendarSpec, testCredentialBody: undefined };
    const out = emitAdapter(noTest)!;
    expect(out).not.toContain('testCredential:');
  });

  it('emits oauthSpec when set', () => {
    const oauth: NodeSpec = {
      ...appleCalendarSpec,
      integrationType: 'gmail',
      optionsResolvers: [],
      testCredentialBody: undefined,
      oauthSpec: {
        authorizationUrl: 'https://accounts.google.com/o/oauth2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        defaultScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        clientIdEnvVar: 'GMAIL_CLIENT_ID',
        clientSecretEnvVar: 'GMAIL_CLIENT_SECRET',
      },
    };
    const out = emitAdapter(oauth)!;
    expect(out).toContain('oauthSpec: {');
    expect(out).toContain('authorizationUrl: "https://accounts.google.com/o/oauth2/auth"');
    expect(out).toContain('clientIdEnvVar: "GMAIL_CLIENT_ID"');
  });
});

describe('adapterFileName', () => {
  it('returns <type>.ts for clean identifiers', () => {
    expect(adapterFileName('apple-calendar')).toBe('apple-calendar.ts');
    expect(adapterFileName('slack')).toBe('slack.ts');
    expect(adapterFileName('icloud_cal')).toBe('icloud_cal.ts');
  });

  it('replaces unsafe characters with dashes', () => {
    expect(adapterFileName('foo/bar')).toBe('foo-bar.ts');
    expect(adapterFileName('foo bar')).toBe('foo-bar.ts');
  });
});
