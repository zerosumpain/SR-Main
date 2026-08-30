import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  piInvocation,
  piThinkingLevel,
  pinCodexTransport,
  buildToolAllowlist,
  BASE_PI_TOOLS,
  PI_PACKAGE,
  PI_VERSION,
  assertPiVersion,
  readVersionFrom,
} from './pi-runner';

// pi's --tools is an allowlist applied to extension-registered tools as well
// as built-ins, so the fixed list stripped all 167 bridged site tools before
// the model saw one — while the executor logged "Tool bridge OK".
describe('buildToolAllowlist', () => {
  it('always includes every built-in the agent depends on', () => {
    const out = buildToolAllowlist([]).split(',');
    for (const t of BASE_PI_TOOLS) expect(out).toContain(t);
  });

  it('adds the bridged tool names so they survive the allowlist', () => {
    const out = buildToolAllowlist(['workflow_list', 'datastore_query']).split(',');
    expect(out).toContain('workflow_list');
    expect(out).toContain('datastore_query');
    expect(out).toContain('bash');
  });

  // A failing bridge must never widen what the agent can reach.
  it.each([[undefined], [[]]])('yields exactly the built-ins for %o', (names) => {
    expect(buildToolAllowlist(names as string[] | undefined).split(',').sort()).toEqual(
      [...BASE_PI_TOOLS].sort(),
    );
  });

  it('drops names that would corrupt the comma-separated list', () => {
    const out = buildToolAllowlist(['good_tool', 'bad,name', 'bad name', '']).split(',');
    expect(out).toContain('good_tool');
    expect(out).not.toContain('bad,name');
    expect(out).not.toContain('bad name');
    expect(out.every((n) => n.length > 0)).toBe(true);
  });

  // The value lands in a shell command line, and `custom_tools` names are
  // LLM-authored and unvalidated at the insert. Allow-list the charset.
  it('drops names carrying shell metacharacters', () => {
    const hostile = [
      "x'; rm -rf /; echo '",
      'x`whoami`',
      'x$(id)',
      'x;ls',
      'x|ls',
      'x&ls',
      'x>out',
      'x"y',
    ];
    const out = buildToolAllowlist(['good_tool', ...hostile]).split(',');
    expect(out).toContain('good_tool');
    for (const h of hostile) expect(out).not.toContain(h);
    expect(out.every((n) => /^[A-Za-z0-9_.-]+$/.test(n))).toBe(true);
  });

  it('keeps the legitimate punctuation real tool names use', () => {
    const out = buildToolAllowlist(['ha.find', 'gmail-search', 'datastore_query']).split(',');
    expect(out).toEqual(expect.arrayContaining(['ha.find', 'gmail-search', 'datastore_query']));
  });

  it('does not repeat a bridged tool that shadows a built-in', () => {
    const out = buildToolAllowlist(['bash', 'read']).split(',');
    expect(out.filter((n) => n === 'bash')).toHaveLength(1);
  });
});

// A build row stores OUR provider names. Pi has its own registry and knows
// none of them: handing it `--provider codex` killed every Codex build on
// startup with `Unknown provider "codex"`.

describe('piInvocation', () => {
  it('sends a Codex build to pi native openai-codex, on the bare slug', () => {
    expect(piInvocation({ provider: 'codex', modelId: 'codex/gpt-5.6-terra' })).toEqual({
      provider: 'openai-codex',
      modelId: 'gpt-5.6-terra',
      apiKeyEnv: null,
    });
  });

  it('recovers Codex from the id alone when the row has no provider', () => {
    // Persisted state carries bare model strings in plenty of places; the
    // `codex/` prefix is the single decider, per coerceModelContext.
    expect(piInvocation({ modelId: 'codex/gpt-5.6-luna' }).provider).toBe('openai-codex');
    expect(piInvocation({ provider: null, modelId: 'codex/gpt-5.5' }).modelId).toBe('gpt-5.5');
  });

  it('asks for no API key on the Codex route — pi holds its own OAuth', () => {
    expect(piInvocation({ provider: 'codex', modelId: 'codex/gpt-5.6-sol' }).apiKeyEnv).toBeNull();
  });

  it('leaves an OpenRouter build alone', () => {
    expect(piInvocation({ provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash' })).toEqual({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
      apiKeyEnv: 'OPENROUTER_API_KEY',
    });
  });

  it('runs a legacy zai row on OpenRouter, with the remapped slug', () => {
    // These rows predate the z.ai decommission. They get the OpenRouter key, so
    // they must also get the OpenRouter provider name and a z-ai/* slug —
    // `--provider zai` plus an OpenRouter key is a credential mismatch.
    expect(piInvocation({ provider: 'zai', modelId: 'glm-5.2' })).toEqual({
      provider: 'openrouter',
      modelId: 'z-ai/glm-5.2',
      apiKeyEnv: 'OPENROUTER_API_KEY',
    });
  });
});

describe('pinCodexTransport', () => {
  const workspace = async (withGit: boolean) => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-runner-test-'));
    if (withGit) {
      await mkdir(join(dir, '.git', 'info'), { recursive: true });
      await writeFile(join(dir, '.git', 'info', 'exclude'), '# git ls-files --others\nnode_modules/');
    }
    return dir;
  };

  it('pins the transport pi hangs without', async () => {
    const dir = await workspace(false);
    await pinCodexTransport(dir);
    expect(JSON.parse(await readFile(join(dir, '.pi', 'settings.json'), 'utf8'))).toEqual({
      transport: 'sse',
    });
  });

  it('keeps itself out of the build diff', async () => {
    const dir = await workspace(true);
    await pinCodexTransport(dir);
    const exclude = await readFile(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toMatch(/^\.pi\/$/m);
    // The file it appended to had no trailing newline — the entry must still
    // land on its own line rather than glued to `node_modules/`.
    expect(exclude).not.toMatch(/node_modules\/\.pi/);
  });

  it('is idempotent across iterations of the same build', async () => {
    const dir = await workspace(true);
    await pinCodexTransport(dir);
    await pinCodexTransport(dir);
    const exclude = await readFile(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.match(/^\.pi\/$/gm)).toHaveLength(1);
  });

  it('still writes the settings when there is no git repo to exclude from', async () => {
    const dir = await workspace(false);
    await expect(pinCodexTransport(dir)).resolves.toBeUndefined();
    expect(await readFile(join(dir, '.pi', 'settings.json'), 'utf8')).toContain('sse');
  });
});

describe('piThinkingLevel', () => {
  it('lifts minimal to low on Codex — the 5.6 line rejects minimal', () => {
    expect(piThinkingLevel('openai-codex', 'minimal')).toBe('low');
  });

  it('passes every other level through, on both providers', () => {
    for (const level of ['off', 'low', 'medium', 'high', 'xhigh', undefined]) {
      expect(piThinkingLevel('openai-codex', level)).toBe(level);
      expect(piThinkingLevel('openrouter', level)).toBe(level);
    }
    expect(piThinkingLevel('openrouter', 'minimal')).toBe('minimal');
  });
});

// The pin only works if every consumer agrees on one number. package.json is
// canonical (the Dockerfile and the host install read it without a TS
// toolchain); this is the guard that the runner's literal copy tracks it.
describe('PI_VERSION pin', () => {
  it('matches jkai.piVersion in package.json', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    );
    expect(pkg.jkai?.piVersion).toBe(PI_VERSION);
  });

  it('is a bare semver, so the Dockerfile can interpolate it into an npm spec', () => {
    expect(PI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

/*
 * The pin records a version. It did not record WHICH PACKAGE that version was
 * of, and that gap cost sixteen weeks.
 *
 * pi was renamed from `@mariozechner/pi-coding-agent` to
 * `@earendil-works/pi-coding-agent`, and the old name's `latest` dist-tag froze
 * at 0.73.1 — our exact pin. `npm view @mariozechner/pi-coding-agent version`
 * therefore answered "0.73.1" the whole time, which reads as "up to date",
 * while upstream shipped eleven minors somewhere else. An abandoned package
 * does not report itself as abandoned; it just stops moving, and stopped is
 * indistinguishable from current unless you ask something other than npm.
 *
 * So the name is pinned too, with the same guard, and
 * `scripts/check-pi-version.mjs` corroborates it against the upstream repo.
 */
describe('PI_PACKAGE pin', () => {
  it('matches jkai.piPackage in package.json', async () => {
    const pkg = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    );
    expect(pkg.jkai?.piPackage).toBe(PI_PACKAGE);
  });

  it('is a bare npm spec with no version, so the install sites can append @<pin>', () => {
    // A `name@version` here would produce `pkg@1.2.3@0.73.1` at every call site.
    expect(PI_PACKAGE).toMatch(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/);
  });

  it('names an upstream repo for the drift check to corroborate against', async () => {
    // npm alone cannot see a rename. The repo can, because the GitHub API
    // answers a moved repo with a redirect to its new name.
    const pkg = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    );
    expect(pkg.jkai?.piUpstreamRepo).toMatch(/^[\w.-]+\/[\w.-]+$/);
  });
});

describe('assertPiVersion', () => {
  it('passes when the installed version is the pin', () => {
    expect(assertPiVersion(PI_VERSION)).toBeNull();
  });

  // An unreadable probe has its own, better diagnosis later in the run
  // (pi missing, docker down). Reporting it as a mismatch would be a lie.
  it('passes when the probe could not read a version', () => {
    expect(assertPiVersion(null)).toBeNull();
  });

  // Derived from PI_VERSION, never hardcoded: a literal "wrong" version
  // silently becomes a passing no-op the day the pin moves onto it. That is
  // exactly what happened moving the pin to 0.73.1.
  it('fails a mismatch, naming both versions so the fix is one line', () => {
    const [maj, min, patch] = PI_VERSION.split('.').map(Number);
    const other = `${maj}.${min}.${patch + 1}`;
    expect(other).not.toBe(PI_VERSION);
    const f = assertPiVersion(other);
    expect(f).not.toBeNull();
    expect(f!.kind).toBe('tooling_unavailable');
    expect(f!.message).toContain(other);
    expect(f!.message).toContain(PI_VERSION);
  });
});

// `pi --version` writes to STDERR. A stdout-only probe returns null for a
// healthy pi, and because a null probe is deliberately not a mismatch, the
// version gate would never fire — enforced-looking and decorative. Caught for
// real when deploy-builder.sh reported `pi is  after install`.
describe('readVersionFrom', () => {
  it('reads a version printed to stderr', async () => {
    await expect(
      readVersionFrom(process.execPath, ['-e', "console.error('0.72.1')"]),
    ).resolves.toBe('0.72.1');
  });

  it('reads a version printed to stdout', async () => {
    await expect(
      readVersionFrom(process.execPath, ['-e', "console.log('0.73.1')"]),
    ).resolves.toBe('0.73.1');
  });

  it('tolerates a prefix around the semver', async () => {
    await expect(
      readVersionFrom(process.execPath, ['-e', "console.error('pi version 1.2.3 (build x)')"]),
    ).resolves.toBe('1.2.3');
  });

  it('is null when the command is missing, so a broken probe never reads as a mismatch', async () => {
    await expect(readVersionFrom('definitely-not-a-real-binary-xyz', [])).resolves.toBeNull();
  });

  it('is null on a non-zero exit even if the output contains a number', async () => {
    await expect(
      readVersionFrom(process.execPath, ['-e', "console.error('9.9.9'); process.exit(1)"]),
    ).resolves.toBeNull();
  });
});
