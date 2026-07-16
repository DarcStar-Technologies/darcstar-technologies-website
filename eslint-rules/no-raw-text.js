/**
 * Local ESLint rule: forbid hardcoded human-readable text in Svelte markup so all
 * UI copy flows through Paraglide messages (`m.*()`), issue #18.
 *
 * It rides `svelte-eslint-parser` (already active on `*.svelte` via
 * `eslint-plugin-svelte`) — no extra dependency. It inspects:
 *   • template text nodes   → `SvelteText.value`
 *   • a small allowlist of user-facing attributes → the static `SvelteLiteral`
 *     value of `title` / `alt` / `aria-label` / `placeholder`
 *
 * It is a FORWARD guard for newly-introduced inline text, NOT a completeness net:
 * copy that lives in JS string literals (component data arrays, `{@render}` snippet
 * arguments) is an expression, not a text node, so the parser never surfaces it here —
 * that copy is migrated by hand and regression-guarded by the e2e text assertions.
 *
 * Dynamic content — `{m.foo()}`, `{expr}`, `title={m.foo()}` — is a mustache tag, not
 * a `SvelteText`/`SvelteLiteral`, so it is inherently ignored. Punctuation/decoration
 * with no letters (`·`, `→`, `©`, `""`) is skipped by the letter test below.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow hardcoded UI text; use Paraglide messages (m.*()).' },
		messages: {
			raw: 'Hardcoded text "{{text}}" — move it into a Paraglide message (m.*()).'
		},
		schema: [
			{
				type: 'object',
				properties: {
					attributes: { type: 'array', items: { type: 'string' } },
					ignorePattern: { type: 'string' }
				},
				additionalProperties: false
			}
		]
	},
	create(context) {
		const opts = context.options[0] ?? {};
		const attrs = new Set(opts.attributes ?? ['title', 'alt', 'aria-label', 'placeholder']);
		const ignore = opts.ignorePattern ? new RegExp(opts.ignorePattern, 'u') : null;

		// "Meaningful" copy has at least one letter and isn't wholly in the ignore set.
		const meaningful = (s) =>
			typeof s === 'string' && /\p{L}/u.test(s) && !(ignore && ignore.test(s.trim()));
		const report = (node, s) =>
			context.report({ node, messageId: 'raw', data: { text: s.trim() } });

		return {
			SvelteText(node) {
				if (meaningful(node.value)) report(node, node.value);
			},
			'SvelteAttribute > SvelteLiteral'(node) {
				const name = node.parent?.key?.name;
				if (typeof name === 'string' && attrs.has(name) && meaningful(node.value)) {
					report(node, node.value);
				}
			}
		};
	}
};
