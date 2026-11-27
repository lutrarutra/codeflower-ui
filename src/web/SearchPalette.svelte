<script lang="ts">
  // The search (Ctrl+K, ⌘K on a Mac): chats by title and files by name, fuzzily,
  // then what chats and files say. The arrow keys move through every result,
  // Enter opens one: a chat where chats open, a file in a tab beside it.
  import { tick } from 'svelte';
  import AgentIcon from '../chat/lib/AgentIcon.svelte';
  import { agentPresentation, type AgentName } from '../protocol/messages.ts';
  import { app } from './lib/app.svelte.ts';
  import { ago, plural, workerTitle } from './lib/format.ts';
  import { markRuns } from '../chat/lib/fuzzy.ts';
  import { Search, TEXT_FROM, type SearchItem } from './lib/search.svelte.ts';

  let { shortcut }: { shortcut: string } = $props();

  const search = new Search({
    workers: () => app.workers,
    agent: (id) => app.agent(id),
    name: (worker) => workerTitle(worker)[0]
  });

  let dialog: HTMLDialogElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let active = $state(0);
  let isOpen = $state(false);

  // The first result again whenever the results change under the cursor.
  $effect(() => {
    void search.query;
    active = 0;
  });
  $effect(() => {
    if (active >= search.items.length) active = Math.max(0, search.items.length - 1);
  });

  export async function open(): Promise<void> {
    if (!dialog) return;
    if (!dialog.open) {
      search.refreshChats();
      dialog.showModal();
      isOpen = true;
    }
    await tick();
    input?.focus();
    input?.select();
  }

  export function toggle(): void {
    if (dialog?.open) dialog.close();
    else void open();
  }

  function closed(): void {
    isOpen = false;
    search.close();
  }

  function choose(item: SearchItem | undefined): void {
    if (!item) return;
    dialog?.close();
    if (item.kind === 'chat' || item.kind === 'chatText') {
      app.go({ view: app.route.view === 'focus' ? 'focus' : 'chat', worker: item.workerId, session: item.key });
      return;
    }
    // Files open in the editor's grid, beside the chat in front.
    if (app.route.view !== 'chat') app.go({ view: 'chat' });
    void app.previews.openPath(app.agent(item.workerId), item.path, undefined);
  }

  async function move(by: number): Promise<void> {
    const count = search.items.length;
    if (!count) return;
    active = (active + by + count) % count;
    await tick();
    document.getElementById(optionId(search.items[active]!))?.scrollIntoView({ block: 'nearest' });
  }

  function keydown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === 'ArrowDown' || (ctrl && event.key === 'n')) {
      event.preventDefault();
      void move(1);
    } else if (event.key === 'ArrowUp' || (ctrl && event.key === 'p')) {
      event.preventDefault();
      void move(-1);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      choose(search.items[active]);
    }
  }

  const optionId = (item: SearchItem) => `search-${item.id}`;
  const presentation = (workerId: string, harness: string) => agentPresentation(harness as AgentName, app.agent(workerId).agent(harness as AgentName));
  const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

  /** The path's folder and name, each with its marked letters. */
  function pathRuns(path: string, positions: readonly number[]) {
    const cut = path.lastIndexOf('/') + 1;
    return {
      folder: markRuns(path.slice(0, cut), positions.filter((at) => at < cut)),
      name: markRuns(path.slice(cut), positions.filter((at) => at >= cut).map((at) => at - cut))
    };
  }

  const IMAGE = /\.(png|jpe?g|gif|webp|svg|tiff?|pdf)$/i;
  const CODE = /\.(py|r|R|jl|js|ts|sh|go|rs|java|c|h|cpp|nf|smk|sql|ipynb)$/;
  function fileIcon(path: string): string {
    if (IMAGE.test(path)) return 'file-media';
    if (/\.(md|markdown)$/i.test(path)) return 'markdown';
    if (/\.html?$/i.test(path)) return 'globe';
    if (/\.(csv|tsv)$/i.test(path)) return 'table';
    if (CODE.test(path)) return 'file-code';
    return 'file';
  }

  const indexOf = (item: SearchItem) => search.items.indexOf(item);

  const placeholder = 'Search chats and files';
</script>

{#snippet marked(runs: { text: string; marked: boolean }[])}
  {#each runs as run, i (i)}{#if run.marked}<mark class="bg-transparent font-semibold text-indigo">{run.text}</mark>{:else}{run.text}{/if}{/each}
{/snippet}

{#snippet excerpt(text: string, start: number, length: number)}
  {text.slice(0, start)}<mark class="rounded-[3px] bg-indigo-soft px-px text-ink">{text.slice(start, start + length)}</mark>{text.slice(start + length)}
{/snippet}

{#snippet where(item: SearchItem, extra: string)}
  {@const parts = [item.sandbox, extra].filter(Boolean)}
  {#if parts.length}<span class="shrink-0 truncate pl-2 text-[0.8em] text-muted max-[520px]:hidden">{parts.join(' · ')}</span>{/if}
{/snippet}

<dialog
  bind:this={dialog}
  class="mt-[10vh] mb-auto max-w-[min(40rem,calc(100vw-2rem))]"
  aria-label="Search"
  onclose={closed}
  onclick={(event) => event.target === dialog && dialog?.close()}
>
  {#if isOpen}
    <div class="card flex max-h-[min(36rem,calc(90dvh-10vh))] flex-col overflow-hidden p-0">
      <label class="flex shrink-0 items-center gap-2 border-b-[1.5px] border-soft-line px-3.5 py-2.5">
        <span class="codicon codicon-search text-muted"></span>
        <input
          bind:this={input}
          class="min-w-0 flex-1 border-0 bg-transparent text-[1.05em] placeholder:text-muted"
          style="outline: none"
          {placeholder}
          value={search.query}
          oninput={(event) => search.update(event.currentTarget.value)}
          onkeydown={keydown}
          role="combobox"
          aria-expanded={search.items.length > 0}
          aria-controls="search-results"
          aria-activedescendant={search.items[active] ? optionId(search.items[active]!) : undefined}
          aria-autocomplete="list"
          autocomplete="off"
          spellcheck="false"
        />
        {#if search.pending}<span class="spinner shrink-0" aria-label="Searching"></span>{/if}
        <kbd class="shrink-0 rounded border border-line px-1.5 text-[0.75em] text-muted max-[520px]:hidden">Esc</kbd>
      </label>

      <div id="search-results" role="listbox" aria-label="Results" class="min-h-0 flex-1 overflow-y-auto py-1">
        {#each search.sections as section (section.id)}
          <div role="group" aria-labelledby="search-section-{section.id}">
            <div id="search-section-{section.id}" class="px-3.5 pt-2 pb-1 text-[0.75em] font-bold tracking-wide text-muted uppercase">
              {section.title}
            </div>
            {#each section.items as item (item.id)}
              {@const at = indexOf(item)}
              <!-- The input keeps the focus; the keys move through the options. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                id={optionId(item)}
                role="option"
                tabindex="-1"
                aria-selected={at === active}
                class="mx-1.5 flex cursor-pointer flex-col rounded-lg px-2 py-1.5 {at === active ? 'bg-indigo-soft' : ''}"
                onpointermove={() => (active = at)}
                onclick={() => choose(item)}
              >
                {#if item.kind === 'chat'}
                  <span class="flex min-w-0 items-center gap-2">
                    <AgentIcon agent={presentation(item.workerId, item.harness)} size="0.95em" />
                    <span class="min-w-0 flex-1 truncate">{@render marked(markRuns(item.title || 'Untitled chat', item.positions))}</span>
                    {@render where(item, item.updatedAt ? ago(Date.parse(item.updatedAt)) : '')}
                  </span>
                {:else if item.kind === 'file'}
                  {@const runs = pathRuns(item.relative, item.positions)}
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="codicon codicon-{fileIcon(item.path)} shrink-0 text-muted"></span>
                    <span class="shrink-0 truncate">{@render marked(runs.name)}</span>
                    <span class="min-w-0 flex-1 truncate text-[0.85em] text-muted [direction:rtl] text-left"
                      ><bdi>{@render marked(runs.folder)}</bdi></span
                    >
                    {@render where(item, item.folder)}
                  </span>
                {:else if item.kind === 'chatText'}
                  <span class="flex min-w-0 items-center gap-2">
                    <AgentIcon agent={presentation(item.workerId, item.harness)} size="0.95em" />
                    <span class="min-w-0 flex-1 truncate">{item.title || 'Untitled chat'}</span>
                    {@render where(item, item.count > 1 ? plural(item.count, 'match', 'matches') : '')}
                  </span>
                  <span class="truncate pl-6 text-[0.85em] text-muted">
                    <span class="font-semibold">{item.place.role === 'user' ? 'You' : 'Agent'}:</span>
                    {@render excerpt(item.place.text, item.place.start, item.place.length)}
                  </span>
                {:else}
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="codicon codicon-{fileIcon(item.path)} shrink-0 text-muted"></span>
                    <span class="shrink-0 truncate">{basename(item.relative)}<span class="text-muted">:{item.line.line}</span></span>
                    <span class="min-w-0 flex-1 truncate text-[0.85em] text-muted">{dirname(item.relative)}</span>
                    {@render where(item, item.folder)}
                  </span>
                  <span class="truncate pl-6 font-mono text-[0.8em] whitespace-pre text-muted">{@render excerpt(item.line.text.trimEnd(), item.line.start, item.line.length)}</span>
                {/if}
              </div>
            {/each}
            {#if section.more}
              <div class="px-3.5 pb-1 text-[0.8em] text-muted">More not shown: type more to narrow it down.</div>
            {/if}
          </div>
        {:else}
          <p class="m-0 px-3.5 py-6 text-center text-muted">
            {#if !search.query.trim()}
              No chats yet.
            {:else if search.settled}
              Nothing found for “{search.query.trim()}”.
            {:else}
              Searching…
            {/if}
          </p>
        {/each}
      </div>

      {#if search.problems.length}
        <div class="shrink-0 border-t-[1.5px] border-soft-line px-3.5 py-1.5 text-[0.8em] text-red">
          {#each search.problems as problem (problem)}<p class="m-0 truncate" title={problem}>{problem}</p>{/each}
        </div>
      {/if}
      <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t-[1.5px] border-soft-line px-3.5 py-1.5 text-[0.75em] text-muted">
        <span>↑↓ to move · Enter to open · {shortcut} to close</span>
        {#if search.query.trim() && search.query.trim().length < TEXT_FROM}<span>Type {TEXT_FROM} letters to search what chats and files say</span>{/if}
        {#if search.unsearched}
          <span class="ml-auto"
            >{plural(search.unsearched, 'sandbox', 'sandboxes')} not connected: only {search.unsearched === 1 ? 'its' : 'their'} chats' titles are searched</span
          >
        {/if}
      </div>
    </div>
  {/if}
</dialog>
