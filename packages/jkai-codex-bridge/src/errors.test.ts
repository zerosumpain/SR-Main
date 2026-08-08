import { describe, it, expect } from 'vitest';
import { extractUpstreamValidationError } from './server';

describe('extractUpstreamValidationError', () => {
  it('pulls out a caller-fixable upstream rejection', () => {
    // Real shape seen when reasoning_effort "minimal" hits the GPT-5.6 line.
    const raw =
      'Codex Exec exited with code 1: {\n "type": "error",\n "error": {\n "type": "invalid_request_error",\n "code": "unsupported_value",\n "message": "Unsupported value: \'minimal\' is not supported."\n }\n}';
    expect(extractUpstreamValidationError(raw)).toMatch(/Unsupported value/);
  });

  it('returns null for a genuine transport failure', () => {
    // A bridge/process problem is ours, not the caller's — it must stay a 502
    // so it is not misreported as a bad request.
    expect(extractUpstreamValidationError('spawn ENOENT')).toBeNull();
    expect(extractUpstreamValidationError('Codex Exec exited with code 1: Reading prompt from stdin...')).toBeNull();
  });

  it('ignores non-validation errors that happen to be JSON', () => {
    expect(
      extractUpstreamValidationError('{"error":{"type":"server_error","message":"upstream boom"}}'),
    ).toBeNull();
  });
});
