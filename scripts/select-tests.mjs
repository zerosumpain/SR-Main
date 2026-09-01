#!/usr/bin/env node
/**
 * Select the test files a change set can actually reach.
 *
 * Used at gate level L2 to run a subset of the suite instead of all 466 files.
 * The test phase is import-bound — 146s of its 244s is module loading — so the
 * cost is very nearly linear in the number of files, which is what makes this
 * worth doing at all.
 *
 * ── Why not the obvious tools ────────────────────────────────────────────────
 *
 * `vitest --changed` is disqualified: it forces passWithNoTests to true and its
 * git integration swallows errors, so an unresolvable base ref yields a GREEN
 * run that executed nothing. `vitest related` only exists as a subcommand that
 * RUNS the tests, so a selection cannot be inspected or asserted on before it is
 * trusted. Both were verified against the installed version.
 *
 * ── The coupling channel a naive import graph misses ─────────────────────────
 *
 * 127 test files here call `vi.mock('<specifier>')`, across 104 distinct
 * specifiers, and vitest's own resolver DROPS mocked modules from the dependency
 * graph. A test that mocks $lib/db without importing it is invisible to any
 * graph built from imports alone — and 75 files mock exactly that. So a
 * `vi.mock()` call is treated here as a first-class edge. That single addition
 * is what makes this trustworthy rather than merely plausible.
 *
 * ── Failing closed ───────────────────────────────────────────────────────────
 *
 * Every uncertainty resolves to "run everything", never "run less":
 *   - a changed path outside the known source universe          -> full
 *   - a repo-local specifier ($lib/… or relative) that does not
 *     resolve to a file on disk                                 -> full
 *   - an empty selection                                        -> full
 *   - any thrown error at all                                   -> full
 * Specifiers are extracted by regex rather than parsed. That over-matches
 * (strings and comments look like imports), which selects MORE tests — the safe
 * direction to be wrong in.
 *
 * Output is a single `mode=` line followed by one path per line. The caller must
 * read `mode`, never the exit status; this exits 0 whenever it produced a usable
 * answer, including when that answer is "run everything".
 *
 * Usage:
 *   node scripts/select-tests.mjs [BASE_REF]        # defaults to origin/master
 *   SELECT_TESTS_FILES=$'a\nb' node scripts/select-tests.mjs   # injected, for tests
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOTS = ['src', 'tests', 'packages'];
const CODE_EXT = new Set(['.ts', '.js', '.mjs', '.svelte']);

/** Emit and exit. `mode=full` means the caller must run the whole suite. */
function emit(mode, files, reason) {
	console.log(`mode=${mode}`);
	console.log(`reason=${reason}`);
	for (const f of files ?? []) console.log(f);
	process.exit(0);
}
const full = (reason) => emit('full', [], reason);

try {
	// ── the change set ─────────────────────────────────────────────────────────
	let changed;
	// `!== undefined`, not truthiness: an injected EMPTY list means "an empty
	// change set", which must resolve to a full run. Testing truthiness let the
	// empty case fall through to the git path instead, so the selector answered a
	// different question than the caller asked — invisible locally, where the git
	// answer happened to agree.
	if (process.env.SELECT_TESTS_FILES !== undefined) {
		changed = process.env.SELECT_TESTS_FILES.split('\n').filter(Boolean);
	} else {
			const base = process.argv[2] || 'origin/master';
			const mergeBase = execFileSync('git', ['-C', ROOT, 'merge-base', base, 'HEAD'], {
				encoding: 'utf8',
			}).trim();
			const out = execFileSync('git', ['-C', ROOT, 'diff', '--name-status', mergeBase, '--'], {
				encoding: 'utf8',
			});
		// A deletion or rename breaks the reasoning: a deleted module can break
		// importers that no longer appear in the diff at all.
		if (/^(D|R\d*)\t/m.test(out)) full('change set contains a deletion or rename');
		changed = out
			.split('\n')
			.filter(Boolean)
			.map((l) => l.split('\t').pop());
	}
	if (!changed.length) full('empty change set');

	// ── the source universe ────────────────────────────────────────────────────
	const files = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (CODE_EXT.has(path.extname(e.name))) files.push(path.relative(ROOT, p));
		}
	};
	for (const r of SRC_ROOTS) walk(path.join(ROOT, r));
	const universe = new Set(files);

	// Anything changed that is not a known source file is unmodelled. Config,
	// lockfiles and workflows are wide triggers handled by gate-level.sh, but
	// this is the backstop for anything that slips past it.
	for (const f of changed) {
		if (!universe.has(f)) full(`changed path is not a modelled source file: ${f}`);
	}

	// ── resolve a specifier to a repo file ─────────────────────────────────────
	const VIRTUAL = Symbol('virtual');
	const EXTERNAL = Symbol('external');
	const COMPUTED = Symbol('computed');
	const CANDIDATES = [
		'',
		'.ts',
		'.js',
		'.mjs',
		'.svelte',
		'.json',
		'/index.ts',
		'/index.js',
		'/index.mjs',
	];

	// Directories that some module imports from by a COMPUTED specifier, e.g.
	// `import('./nodes/' + spec.type)`. Nothing static can model which file that
	// reaches, so a change anywhere beneath such a directory forces a full run.
	// Measured: three such patterns exist in the whole repo.
	const dynamicDirs = new Set();

	function resolveSpec(spec, fromFile) {
		// Computed at runtime — record the directory it reaches into and give up
		// on resolving this one edge.
		if (spec.includes('${')) {
			// The literal prefix before the interpolation bounds what the import can
			// reach. `./nodes/${x}` reaches <dir>/nodes; `./${x}.svelte` reaches
			// <dir> itself. Only bare-relative prefixes are modelled — anything else
			// is left alone rather than guessed at.
			const prefix = spec.slice(0, spec.indexOf('${'));
			if (prefix.startsWith('.')) {
				const abs = path.resolve(ROOT, path.dirname(fromFile), prefix);
				const dir = prefix.endsWith('/') ? abs : path.dirname(abs);
				dynamicDirs.add(path.relative(ROOT, dir));
			}
			return COMPUTED;
		}
		// SvelteKit generates ./$types into .svelte-kit/types at sync time. 461
		// references, no repo file behind them, and type-only — no runtime edge.
		if (spec.endsWith('$types')) return VIRTUAL;
		if (spec.startsWith('$app/') || spec.startsWith('$env') || spec === '$service-worker')
			return VIRTUAL;
		// Vite query suffixes: `$lib/shaders/fog.vert.glsl?raw`.
		const clean = spec.split('?')[0];
		let base;
		if (clean.startsWith('$lib/')) base = path.join(ROOT, 'src/lib', clean.slice(5));
		else if (clean.startsWith('.')) base = path.resolve(ROOT, path.dirname(fromFile), clean);
		else return EXTERNAL; // bare package name
		for (const c of CANDIDATES) {
			const p = base + c;
			try {
				if (existsSync(p) && statSync(p).isFile()) return path.relative(ROOT, p);
			} catch {
				/* fall through */
			}
		}
		return null; // repo-local but missing — caller decides
	}

	// ── forward edges: file -> the repo files it depends on ────────────────────
	// Deliberately regex rather than a parser. Over-matching selects more tests,
	// which is the safe direction; a parser that chokes on one TS construct would
	// silently under-select.
	const SPEC_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
	const MOCK_RE = /vi\.mock\(\s*['"]([^'"]+)['"]/g;

	const deps = new Map();
	for (const f of files) {
		let text;
		try {
			text = readFileSync(path.join(ROOT, f), 'utf8');
		} catch {
			continue;
		}
		const set = new Set();
		for (const re of [SPEC_RE, MOCK_RE]) {
			re.lastIndex = 0;
			let m;
			while ((m = re.exec(text))) {
				const r = resolveSpec(m[1], f);
				if (r === VIRTUAL || r === EXTERNAL || r === COMPUTED) continue;
				if (r === null) {
					// Only fail closed when the change set is actually near this file;
					// a stale unresolvable import elsewhere in the repo must not force
					// every run to full.
					if (changed.includes(f)) full(`unresolvable specifier "${m[1]}" in changed file ${f}`);
					continue;
				}
				set.add(r);
			}
		}
		deps.set(f, set);
	}

	// A change beneath a directory something imports from by computed specifier
	// cannot be traced to its importers, so it forces a full run. This is checked
	// after the graph pass, because that pass is what discovers the directories.
	for (const f of changed) {
		for (const d of dynamicDirs) {
			if (d && (f === d || f.startsWith(d + '/'))) {
				full(`changed file ${f} is under ${d}/, which is reached by a computed import`);
			}
		}
	}

	// ── invert: module -> files that depend on it ──────────────────────────────
	const importers = new Map();
	for (const [f, set] of deps)
		for (const d of set) {
			if (!importers.has(d)) importers.set(d, new Set());
			importers.get(d).add(f);
		}

	// ── transitive closure of dependents ───────────────────────────────────────
	const seen = new Set(changed);
	const queue = [...changed];
	while (queue.length) {
		const cur = queue.pop();
		for (const dep of importers.get(cur) ?? []) {
			if (!seen.has(dep)) {
				seen.add(dep);
				queue.push(dep);
			}
		}
	}

	const isTest = (f) => f.endsWith('.test.ts');
	const selected = new Set([...seen].filter(isTest));

	// ── always-run: coupling no import graph can see ───────────────────────────
	// Tests whose real subject is a file they READ off disk or shell out to,
	// rather than import. tests/scripts/always-run.test.ts regenerates this list
	// and fails if it drifts.
	const alwaysRunList = path.join(ROOT, 'tests/always-run.txt');
	if (existsSync(alwaysRunList)) {
		for (const line of readFileSync(alwaysRunList, 'utf8').split('\n')) {
			const f = line.trim();
			if (f && !f.startsWith('#')) {
				if (!universe.has(f)) full(`always-run list names a file that does not exist: ${f}`);
				selected.add(f);
			}
		}
	} else {
		full('always-run list is missing');
	}

	// Integration tests are excluded from the gate entirely (they need a database
	// and credentials, and run in the nightly instead).
	for (const f of [...selected]) if (f.includes('.integration.test.ts')) selected.delete(f);

	if (!selected.size) full('selection is empty');

	emit('selected', [...selected].sort(), `${selected.size} of ${files.filter(isTest).length} test files`);
} catch (err) {
	full(`selector threw: ${err && err.message ? err.message : String(err)}`);
}
