// The editor in the code flower look: it takes the page's colors (the --cf-*
// variables), so it follows light, dark and high-contrast themes with the rest.
// Syntax colors are the `tok-*` classes in app.css, shared with the chat.
import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--cf-ink)',
    backgroundColor: 'var(--cf-card)',
    fontSize: '0.9em'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--cf-indigo)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cf-indigo)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'color-mix(in srgb, var(--cf-indigo) 22%, transparent)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--cf-code) 55%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--cf-teal) 18%, transparent)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--cf-yellow) 35%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--cf-orange) 60%, transparent)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--cf-orange) 45%, transparent)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--cf-teal) 25%, transparent)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--cf-red) 25%, transparent)' },
  '.cm-gutters': { backgroundColor: 'var(--cf-card)', color: 'var(--cf-muted)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--cf-ink)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--cf-code)', border: 'none', color: 'var(--cf-muted)', padding: '0 0.4em' },
  '.cm-panels': { backgroundColor: 'var(--cf-sunken)', color: 'var(--cf-ink)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--cf-soft-line)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--cf-soft-line)' },
  '.cm-panel input, .cm-panel button, .cm-textfield': {
    font: 'inherit',
    color: 'var(--cf-ink)',
    backgroundColor: 'var(--cf-card)',
    border: '1px solid var(--cf-line)',
    borderRadius: '6px'
  },
  '.cm-button': { backgroundImage: 'none' },
  '.cm-tooltip': {
    color: 'var(--cf-ink)',
    backgroundColor: 'var(--cf-card)',
    border: '1px solid var(--cf-line)',
    borderRadius: '8px',
    boxShadow: 'var(--cf-elevation)'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--cf-indigo-soft)', color: 'var(--cf-ink)' }
});
