<script lang="ts">
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import Tulip from '../chat/lib/Tulip.svelte';
  import ActivityChips from './lib/ActivityChips.svelte';
  import SessionList from './SessionList.svelte';
  import StatusDot from './lib/StatusDot.svelte';
  import { app, type View } from './lib/app.svelte.ts';
  import { SOURCE_TEXT, SOURCE_TITLE, workerTitle } from './lib/format.ts';
  import type { Worker } from './lib/api.ts';
  import { FILES } from './lib/previews.svelte.ts';
  import { endDrag, startDrag } from './lib/workbench.svelte.ts';

  let {
    collapsed = false,
    canCollapse = false,
    onToggle,
    onAdd,
    onNavigate
  }: { collapsed?: boolean; canCollapse?: boolean; onToggle: () => void; onAdd: () => void; onNavigate: () => void } = $props();
  const shortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B';

  const views: { id: View; label: string; icon: string }[] = [
    { id: 'chat', label: 'Chat', icon: 'comment-discussion' },
    { id: 'server', label: 'Server', icon: 'server-process' }
  ];
  const connectOnly = $derived(app.system?.capabilities.connectOnly ?? false);
  // A sandbox's own page (`--server`): only it, nothing to start or add.
  const single = $derived(app.single);

  function show(view: View): void {
    app.go({ view, worker: app.route.worker });
    onNavigate();
  }

  function choose(id: string): void {
    app.go({ view: 'chat', worker: id });
    onNavigate();
  }

  /** The sandbox's folders, beside the chat that is open. */
  function files(worker: Worker): void {
    app.go({ view: 'chat', worker: worker.id, ...(app.route.worker === worker.id && app.route.session ? { session: app.route.session } : {}) });
    app.previews.browse(worker.id);
    onNavigate();
  }

  const browsable = (worker: Worker) => !!worker.url && worker.kind !== 'task';
</script>

{#if collapsed}
  <!-- Folded: a rail of the views and the sandboxes, by their status. -->
  <nav class="flex h-full flex-col items-center gap-1 border-r-[1.5px] border-soft-line bg-sunken py-3" aria-label="Sandboxes">
    <button class="grid size-9 place-items-center rounded-lg hover:bg-card" title="Expand the sidebar ({shortcut})" aria-label="Expand the sidebar" onclick={onToggle}>
      <Tulip size={24} />
    </button>
    {#if !single}
      <div class="my-1 flex flex-col gap-1" role="tablist" aria-label="View">
        {#each views as view (view.id)}
          <button
            role="tab"
            aria-selected={app.route.view === view.id}
            aria-label={view.label}
            title={view.label}
            class="grid size-9 place-items-center rounded-lg {app.route.view === view.id ? 'bg-indigo text-on-accent' : 'text-muted hover:bg-card hover:text-ink'}"
            onclick={() => show(view.id)}
          >
            <span class="codicon codicon-{view.icon}"></span>
          </button>
        {/each}
      </div>
    {/if}
    <ul class="m-0 flex min-h-0 w-full flex-1 list-none flex-col items-center gap-1 overflow-auto border-t-[1.5px] border-soft-line p-0 pt-2">
      {#each app.workers as worker (worker.id)}
        {@const [name, where] = workerTitle(worker)}
        {@const selected = app.route.view === 'chat' && app.route.worker === worker.id}
        <li>
          <button
            class="relative grid size-9 place-items-center rounded-lg font-semibold uppercase {selected ? 'bg-card shadow-[0_0_0_1px_var(--cf-line)]' : 'text-muted hover:bg-card'}"
            aria-current={selected ? 'page' : undefined}
            aria-label="{name}, {where}"
            title="{name}, {where}"
            onclick={() => choose(worker.id)}
          >
            {name.slice(0, 1)}
            <span class="absolute right-1 bottom-1 flex"><StatusDot {worker} /></span>
          </button>
        </li>
      {/each}
    </ul>
    {#if !single}
      <button class="grid size-9 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink" title="Add remote sandbox" aria-label="Add remote sandbox" onclick={onAdd}>
        <span class="codicon codicon-add"></span>
      </button>
    {/if}
    <button class="grid size-9 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink" title="Expand the sidebar ({shortcut})" aria-label="Expand the sidebar" onclick={onToggle}>
      <span class="codicon codicon-layout-sidebar-left"></span>
    </button>
  </nav>
{:else}
  <nav class="flex h-full flex-col border-r-[1.5px] border-soft-line bg-sunken" aria-label="Sandboxes">
    <header class="flex items-center gap-2.5 px-4 pt-4 pb-3">
      <Tulip size={30} />
      <div class="min-w-0">
        <div class="font-display text-[1.15rem] leading-tight font-medium">code flower</div>
        {#if app.system?.version}<div class="text-[0.75em] text-muted">{app.system.version}</div>{/if}
      </div>
      {#if canCollapse}
        <button
          class="ml-auto grid size-7 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink"
          title="Collapse the sidebar ({shortcut})"
          aria-label="Collapse the sidebar"
          onclick={onToggle}
        >
          <span class="codicon codicon-layout-sidebar-left-off"></span>
        </button>
      {/if}
    </header>

    {#if !single}
      <div class="mx-4 mb-3 grid grid-cols-2 gap-1 rounded-full border-[1.5px] border-soft-line bg-card p-1" role="tablist" aria-label="View">
        {#each views as view (view.id)}
          <button
            role="tab"
            aria-selected={app.route.view === view.id}
            class="flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[0.9em] font-semibold {app.route.view === view.id
              ? 'bg-indigo text-on-accent'
              : 'text-muted hover:text-ink'}"
            onclick={() => show(view.id)}
          >
            <span class="codicon codicon-{view.icon}"></span>{view.label}
          </button>
        {/each}
      </div>
    {/if}

    <div class="eyebrow px-4 pb-1 text-muted">{single ? 'Sandbox' : 'Sandboxes'}</div>
    <!-- Padded, so the selected row's outline is not clipped by the scrolling list. -->
    <ul class="m-0 min-h-0 flex-1 list-none overflow-auto px-2 py-1">
      {#each app.workers as worker (worker.id)}
        {@const [name, where] = workerTitle(worker)}
        {@const selected = app.route.view === 'chat' && app.route.worker === worker.id}
        <li>
          <div class="relative">
            <button
              class="flex w-full flex-col gap-1 rounded-xl px-2.5 py-2 text-left {selected ? 'bg-card shadow-[0_0_0_1px_var(--cf-line)]' : 'hover:bg-card'}"
              aria-current={selected ? 'page' : undefined}
              onclick={() => choose(worker.id)}
            >
              <span class="flex w-full items-center gap-2">
                <StatusDot {worker} />
                <span class="min-w-0 flex-1 truncate font-semibold">{name}</span>
                <span class="tag bg-soft-line text-muted" title={SOURCE_TITLE[worker.source]}>{SOURCE_TEXT[worker.source]}</span>
              </span>
              <span class="truncate pl-[1.1rem] text-[0.85em] text-muted">{where}</span>
              <span class="pl-[1.1rem] {browsable(worker) ? 'pr-16' : ''}"><ActivityChips {worker} compact /></span>
            </button>
            {#if browsable(worker)}
              <button
                class="chip absolute right-2 bottom-2"
                title="Browse the folders in the sandbox beside the chat; or drag it into the grid"
                draggable="true"
                ondragstart={(event) => startDrag(event, worker.id, FILES, 'Files')}
                ondragend={endDrag}
                onclick={() => files(worker)}
              >
                <span class="codicon codicon-list-tree"></span>Files
              </button>
            {/if}
          </div>
          {#if selected && worker.url && worker.kind !== 'task'}
            <SessionList {worker} {onNavigate} />
          {/if}
        </li>
      {:else}
        {#if !app.listed}
          <li class="flex flex-col gap-2 rounded-xl px-2.5 py-2.5" role="status" aria-label="Loading the sandboxes">
            <Skeleton lines={['60%', '40%']} height="0.75rem" />
          </li>
        {:else}
          <li class="px-2.5 py-2 text-[0.9em] text-muted">
            No sandboxes yet. {connectOnly ? 'Add one running elsewhere.' : 'Start one under Server, or add one running elsewhere.'}
          </li>
        {/if}
      {/each}
    </ul>

    <div class="flex flex-col gap-2 border-t-[1.5px] border-soft-line p-3">
      {#if !single}
        <button class="pill pill-small justify-center" onclick={onAdd}><span class="codicon codicon-add"></span>Add remote sandbox</button>
      {/if}
      <button class="link self-center text-[0.85em]" onclick={() => app.askToQuit()}>{single ? 'Stop the sandbox' : connectOnly ? 'Quit' : 'Stop all and quit'}</button>
    </div>
  </nav>
{/if}
