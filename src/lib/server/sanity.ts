import { createClient, type SanityClient } from '@sanity/client';
import { apiVersion, dataset, projectId } from '$lib/sanity/config';
import { readEnv } from './env';

// Server-only Sanity READ client. This project gates document reads behind document-level access
// control: an anonymous request to the (nominally public) `production` dataset sees only
// `siteSettings` — post/paper/person need an authenticated read. So we carry a Sanity VIEWER TOKEN
// (a read-only secret), resolved per-request via readEnv (platform.env on Workers; .env locally).
//
// The token MUST stay server-side — this module lives in $lib/server (SvelteKit refuses to bundle it
// into the browser) and is only imported by +page.server.ts loads. Image URLs need no token (the
// asset binaries are public by hashed URL; see $lib/sanity/image.ts), so the client bundle carries
// none.
//
// Lazy singleton, mirroring getDb()/getAuth(): readEnv needs an in-flight request, so the client is
// built on first use inside a load. `useCdn: false` — authenticated reads bypass the API CDN. If the
// token is absent (a dev checkout without it), the client is simply token-less and reads return only
// the publicly-visible docs — the pages degrade to empty states rather than throwing.
let client: SanityClient | undefined;

export function getSanityClient(): SanityClient {
	if (client) return client;
	client = createClient({
		projectId,
		dataset,
		apiVersion,
		useCdn: false,
		perspective: 'published',
		token: readEnv('SANITY_VIEWER_TOKEN')
	});
	return client;
}
