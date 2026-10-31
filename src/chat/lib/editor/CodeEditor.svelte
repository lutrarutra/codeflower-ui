<script lang="ts">
  import { untrack } from 'svelte';
  import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
  import { history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
  import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
  import { Compartment, EditorState, Prec, type Text } from '@codemirror/state';
  import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    rectangularSelection
  } from '@codemirror/view';
  import { classHighlighter } from '@lezer/highlight';
  import { vscodeKeymap } from '@replit/codemirror-vscode-keymap';
  import { languageForPath } from './languages.ts';
  import { editorTheme } from './theme.ts';

  // A file's text, edited as in VS Code: its shortcuts, multiple cursors, search
  // and replace, folding. Ctrl+S (Cmd+S) hands the text to `onSave`; the parent
  // says when it is saved with `markSaved`, and replaces the text with `reset`.
  let {
    text,
    path,
    readOnly = false,
    onSave,
    onDirty
  }: {
    text: string;
    path: string;
    readOnly?: boolean;
    onSave?: (text: string) => void;
    onDirty?: (dirty: boolean) => void;
  } = $props();

  let root: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;
  /** The text as last saved or loaded, to tell whether there are edits. */
  let saved: Text | undefined;
  let dirty = false;
  const language = new Compartment();
  const editable = new Compartment();

  function setDirty(value: boolean): void {
    if (value === dirty) return;
    dirty = value;
    onDirty?.(value);
  }

  /** Files written on Windows keep their line ends. */
  function lineSeparator(value: string) {
    return value.includes('\r\n') ? [EditorState.lineSeparator.of('\r\n')] : [];
  }

  function save(): boolean {
    if (!view || readOnly) return true;
    onSave?.(view.state.sliceDoc());
    return true;
  }

  /** Hands the text to `onSave`, as Ctrl+S does. */
  export { save };

  function create(value: string): EditorState {
    return EditorState.create({
      doc: value,
      extensions: [
        lineSeparator(value),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(classHighlighter),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        Prec.highest(
          keymap.of([
            { key: 'Mod-s', run: save, preventDefault: true },
            { key: 'Mod-h', run: openSearchPanel, preventDefault: true }
          ])
        ),
        keymap.of([...vscodeKeymap, ...closeBracketsKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
        language.of([]),
        editable.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && saved) setDirty(!update.state.doc.eq(saved));
        })
      ]
    });
  }

  async function loadLanguage(forPath: string): Promise<void> {
    const description = languageForPath(forPath);
    if (!description) return;
    try {
      const support = description.support ?? (await description.load());
      view?.dispatch({ effects: language.reconfigure(support) });
    } catch {
      // Plain text, then.
    }
  }

  /** The file was saved with this text: edits made since stay unsaved. */
  export function markSaved(value: string): void {
    if (!view) return;
    saved = EditorState.create({ doc: value, extensions: lineSeparator(value) }).doc;
    setDirty(!view.state.doc.eq(saved));
  }

  /** Shows a new version of the file, e.g. the agent's, keeping the cursor and scroll where they can be. */
  export function reset(value: string): void {
    if (!view) return;
    const { selection } = view.state;
    const scroll = view.scrollDOM.scrollTop;
    view.setState(create(value));
    void loadLanguage(path);
    saved = view.state.doc;
    setDirty(false);
    const end = view.state.doc.length;
    if (selection.main.head <= end) view.dispatch({ selection: { anchor: Math.min(selection.main.anchor, end), head: selection.main.head } });
    view.scrollDOM.scrollTop = scroll;
  }

  export function focus(): void {
    view?.focus();
  }

  $effect(() => {
    if (!root) return;
    // Built once: later versions of the file come through `reset`.
    const editor = new EditorView({ parent: root, state: untrack(() => create(text)) });
    view = editor;
    saved = editor.state.doc;
    void loadLanguage(untrack(() => path));
    return () => {
      editor.destroy();
      view = undefined;
    };
  });

  $effect(() => {
    const locked = readOnly;
    view?.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]) });
  });
</script>

<div bind:this={root} class="h-full min-h-0 overflow-hidden"></div>
