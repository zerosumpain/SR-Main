import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';
import { modelServiceAppFor, modelServiceTokenVar } from './model-service-auth';
import { MODEL_SERVICE_APPS } from '$lib/llm/model-service-contract';

const mutableEnv = env as Record<string, string | undefined>;
const vars = MODEL_SERVICE_APPS.map(modelServiceTokenVar);
const original = Object.fromEntries(vars.map((v) => [v, env[v]]));

const DRIVE = 'd'.repeat(40);
const POLICY = 'p'.repeat(40);

function req(token?: string): Request {
  return new Request('https://example.test/api/platform/models/config', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  for (const v of vars) delete mutableEnv[v];
});
afterAll(() => {
  for (const v of vars) {
    if (original[v] === undefined) delete mutableEnv[v];
    else mutableEnv[v] = original[v];
  }
});

describe('model service credentials', () => {
  it('names one variable per application', () => {
    expect(modelServiceTokenVar('data-standard-designer')).toBe('MODEL_SERVICE_TOKEN_DATA_STANDARD_DESIGNER');
    expect(vars).toEqual([
      'MODEL_SERVICE_TOKEN_DRIVE',
      'MODEL_SERVICE_TOKEN_HEALTH',
      'MODEL_SERVICE_TOKEN_POLICY_ENGINE',
      'MODEL_SERVICE_TOKEN_DFE_DATA_STRATEGY',
      'MODEL_SERVICE_TOKEN_DATA_STANDARD_DESIGNER',
    ]);
  });

  it('fails closed when nothing is configured', () => {
    expect(modelServiceAppFor(req(DRIVE))).toBeNull();
    expect(modelServiceAppFor(req(''))).toBeNull();
    expect(modelServiceAppFor(req())).toBeNull();
  });

  it('treats a short configured value as no credential at all', () => {
    mutableEnv.MODEL_SERVICE_TOKEN_DRIVE = 'short';
    expect(modelServiceAppFor(req('short'))).toBeNull();
  });

  it('attributes the caller by its own token', () => {
    mutableEnv.MODEL_SERVICE_TOKEN_DRIVE = DRIVE;
    mutableEnv.MODEL_SERVICE_TOKEN_POLICY_ENGINE = POLICY;
    expect(modelServiceAppFor(req(DRIVE))).toBe('drive');
    expect(modelServiceAppFor(req(POLICY))).toBe('policy-engine');
    expect(modelServiceAppFor(req('x'.repeat(40)))).toBeNull();
    expect(modelServiceAppFor(req(DRIVE.slice(0, -1) + 'e'))).toBeNull();
  });

  it('requires the Bearer scheme', () => {
    mutableEnv.MODEL_SERVICE_TOKEN_DRIVE = DRIVE;
    const r = new Request('https://example.test/', { headers: { authorization: DRIVE } });
    expect(modelServiceAppFor(r)).toBeNull();
  });

  it('refuses a token two applications share, rather than guess whose spend it is', () => {
    mutableEnv.MODEL_SERVICE_TOKEN_DRIVE = DRIVE;
    mutableEnv.MODEL_SERVICE_TOKEN_HEALTH = DRIVE;
    expect(modelServiceAppFor(req(DRIVE))).toBeNull();
  });

  it('does not accept other lanes’ credentials', () => {
    mutableEnv.JKAI_INVOKE_TOKEN = 'j'.repeat(40);
    expect(modelServiceAppFor(req('j'.repeat(40)))).toBeNull();
    delete mutableEnv.JKAI_INVOKE_TOKEN;
  });
});
