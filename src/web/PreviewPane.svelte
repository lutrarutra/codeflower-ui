<script lang="ts">
  // The sandbox's folders, and the files its agent showed or the user opened,
  // in tabs beside its chat. Tabs stay mounted while another is in front, so a draft or a report's
  // state survives switching.
  import PreviewView from '../chat/Preview.svelte';
  import { fileKind, kindIcon } from '../chat/lib/files.ts';
  import ReportFrame from './ReportFrame.svelte';
  import { app } from './lib/app.svelte.ts';
  import { FILES, INTERACTIVE } from './lib/previews.svelte.ts';
  import FileTree from './FileTree.svelte';

  let { workerId }: { workerId: string } = $props();
  const previews = app.previews;
  const items = $derived(previews.of(workerId));
  const tabs = $derived(previews.tabs(workerId));
  const active = $derived(previews.active[workerId]);
</script>

{#snippet tabButton(tab: string, icon: string, label: string, title: string)}
  <div
    class="group flex max-w-56 shrink-0 items-center rounded-t-lg border-[1.5px] border-b-0 {tab === active
      ? 'border-soft-line bg-card'
      : 'border-transparent text-muted hover:bg-soft-line/60'}"
  >
    <button class="flex min-w-0 items-center gap-1.5 py-1 pr-1 pl-2.5 text-left" {title} onclick={() => previews.activate(workerId, tab)}>
      <span class="codicon codicon-{icon} shrink-0 text-[13px]!"></span>
      <span class="truncate">{label}</span>
    </button>
    <button
      class="mr-1 grid size-5 shrink-0 place-items-center rounded opacity-60 group-hover:opacity-100 hover:bg-soft-line"
      aria-label="Close {label}"
      onclick={() => previews.close(workerId, tab)}
    >
      <span class="codicon codicon-close text-[12px]!"></span>
    </button>
  </div>
{/snippet}

<section class="flex h-full min-w-0 flex-col bg-paper" aria-label="Files">
  <nav class="flex items-stretch gap-0.5 overflow-x-auto border-b-[1.5px] border-soft-line px-1.5 pt-1.5" aria-label="Open files">
    {#each tabs as tab (tab)}
      {#if tab === FILES}
        {@render tabButton(tab, 'list-tree', 'Files', 'The folders in the sandbox')}
      {:else}
        {@const preview = previews.find(workerId, tab)}
        {#if preview}
          {@const interactive = tab.endsWith(INTERACTIVE)}
          {@render tabButton(
            tab,
            interactive ? 'play' : kindIcon[fileKind(preview.file.mimeType)],
            `${preview.title}${interactive ? ' (interactive)' : ''}`,
            preview.file.path
          )}
        {/if}
      {/if}
    {/each}
    <span class="flex-1"></span>
    <button
      class="mb-1 grid size-7 shrink-0 place-items-center self-center rounded-lg text-muted hover:bg-soft-line"
      title="Hide the files and show the chat"
      aria-label="Hide the files"
      onclick={() => (previews.hidden[workerId] = true)}
    >
      <span class="codicon codicon-layout-sidebar-right-off"></span>
    </button>
  </nav>
  <div class="relative min-h-0 flex-1">
    {#if previews.browsing[workerId]}
      <div class="absolute inset-0" class:invisible={active !== FILES}>
        <FileTree {workerId} />
      </div>
    {/if}
    {#each items as preview (preview.id)}
      <div class="absolute inset-0" class:invisible={active !== preview.id}>
        <PreviewView host={preview.host} />
      </div>
      {#if preview.interactive}
        <div class="absolute inset-0" class:invisible={active !== preview.id + INTERACTIVE}>
          <ReportFrame
            html={preview.html}
            title="{preview.title} (interactive)"
            onMessage={(message) => (message.type === 'send' ? preview.draft(message.text) : message.type === 'comments' && preview.saveComments(message.json))}
          />
        </div>
      {/if}
    {/each}
  </div>
</section>
