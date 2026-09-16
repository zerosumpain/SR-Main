/**
 * `${{ }}` inside a `run:` body is substituted by Actions BEFORE bash parses the
 * script. Any value that is not workflow-controlled therefore becomes shell
 * source on the runner — and one of those runners is the box that serves the
 * site.
 *
 * This repo has already been bitten once: the risk-tier summary interpolated
 * `matched`, a list of filenames taken from the pull request, so a PR adding a
 * file whose name contained a backtick got shell execution. That was fixed by
 * passing it through `env:`.
 *
 * A rule with exceptions cannot be checked, so there are none: every value a
 * run body needs arrives as an environment variable.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, '.github/workflows');

/** Every line inside a `run:` value, block or single-line form. */
function runBodyLines(source: string): Array<{ line: number; text: string }> {
	const out: Array<{ line: number; text: string }> = [];
	const lines = source.split('\n');
	let inBlock = false;
	let indent = 0;
	lines.forEach((text, i) => {
		const line = i + 1;
		if (/^\s*run:\s*[|>]/.test(text)) {
			inBlock = true;
			indent = text.length - text.trimStart().length;
			return;
		}
		if (/^\s*run:\s*\S/.test(text)) {
			inBlock = false;
			out.push({ line, text });
			return;
		}
		if (inBlock) {
			const isBlank = text.trim() === '';
			if (!isBlank && text.length - text.trimStart().length <= indent) {
				inBlock = false;
				return;
			}
			if (!isBlank) out.push({ line, text });
		}
	});
	return out;
}

describe('workflow shell safety', () => {
	const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

	it('has workflows to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)('%s interpolates no expression into a run body', (file) => {
		const source = readFileSync(path.join(DIR, file), 'utf8');
		const offenders = runBodyLines(source)
			.filter(({ text }) => text.includes('${{'))
			// A comment is not executed.
			.filter(({ text }) => !text.trimStart().startsWith('#'));

		expect(
			offenders.map((o) => `${file}:${o.line}: ${o.text.trim()}`),
			'pass the value through `env:` and reference it as a shell variable instead'
		).toEqual([]);
	});
});
