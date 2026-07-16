// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

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
		// (routes + components) — not the `src/stories/**` / vitest-examples scaffold, which
		// is throwaway `sv create`/Storybook demo content. `local/no-raw-text` is a custom
		// rule (eslint-rules/no-raw-text.js); it rides the svelte parser already active here.
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
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		rules: {}
	}
);
