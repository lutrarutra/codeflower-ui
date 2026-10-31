<script lang="ts">
  import DOMPurify from 'dompurify';
  import type { FeedbackAnnotation, FeedbackFigure, PreviewHostMessage, PreviewState } from '../protocol/messages.ts';
  import Annotator, { type Note } from './lib/Annotator.svelte';
  import { decodeText, fileKind, formatSize, isLocalHref, kindIcon, parseDelimited } from './lib/files.ts';
  import HtmlReport, { type ReportFigure } from './lib/HtmlReport.svelte';
  import Markdown from './lib/Markdown.svelte';
  import type { PreviewHost } from './lib/host.ts';
  // Loaded with the first file shown as text: chats alone do not need the editor.
  const loadEditor = () => import('./lib/editor/CodeEditor.svelte');

  let { host }: { host: PreviewHost } = $props();
  const sendPreview: PreviewHost['send'] = (message) => host.send(message);

  // A file from the sandbox: a figure, report or table the agent showed.
  const MAX_ROWS = 1000;
  const WORKSPACE = '/codeflower-state/workspace/';

  let preview = $state<PreviewState | null>(null);
  let assets = $state<Record<string, string | null>>({});
  let draft = $state('');
  let sent = $state<'sent' | 'queued' | null>(null);
  let updated = $state(false);
  let feedbackBox: HTMLTextAreaElement | undefined = $state();
  // Comments on parts of a figure, written over the whole tab: the shown image
  // ('file'), or a figure of a report. Drafts are kept per figure while closed.
  interface Draft {
    notes: Note[];
    general: string;
    report?: ReportFigure;
  }
  let drafts = $state<Record<string, Draft>>({});
  let annotating = $state<string | null>(null);
  const figureKey = (figure: FeedbackFigure) => `${figure.index}:${figure.part ?? ''}:${figure.caption ?? ''}`;
  const pending = $derived(
    Object.entries(drafts).filter(([, draft]) => draft.notes.length || draft.general.trim()) as [string, Draft][]
  );

  function annotate(key: string, report?: ReportFigure): void {
    drafts[key] ??= { notes: [], general: '' };
    // A report figure is shown as it was clicked; the report may change meanwhile.
    if (report) drafts[key].report = report;
    annotating = key;
  }

  function closeAnnotator(): void {
    const draft = annotating ? drafts[annotating] : undefined;
    if (annotating && draft && !draft.notes.length && !draft.general.trim()) delete drafts[annotating];
    annotating = null;
  }
  // The text in an editor: Markdown, HTML and tables show rendered unless the user asks for the source.
  let source = $state(false);
  let editor: { markSaved(text: string): void; reset(text: string): void; save(): void } | undefined = $state();
  let dirty = $state(false);
  /** The version of the file the edits are on; a save only goes over that one. */
  let baseMtime: number | undefined;
  /** Text sent to be saved, until the host says how it went. */
  let saving = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  /** The file changed in the sandbox while the user had edits. */
  let changedOutside = $state(false);
  let savedAt = $state<number | null>(null);

  function receive(message: PreviewHostMessage): void {
    switch (message.type) {
      case 'preview': {
        const previous = preview;
        preview = message.state;
        // Say so when the agent rewrote the file (not the user, from the editor); its images may have changed too.
        const ownSave = message.state.file.mtimeMs === baseMtime && savedAt !== null;
        if (previous?.data && message.state.data && previous.file.mtimeMs !== message.state.file.mtimeMs && !ownSave) {
          assets = {};
          requested = new Set();
          updated = true;
          setTimeout(() => (updated = false), 4000);
        }
        follow();
        break;
      }
      case 'written':
        baseMtime = message.file.mtimeMs;
        if (saving !== null) editor?.markSaved(saving);
        saving = null;
        saveError = null;
        changedOutside = false;
        savedAt = Date.now();
        // The host sends the new version next; what it shows until then is older than the save.
        break;
      case 'writeFailed':
        saving = null;
        if (message.conflict) changedOutside = true;
        else saveError = message.error;
        break;
      case 'asset':
        assets[message.path] = message.dataUrl;
        break;
      case 'feedbackSent':
        sent = message.queued ? 'queued' : 'sent';
        setTimeout(() => (sent = null), 6000);
        break;
      case 'draft':
        draft = draft.trim() ? `${draft.trim()}\n\n${message.text}` : message.text;
        feedbackBox?.focus();
        break;
    }
  }

  $effect(() => {
    const stop = host.listen(receive);
    sendPreview({ type: 'ready' });
    return stop;
  });

  /** A file the shown file refers to; undefined until the host sends it. */
  // Requested outside reactive state: rendering may ask for a file, but not change state.
  let requested = new Set<string>();
  function asset(path: string): string | null | undefined {
    if (!requested.has(path)) {
      requested.add(path);
      sendPreview({ type: 'asset', path });
    }
    return assets[path];
  }

  const kind = $derived(preview ? fileKind(preview.file.mimeType) : 'binary');
  /** Rendered kinds that also have a source to edit. */
  const rendered = $derived(['markdown', 'html', 'table'].includes(kind));
  const text = $derived(
    preview?.data && ['markdown', 'html', 'table', 'json', 'text'].includes(kind) ? decodeText(preview.data) : null
  );
  const shownPath = $derived(
    preview ? (preview.file.path.startsWith(WORKSPACE) ? preview.file.path.slice(WORKSPACE.length) : preview.file.path) : ''
  );

  const table = $derived.by(() => {
    if (kind !== 'table' || text === null || !preview) return null;
    return parseDelimited(text, preview.file.mimeType === 'text/csv' ? ',' : '\t', MAX_ROWS + 1);
  });

  const editing = $derived(text !== null && (kind === 'text' || kind === 'json' || (rendered && source)));
  // Text that is not UTF-8 would be damaged by a save: it can be looked at only.
  const readOnlyReason = $derived(
    !preview?.live
      ? 'The sandbox is not connected'
      : preview.file.writable === undefined
        ? 'This sandbox is too old to save files; update its image'
        : !preview.file.writable
          ? 'Only files in the workspace or an output folder can be saved'
          : text?.includes('\uFFFD')
            ? 'This file is not UTF-8 text'
            : null
  );

  /** Shows the file's new version in the editor, unless that would lose the user's edits. */
  function follow(): void {
    if (!preview?.data || text === null || saving !== null) return;
    if (baseMtime === undefined) baseMtime = preview.file.mtimeMs;
    if (preview.file.mtimeMs === baseMtime) return;
    if (dirty) changedOutside = true;
    else reload();
  }

  function reload(): void {
    if (!preview || text === null) return;
    baseMtime = preview.file.mtimeMs;
    changedOutside = false;
    editor?.reset(text);
  }

  /** Keeps the user's edits: the next save goes over the agent's version. */
  function keepMine(): void {
    if (preview) baseMtime = preview.file.mtimeMs;
    changedOutside = false;
  }

  function write(edited: string): void {
    if (!preview || readOnlyReason || saving !== null || baseMtime === undefined) return;
    if (changedOutside) return void feedbackBox?.focus();
    saving = edited;
    saveError = null;
    sendPreview({ type: 'write', text: edited, baseMtimeMs: baseMtime });
  }

  function tellAgent(): void {
    draft = draft.trim() ? `${draft.trim()}\n\nI edited ${shownPath} myself.` : `I edited ${shownPath} myself.`;
    savedAt = null;
    feedbackBox?.focus();
  }

  $effect(() => sendPreview({ type: 'dirty', dirty }));

  // HTML reports render without scripts; their local images load through the host.
  const htmlDocument = $derived.by(() => {
    if (kind !== 'html' || text === null) return '';
    const clean = DOMPurify.sanitize(text, { WHOLE_DOCUMENT: true });
    const document = new DOMParser().parseFromString(clean, 'text/html');
    for (const image of document.images) {
      const source = image.getAttribute('src') ?? '';
      if (!isLocalHref(source)) continue;
      const url = asset(source);
      if (url) image.src = url;
      else image.removeAttribute('src');
    }
    return `<!doctype html>${document.documentElement.outerHTML}`;
  });

  const updatedAt = $derived(
    preview ? new Date(preview.file.mtimeMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''
  );

  function submit(): void {
    const feedback = draft.trim();
    if (!feedback || !preview?.chat || !preview.live) return;
    sendPreview({ type: 'feedback', text: feedback });
    draft = '';
  }

  function sendAnnotations(text: string, annotations: FeedbackAnnotation[]): void {
    if (!preview?.chat || !preview.live || !annotating) return;
    const figure = drafts[annotating]?.report?.figure;
    sendPreview({
      type: 'feedback',
      text,
      ...(annotations.length ? { annotations } : {}),
      ...(figure ? { figure: $state.snapshot(figure) } : {})
    });
    delete drafts[annotating];
    annotating = null;
  }

  // What the overlay shows: the file's image, live, or the report figure as clicked.
  const annotated = $derived.by(() => {
    if (!annotating || !preview?.data) return null;
    const draft = drafts[annotating];
    if (!draft) return null;
    if (draft.report) {
      const { figure, mimeType, data } = draft.report;
      return { draft, title: figure.caption || `Figure ${figure.index}`, subtitle: `figure ${figure.index} in ${shownPath}`, mimeType, data };
    }
    return kind === 'image' ? { draft, title: preview.title, subtitle: shownPath, mimeType: preview.file.mimeType, data: preview.data } : null;
  });

  const sendHint = $derived(
    !preview?.chat ? 'Open a chat on this worker to send comments to its agent.' : !preview.live ? 'The worker is not connected.' : ''
  );
</script>

<div class="flex h-full flex-col">
  {#if preview}
    <header class="flex items-center gap-3 border-b-[1.5px] border-soft-line px-4 py-2.5">
      <span class="grid size-8 shrink-0 place-items-center rounded-lg border-[1.5px] border-line bg-teal-soft">
        <span class="codicon codicon-{kindIcon[kind]}"></span>
      </span>
      <div class="min-w-0 flex-1">
        <h1 class="m-0 truncate font-display text-[1.1rem] leading-tight font-medium">
          {preview.title}{#if dirty}<span class="ml-1.5 text-orange" title="Not saved">●</span>{/if}
        </h1>
        <div class="flex items-center gap-2 text-[0.8em] text-muted">
          <span class="truncate font-mono" title={preview.file.path}>{shownPath}</span>
          <span class="shrink-0">· {formatSize(preview.file.size)} · {updatedAt}</span>
        </div>
      </div>
      {#if updated}
        <span class="shrink-0 rounded-full bg-teal-soft px-2 py-0.5 text-[0.8em] font-semibold text-teal">
          <span class="codicon codicon-refresh text-[11px]!"></span> updated
        </span>
      {/if}
      {#if kind === 'html'}
        <button
          class="chip shrink-0"
          title="Open the report with its interactive charts, in its own tab (no network access)"
          disabled={!preview.data}
          onclick={() => sendPreview({ type: 'interactive' })}
        >
          <span class="codicon codicon-play"></span> Open interactive
        </button>
      {/if}
      {#if rendered && text !== null}
        <!-- Rendered or the source in the editor; edits must be saved or undone before switching back. -->
        <div
          class="flex shrink-0 rounded-full border-[1.5px] border-soft-line bg-code p-0.5 text-[0.8em] font-semibold"
          role="radiogroup"
          aria-label="Show the file"
        >
          {#each [{ value: false, icon: 'preview', label: 'Rendered' }, { value: true, icon: 'code', label: 'Code' }] as mode (mode.label)}
            <button
              role="radio"
              aria-checked={source === mode.value}
              class="flex items-center gap-1 rounded-full border-none px-2 py-0.5 {source === mode.value
                ? 'bg-card text-ink shadow-sm'
                : 'bg-transparent text-muted hover:text-ink'} disabled:cursor-not-allowed disabled:opacity-60"
              title={mode.value ? 'Show and edit the source' : dirty ? 'Save or undo your edits first' : 'Show it rendered'}
              disabled={!mode.value && dirty}
              onclick={() => (source = mode.value)}
            >
              <span class="codicon codicon-{mode.icon} text-[12px]!"></span>
              {mode.label}
            </button>
          {/each}
        </div>
      {/if}
      {#if editing}
        {#if readOnlyReason}
          <span class="shrink-0 rounded-full bg-code px-2 py-0.5 text-[0.8em] text-muted" title={readOnlyReason}>
            <span class="codicon codicon-lock text-[11px]!"></span> read-only
          </span>
        {:else}
          <button
            class="chip shrink-0"
            title="Save into the sandbox (Ctrl+S)"
            disabled={!dirty || saving !== null}
            onclick={() => editor?.save()}
          >
            <span class="codicon codicon-{saving !== null ? 'loading codicon-modifier-spin' : 'save'}"></span> Save
          </button>
        {/if}
      {/if}
      <button class="chip shrink-0" title="Save a copy on this machine" disabled={!preview.data} onclick={() => sendPreview({ type: 'save' })}>
        <span class="codicon codicon-cloud-download"></span> Download
      </button>
    </header>

    {#if preview.message}
      <div class="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-yellow-soft px-3 py-2">
        <span class="codicon codicon-sparkle mt-[3px] text-orange"></span>
        <span class="flex-1">{preview.message}</span>
      </div>
    {/if}

    {#if changedOutside}
      <div class="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-yellow-soft px-3 py-2">
        <span class="codicon codicon-warning text-orange"></span>
        <span class="flex-1">The file changed in the sandbox since you started editing.</span>
        <button class="chip" title="Show the new version; your edits are lost" onclick={reload}>Load theirs</button>
        <button class="chip" title="Keep editing; saving replaces the new version" onclick={keepMine}>Keep mine</button>
      </div>
    {:else if saveError}
      <div class="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-pink-soft px-3 py-2">
        <span class="codicon codicon-error mt-[3px] text-pink"></span>
        <span class="flex-1">Not saved: {saveError}</span>
      </div>
    {/if}

    <section class="min-h-0 flex-1 overflow-auto px-4 py-3">
      {#if preview.error}
        <div class="m-auto flex max-w-sm flex-col items-center gap-2 py-10 text-center text-muted">
          <span class="codicon codicon-warning text-2xl! text-pink"></span>
          <p class="m-0">{preview.error}</p>
        </div>
      {:else if !preview.data}
        <div class="flex items-center gap-2 py-10 text-muted">
          <span class="codicon codicon-loading codicon-modifier-spin"></span> Loading…
        </div>
      {:else if editing && text !== null}
        {#await loadEditor()}
          <div class="flex items-center gap-2 py-10 text-muted">
            <span class="codicon codicon-loading codicon-modifier-spin"></span> Loading the editor…
          </div>
        {:then { default: CodeEditor }}
          <div class="card h-full overflow-hidden p-0">
            <CodeEditor
              bind:this={editor}
              {text}
              path={preview.file.path}
              readOnly={!!readOnlyReason}
              onSave={write}
              onDirty={(value) => (dirty = value)}
            />
          </div>
        {/await}
      {:else if kind === 'image'}
        <!-- Click opens the figure over the whole tab, to comment on its parts. -->
        <button
          class="group relative mx-auto block w-fit max-w-full cursor-zoom-in border-none bg-transparent p-0"
          title="Open the figure to comment on parts of it"
          onclick={() => annotate('file')}
        >
          <img
            class="mx-auto block max-h-[calc(100vh-14rem)] max-w-full rounded-lg bg-white object-contain"
            src="data:{preview.file.mimeType};base64,{preview.data}"
            alt={preview.title}
          />
          <span
            class="absolute top-2 right-2 rounded-full bg-indigo px-2.5 py-0.5 text-[0.8em] font-semibold text-on-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <span class="codicon codicon-comment text-[11px]!"></span> Comment on parts
          </span>
        </button>
        {#if drafts.file && (drafts.file.notes.length || drafts.file.general.trim())}
          <p class="mt-2 mb-0 text-center text-[0.85em] text-muted">
            <span class="codicon codicon-comment-draft text-orange"></span>
            {drafts.file.notes.length ? `${drafts.file.notes.length} comment${drafts.file.notes.length === 1 ? '' : 's'}` : 'A comment'} not
            sent yet ·
            <button type="button" class="link font-semibold" onclick={() => annotate('file')}>Continue</button>
          </p>
        {/if}
      {:else if kind === 'markdown' && text !== null}
        <article class="card mx-auto max-w-3xl px-6 py-5">
          <Markdown {text} {asset} openFile={(path) => sendPreview({ type: 'openFile', path })} />
        </article>
      {:else if kind === 'html'}
        {#if pending.some(([key]) => key !== 'file')}
          <div class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.85em] text-muted">
            <span class="codicon codicon-comment-draft text-orange"></span> Comments not sent yet on
            {#each pending.filter(([key]) => key !== 'file') as [key, draft] (key)}
              <button type="button" class="link font-semibold" onclick={() => annotate(key)}>
                {draft.report ? `figure ${draft.report.figure.index}` : key}
              </button>
            {/each}
          </div>
        {/if}
        <HtmlReport html={htmlDocument} onfigure={(figure) => annotate(figureKey(figure.figure), figure)} />
      {:else if table}
        <div class="overflow-auto rounded-xl border-[1.5px] border-soft-line">
          <table class="w-full border-collapse font-mono text-[0.85em]">
            <thead class="sticky top-0 bg-card">
              <tr>
                {#each table.rows[0] ?? [] as cell, index (index)}
                  <th class="border-b-[1.5px] border-soft-line px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">{cell}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each table.rows.slice(1, MAX_ROWS + 1) as row, index (index)}
                <tr class="odd:bg-code/60">
                  {#each row as cell, column (column)}
                    <td class="px-2.5 py-1 whitespace-nowrap">{cell}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-[0.85em] text-muted">
          {table.total - 1} rows{table.total - 1 > MAX_ROWS ? `, the first ${MAX_ROWS} shown` : ''} · {table.rows[0]?.length ?? 0} columns
        </p>
      {:else}
        <div class="m-auto flex max-w-sm flex-col items-center gap-3 py-10 text-center text-muted">
          <span class="codicon codicon-{kindIcon[kind]} text-3xl!"></span>
          <p class="m-0">
            {kind === 'pdf' ? 'PDFs cannot be shown here yet.' : 'This kind of file cannot be shown here.'} Save a copy to open it
            on this machine{kind === 'pdf' ? ', or ask the agent for a PNG or SVG' : ''}.
          </p>
          <button class="pill pill-small" onclick={() => sendPreview({ type: 'save' })}>
            <span class="codicon codicon-save"></span> Save a copy
          </button>
        </div>
      {/if}
    </section>

    <form
      class="card mx-4 mb-4 flex flex-col gap-1 px-3 pt-2 pb-2 focus-within:border-indigo"
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        rows="2"
        class="max-h-40 min-h-[2.8em] resize-none border-none bg-transparent p-0.5 outline-none placeholder:text-muted disabled:cursor-not-allowed"
        placeholder={preview.chat
          ? `Tell the agent what to change… (${kind === 'image' ? 'e.g. bigger labels, a log scale, other colors' : 'it sees which file you mean'})`
          : 'Open a chat on this worker to give the agent feedback'}
        disabled={!preview.chat || !preview.live}
        bind:this={feedbackBox}
        bind:value={draft}
        onkeydown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      ></textarea>
      <div class="flex items-center gap-2 text-[0.8em] text-muted">
        <span class="flex min-w-0 flex-1 items-center gap-1">
          {#if sent === 'queued'}
            <span class="codicon codicon-clock text-orange"></span>
            <span class="truncate">The agent is busy; your feedback goes to it when this turn ends.</span>
          {:else if sent === 'sent'}
            <span class="codicon codicon-check text-green"></span> Sent to the chat.
          {:else if savedAt !== null && !dirty}
            <span class="codicon codicon-check text-green"></span> Saved.
            {#if preview.chat}
              <button type="button" class="link font-semibold" onclick={tellAgent}>Tell the agent</button>
            {/if}
          {:else if preview.chat}
            <span class="shrink-0">Goes to</span>
            <button
              type="button"
              class="link min-w-0 truncate font-semibold"
              title={preview.chat.title}
              onclick={() => sendPreview({ type: 'showChat' })}>{preview.chat.title || 'the chat'}</button
            >
            {#if preview.chat.busy}<span class="shrink-0">· after this turn</span>{/if}
          {/if}
        </span>
        <button type="submit" class="pill pill-primary pill-small" disabled={!draft.trim() || !preview.chat || !preview.live}>
          Send <span class="codicon codicon-arrow-up"></span>
        </button>
      </div>
    </form>
    {#if annotated && annotating}
      {#key annotating}
        <Annotator
          title={annotated.title}
          subtitle={annotated.subtitle}
          mimeType={annotated.mimeType}
          data={annotated.data}
          bind:notes={drafts[annotating]!.notes}
          bind:general={drafts[annotating]!.general}
          sendable={Boolean(preview.chat && preview.live)}
          {sendHint}
          onsend={sendAnnotations}
          onclose={closeAnnotator}
        />
      {/key}
    {/if}
  {:else}
    <div class="m-auto flex items-center gap-2 text-muted">
      <span class="codicon codicon-loading codicon-modifier-spin"></span> Loading…
    </div>
  {/if}
</div>
