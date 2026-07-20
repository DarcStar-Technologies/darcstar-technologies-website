// Derive the session/user shapes from the LIVE auth instance so the admin-plugin fields
// (user.role/banned/banReason/banExpires, session.impersonatedBy) — and, crucially, their
// nullability — match exactly what `auth.api.getSession` returns. The plugin's exported
// `UserWithRole`/`SessionWithImpersonatedBy` drop `null`, which the DB-backed values keep.
type AuthSession = ReturnType<typeof import('$lib/server/auth').getAuth>['$Infer']['Session'];

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
			user?: AuthSession['user'];
			session?: AuthSession['session'];
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
