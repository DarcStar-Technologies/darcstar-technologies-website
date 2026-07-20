import type { Preview } from '@storybook/sveltekit';
// The app's global styles (Tailwind + Skeleton + the darcstar theme + the glass/eyebrow @utilities
// and self-hosted brand fonts) so components render exactly as they do in the app, plus the
// preview-canvas void background.
import '../src/routes/layout.css';
import './preview.css';

// The site is dark-only and themed via attributes on <html> (data-theme/data-mode, set in
// app.html). Storybook renders in its own iframe, so mirror them here or the theme tokens and the
// `dark:` variant won't resolve and the glass surfaces render unstyled.
if (typeof document !== 'undefined') {
	document.documentElement.setAttribute('data-theme', 'darcstar');
	document.documentElement.setAttribute('data-mode', 'dark');
}

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i
			}
		},

		a11y: {
			// 'todo' - show a11y violations in the test UI only
			// 'error' - fail CI on a11y violations
			// 'off' - skip a11y checks entirely
			test: 'todo'
		}
	}
};

export default preview;
