import type { User, Session } from 'better-auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		interface Locals {
			user?: User;
			session?: Session;
		}

		// interface Error {}
		// Minimal auth snapshot exposed to every page by the root `+layout.server.ts`, so shared
		// UI (the navbar) can reflect sign-in state. `null` when signed out. Not the whole `User`
		// — the client only needs the email; `locals.user` stays server-only.
		interface PageData {
			user?: { email: string } | null;
		}
		// interface PageState {}
	}
}

export {};
