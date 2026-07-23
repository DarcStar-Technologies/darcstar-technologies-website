import type { Locale } from '$lib/paraglide/runtime';

// Locale-aware "22 July 2026" for CMS datetime/date fields (post.publishedAt, paper.publishedDate).
// Shared by the /news, /research, /people surfaces so the format never drifts between them. Returns
// '' for a null/empty/unparseable value so callers can render nothing rather than "Invalid Date".
export function formatDate(value: string | null | undefined, locale: Locale = 'en'): string {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(date);
}
