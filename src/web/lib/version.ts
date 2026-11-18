// The page's own release (codeflower-ui), which its build writes in
// (web.vite.config.ts); "dev" where nothing does, as in tests.
declare const __UI_VERSION__: string | undefined;

export const UI_VERSION: string = typeof __UI_VERSION__ === 'string' ? __UI_VERSION__ : 'dev';
