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
		// What the root `+layout.server.ts` exposes to every page, so shared UI can render without
		// each route re-fetching it. The auth snapshot is `null` when signed out and is NOT the whole
		// `User` — the client only needs the email; `isStaff` (Admin-vs-Account link, #96) is a
		// SEPARATE key so child layouts that override `user` for their own page don't shadow it;
		// `locals.user` stays server-only. `socialLinks` is the CMS-driven footer/`sameAs` row
		// (DAR-73) — always non-empty, since the server floors it to the site constant.
		interface PageData {
			user?: { email: string } | null;
			isStaff?: boolean;
			socialLinks?: readonly import('$lib/social-links').SocialLink[];
		}
		// interface PageState {}
	}
}

export {};
