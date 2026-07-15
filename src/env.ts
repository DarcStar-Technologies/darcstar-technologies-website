import { defineEnvVars } from '@sveltejs/kit/hooks';

/**
 * A Standard Schema that treats a variable as an optional string (missing/empty
 * resolves to `''`). Without a schema, `defineEnvVars` requires a non-empty
 * string when the app starts — which includes SvelteKit's build analyse pass,
 * where Cloudflare's runtime secrets aren't available. The real values are read
 * at runtime; code that needs them guards for emptiness (see `getDb`).
 */
const optional = {
	'~standard': {
		version: 1 as const,
		vendor: 'darcstar-env',
		validate: (value: unknown) => ({ value: typeof value === 'string' ? value : '' }),
		// Phantom marker so SvelteKit infers the variable's type as `string`.
		types: undefined as unknown as { input: string | undefined; output: string }
	}
};

export const variables = defineEnvVars({
	DATABASE_URL: { schema: optional, description: 'The database connection string.' },
	DATABASE_AUTH_TOKEN: {
		schema: optional,
		description: 'Auth token for the [Turso](https://turso.tech) database.'
	},
	ORIGIN: {
		schema: optional,
		description: 'The app origin (base URL), e.g. `http://localhost:5173`.'
	},
	BETTER_AUTH_SECRET: {
		schema: optional,
		description:
			'Secret used to sign tokens. For production use 32 characters generated with high entropy. See [Better Auth installation](https://www.better-auth.com/docs/installation).'
	},
	GITHUB_CLIENT_ID: {
		schema: optional,
		description:
			'GitHub OAuth client ID. See [Better Auth GitHub provider](https://www.better-auth.com/docs/authentication/github).'
	},
	GITHUB_CLIENT_SECRET: {
		schema: optional,
		description:
			'GitHub OAuth client secret. See [Better Auth GitHub provider](https://www.better-auth.com/docs/authentication/github).'
	}
});
