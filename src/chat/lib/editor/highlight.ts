// Highlighting for code that is shown, not edited: fenced blocks in agent
// messages and commands in tool calls. It uses the editor's grammars and token
// classes (`tok-*`, styled in app.css) without starting an editor; the grammars
// load on first use, so the chat's own bundle stays small.

/** Longer code stays plain: parsing it is not worth the wait. */
const MAX_CHARS = 200_000;

const highlighting = () => Promise.all([import('./languages.ts'), import('@lezer/highlight')]);

/**
 * Replaces the element's text with highlighted spans once the language (a
 * name such as "python", or a fenced block's info string) has loaded; leaves it
 * alone if the text changed meanwhile or the language is unknown.
 */
export async function highlightElement(element: HTMLElement, name: string | undefined): Promise<void> {
  const code = element.textContent ?? '';
  if (!name || !code || code.length > MAX_CHARS) return;
  let parsed;
  try {
    const [{ languageForName }, lezer] = await highlighting();
    const language = languageForName(name);
    if (!language) return;
    const support = language.support ?? (await language.load());
    if (element.textContent !== code) return;
    parsed = { tree: support.language.parser.parse(code), ...lezer };
  } catch {
    return;
  }
  const fragment = document.createDocumentFragment();
  parsed.highlightCode(
    code,
    parsed.tree,
    parsed.classHighlighter,
    (text, classes) => {
      if (!classes) return void fragment.append(text);
      const span = document.createElement('span');
      span.className = classes;
      span.textContent = text;
      fragment.append(span);
    },
    () => fragment.append('\n')
  );
  element.replaceChildren(fragment);
}

type Highlighted = { text: string; language: string | undefined };

/**
 * For a `<pre>` or `<code>` Svelte does not fill itself: `use:highlighted={{ text, language }}`
 * shows the text at once and highlights it when the grammar is ready.
 */
export function highlighted(element: HTMLElement, options: Highlighted): { update(options: Highlighted): void } {
  let shown: Highlighted | undefined;
  const show = (next: Highlighted) => {
    if (shown && shown.text === next.text && shown.language === next.language) return;
    shown = next;
    element.textContent = next.text;
    void highlightElement(element, next.language);
  };
  show(options);
  return { update: show };
}
