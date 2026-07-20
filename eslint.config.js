import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import noRawText from './eslint-rules/no-raw-text.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{
		// Don't lint generated or throwaway output. `includeIgnoreFile` only reads the ROOT
		// .gitignore, so Paraglide's output (ignored by its own nested .gitignore) and the
		// tracked-but-generated files below slip through — list them explicitly. vitest.shims.d.ts
		// is a scaffold shim whose sole content is a necessary triple-slash reference.
		// (src/lib/paraglide.svelte.ts is deliberately NOT ignored — it's hand-authored app code.)
		ignores: [
			'src/lib/paraglide/**',
			'worker-configuration.d.ts',
			'vitest.shims.d.ts',
			'src/lib/server/db/auth.schema.ts'
		]
	},
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Keep UI copy in Paraglide messages (issue #18). Scoped to the real app surface
		// (routes + components); `*.stories.svelte` is exempted below (Storybook demo copy).
		// `local/no-raw-text` is a custom rule (eslint-rules/no-raw-text.js); it rides the
		// svelte parser already active here.
		files: ['src/routes/**/*.svelte', 'src/lib/components/**/*.svelte'],
		plugins: { local: { rules: { 'no-raw-text': noRawText } } },
		rules: {
			'local/no-raw-text': [
				'error',
				{
					attributes: ['title', 'alt', 'aria-label', 'placeholder'],
					// Skip decoration/punctuation-only text (·, →, ©, empty alt); real copy has letters.
					ignorePattern: '^[\\s\\d\\p{P}\\p{S}]+$'
				}
			]
		}
	},
	{
		// The brand wordmark ("DarcStar Technologies") is a proper-noun logotype, not
		// translatable copy — exempt it from the raw-text guard (issue #18).
		files: ['**/Wordmark.svelte'],
		rules: { 'local/no-raw-text': 'off' }
	},
	{
		// Storybook stories are demo/documentation content, not shipped UI — hardcoded sample copy
		// (placeholders, labels) is appropriate and shouldn't be forced into Paraglide messages.
		files: ['**/*.stories.svelte'],
		rules: { 'local/no-raw-text': 'off' }
	},
	{
		rules: {
			// Paraglide's localizeHref()/goto() ARE this project's locale-correct link resolver;
			// SvelteKit's resolve() (what this rule wants) adds nothing here — there's no configured
			// `base` path — and can't touch the generated paraglide.svelte.ts goto() either. The
			// rule therefore only ever fires false positives on our i18n links (issue #63).
			// Re-enable if a `base` path is ever introduced.
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
