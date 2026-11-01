<script lang="ts">
  // Beside the chat in Focus: what its agent showed the user (`codeflower-show`) and the files
  // clicked in it, one at a time, the latest in front.
  import { untrack } from 'svelte';
  import PreviewView from '../../chat/Preview.svelte';
  import { app } from '../lib/app.svelte.ts';
  import { basename, displayPath } from '../lib/report.ts';
  import { chatTab, tabOf } from '../lib/workbench.svelte.ts';
  import ReportFrame from '../ReportFrame.svelte';

  let { workerId, chatKey, onCollapse }: { workerId: string; chatKey: string; onCollapse?: () => void } = $props();

  const agent = $derived(app.agent(workerId));
  const chat = $derived(agent.chats[chatKey]);
  const tab = $derived(tabOf(workerId, chatTab(chatKey)));
  /** The files, the latest last: those clicked in the chat, then those the agent showed. */
  const files = $derived.by(() => {
    const shown = chat?.shown ?? [];
    const opened = app.previews
      .of(workerId)
      .filter((preview) => preview.chatKey === chatKey && !shown.includes(preview.id))
      .map((preview) => preview.id);
    return [...opened, ...shown];
  });
  const path = $derived(app.focus.showing[tab] ?? files.at(-1));
  const preview = $derived(path ? app.previews.find(workerId, path) : undefined);

  // A file shown or clicked since comes to the front.
  let known: Set<string> | undefined;
  $effect(() => {
    const all = files;
    const at = tab;
    untrack(() => {
      const fresh = known ? all.filter((file) => !known!.has(file)) : [];
      if (fresh.length) app.focus.showing[at] = fresh.at(-1)!;
      known = new Set(all);
    });
  });

  // A file shown before the page loaded (or whose tab was closed) opens once picked.
  const tried = new Set<string>();
  $effect(() => {
    if (!path || preview || !agent.connected || tried.has(path)) return;
    const file = path;
    tried.add(file);
    untrack(() => void app.previews.openPath(agent, file, chatKey));
  });

  function pick(file: string): void {
    app.focus.showing[tab] = file;
  }
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Shown by the agent">
  <header class="flex items-center gap-1.5 border-b-[1.5px] border-soft-line px-2 py-1.5">
    <span class="codicon codicon-preview shrink-0 text-muted"></span>
    {#if files.length > 1}
      <select
        class="min-w-0 flex-1 truncate rounded-md border-[1.5px] border-soft-line bg-card px-1.5 py-0.5 text-[0.9em]"
        aria-label="Shown file"
        value={path}
        onchange={(event) => pick(event.currentTarget.value)}
      >
        {#each [...files].reverse() as file (file)}
          <option value={file} title={displayPath(file)}>{basename(file)}</option>
        {/each}
      </select>
      <span class="shrink-0 text-[0.8em] text-muted tabular-nums">{files.length}</span>
    {:else}
      <span class="min-w-0 flex-1 truncate text-[0.9em] font-semibold" title={path ? displayPath(path) : undefined}>{path ? basename(path) : 'Shown'}</span>
    {/if}
    {#if preview?.html}
      <button
        class="chip shrink-0"
        aria-pressed={preview.interactive}
        title={preview.interactive ? 'Show the report as a page, without running its scripts' : 'Run the report with its scripts'}
        onclick={() => (preview.interactive ? (preview.interactive = false) : app.previews.openInteractive(preview))}
      >
        <span class="codicon codicon-{preview.interactive ? 'code' : 'play'}"></span>{preview.interactive ? 'Static' : 'Interactive'}
      </button>
    {/if}
    {#if onCollapse}
      <button class="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-card hover:text-ink" title="Hide the pane" aria-label="Hide the pane" onclick={onCollapse}>
        <span class="codicon codicon-layout-sidebar-right-off"></span>
      </button>
    {/if}
  </header>
  <div class="min-h-0 flex-1">
    {#if preview && preview.interactive && preview.html}
      <ReportFrame
        html={preview.html}
        title="{preview.title} (interactive)"
        onMessage={(message) => (message.type === 'send' ? preview.draft(message.text) : message.type === 'comments' && preview.saveComments(message.json))}
      />
    {:else if preview}
      {#key preview}<PreviewView host={preview.host} />{/key}
    {:else if path}
      <p class="m-0 p-4 text-muted"><span class="spinner"></span> Opening {basename(path)}…</p>
    {:else}
      <div class="grid h-full place-items-center p-6 text-center text-muted">
        <div class="max-w-xs">
          <span class="codicon codicon-preview text-[28px]!"></span>
          <p class="mb-0">Nothing shown yet. When the agent shows a figure, a report or a table (<code>codeflower-show</code>), or you click a file in the chat, it opens here.</p>
        </div>
      </div>
    {/if}
  </div>
</section>
