import { describe, expect, it } from 'vitest';
import { normalizeExtractedText, readableTextFromHtml } from './url';

describe('readable HTML text', () => {
	it('preserves boundaries between adjacent block elements', () => {
		const text = readableTextFromHtml(
			'<p>Published 2 September 2026</p><h2>Model cards</h2><p>What changed <strong>today</strong>.</p>',
		);
		expect(text).toBe('Published 2 September 2026\n\nModel cards\n\nWhat changed today.');
	});

	it('keeps list items readable and removes executable or invisible content', () => {
		const text = readableTextFromHtml(
			'<script>bad()</script><ul><li>First item</li><li>Second&nbsp;item</li></ul>',
		);
		expect(text).toBe('• First item\n\n• Second item');
	});

	it('normalises copied whitespace without destroying paragraphs', () => {
		expect(normalizeExtractedText(' One\u00a0 line \r\n\r\n\r\n Two ')).toBe(
			'One line\n\nTwo',
		);
	});
});
