<script lang="ts">
  import { tunnelConnectorId } from '../tunnel/connect.ts';
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import SandboxDialog from './SandboxDialog.svelte';
  import Tulip from '../chat/lib/Tulip.svelte';
  import FileTree from './FileTree.svelte';
  import ActivityChips from './lib/ActivityChips.svelte';
  import SessionList from './SessionList.svelte';
  import StatusDot from './lib/StatusDot.svelte';
  import { app, type View } from './lib/app.svelte.ts';
  import { SOURCE_TEXT, SOURCE_TITLE, workerTitle } from './lib/format.ts';
  import type { Worker } from './lib/api.ts';

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
  // Through the tunnel, adding sandboxes and quitting stay on the computer itself.
  const remote = tunnelConnectorId() !== undefined;
  // A sandbox's own page (`--server`): only it, nothing to start or add.
  const single = $derived(app.single);

  function show(view: View): void {
    app.go({ view });
    onNavigate();
  }

  /** The sandbox's chats, or its folders, in place of them. */
  let showing: 'chats' | 'files' = $state('chats');
  const shows = [
    { id: 'chats', label: 'Chats', icon: 'comment-discussion', title: "The sandbox's chats" },
    { id: 'files', label: 'Files', icon: 'list-tree', title: 'The folders in the sandbox' }
  ] as const;

  /** Lists the sandbox's chats; the drawer stays open to choose one. */
  function choose(id: string): void {
    app.browse(id);
    showing = 'chats';
  }

  /** The sandbox's folders, in the sidebar. */
  function files(worker: Worker): void {
    app.browse(worker.id);
    showing = 'files';
  }

  const browsed = $derived(app.worker(app.browsing ?? undefined));
  /** Other sandboxes have chats that finished or wait: the way back says so. */
  const othersNeed = $derived(app.attention.othersNeed(app.browsing));

  const browsable = (worker: Worker) => !!worker.url && worker.kind !== 'task';

  // The sandbox whose name, address or place in the list the user manages.
  let managing: Worker | null = $state(null);
  function manage(event: Event, worker: Worker): void {
    if (single) return;
    event.preventDefault();
    managing = worker;
  }
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
        {@const selected = app.browsing === worker.id}
        <li>
          <button
            class="relative grid size-9 place-items-center rounded-lg font-semibold uppercase {selected ? 'bg-card shadow-[0_0_0_1px_var(--cf-line)]' : 'text-muted hover:bg-card'}"
            aria-current={selected ? 'page' : undefined}
            aria-label="{name}, {where}"
            title="{name}, {where}{single ? '' : ' (right-click to manage)'}"
            onclick={() => {
              app.go({ view: 'chat', worker: worker.id });
              app.workbench.openOverview(worker.id);
            }}
            oncontextmenu={(event) => manage(event, worker)}
          >
            {name.slice(0, 1)}
            <span class="absolute right-1 bottom-1 flex"><StatusDot {worker} /></span>
            {#if app.attention.count(worker.id)}
              <span class="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-indigo ring-2 ring-sunken" title="Chats that finished or wait for you"></span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if !single && !remote}
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

    {#if browsed}
      {@const [name, where] = workerTitle(browsed)}
      <!-- One sandbox: its chats, and the way back to the others. -->
      <div class="flex items-center gap-1.5 px-2 pb-2">
        {#if !single}
          <button
            class="relative grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink pointer-coarse:size-10"
            title={othersNeed ? `All sandboxes: chats in ${othersNeed === 1 ? 'another one need' : `${othersNeed} others need`} you` : 'All sandboxes'}
            aria-label="All sandboxes"
            onclick={() => app.browse(null)}
          >
            <span class="codicon codicon-arrow-left"></span>
            {#if othersNeed}<span class="absolute top-1 right-1 size-2 rounded-full bg-indigo ring-2 ring-sunken"></span>{/if}
          </button>
        {/if}
        <button
          class="flex min-w-0 flex-1 flex-col rounded-lg px-1.5 py-0.5 text-left hover:bg-card {single ? 'ml-2' : ''}"
          title="The sandbox: its chats and sign-in"
          onclick={() => app.workbench.openOverview(browsed.id)}
          oncontextmenu={(event) => manage(event, browsed)}
        >
          <span class="flex w-full items-center gap-2">
            <StatusDot worker={browsed} />
            <span class="min-w-0 flex-1 truncate font-semibold">{name}</span>
          </span>
          <span class="truncate pl-[1.1rem] text-[0.85em] text-muted">{where}</span>
        </button>
        {#if !single}
          <button
            class="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-card hover:text-ink pointer-coarse:size-10"
            title="Rename, change its address or token, or remove it"
            aria-label="Manage {name}"
            onclick={(event) => manage(event, browsed)}
          >
            <span class="codicon codicon-settings-gear"></span>
          </button>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-1.5 px-4 pb-2">
        <ActivityChips worker={browsed} compact />
        {#if browsable(browsed)}
          <div class="ml-auto flex rounded-full border-[1.5px] border-soft-line bg-card p-0.5" role="tablist" aria-label="Show">
            {#each shows as show (show.id)}
              <button
                role="tab"
                aria-selected={showing === show.id}
                title={show.title}
                class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.8em] font-semibold pointer-coarse:py-1.5 {showing === show.id
                  ? 'bg-indigo text-on-accent'
                  : 'text-muted hover:text-ink'}"
                onclick={() => (showing = show.id)}
              >
                <span class="codicon codicon-{show.icon} text-[13px]!"></span>{show.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if showing === 'files' && browsable(browsed)}
        <div class="min-h-0 flex-1 border-t-[1.5px] border-soft-line">
          {#key browsed.id}<FileTree workerId={browsed.id} onOpen={onNavigate} />{/key}
        </div>
      {:else}
        <div class="min-h-0 flex-1 overflow-auto border-t-[1.5px] border-soft-line px-2 py-2">
          {#if browsed.url && browsed.kind !== 'task'}
            <SessionList worker={browsed} {onNavigate} />
          {:else if browsed.kind === 'task'}
            <p class="m-0 px-2 text-[0.9em] text-muted">This sandbox runs a task by itself and has no chat.</p>
          {:else}
            <p class="m-0 px-2 text-[0.9em] text-muted">The sandbox is not ready yet.</p>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="eyebrow px-4 pb-1 text-muted">{single ? 'Sandbox' : 'Sandboxes'}</div>
      <!-- Padded, so the selected row's outline is not clipped by the scrolling list. -->
      <ul class="m-0 min-h-0 flex-1 list-none overflow-auto px-2 py-1">
        {#each app.workers as worker (worker.id)}
          {@const [name, where] = workerTitle(worker)}
          {@const selected = app.browsing === worker.id}
          {@const needs = app.attention.count(worker.id)}
          <li>
            <div class="group relative">
              <button
                class="flex w-full flex-col gap-1 rounded-xl px-2.5 py-2 text-left {selected ? 'bg-card shadow-[0_0_0_1px_var(--cf-line)]' : 'hover:bg-card'}"
                aria-current={selected ? 'page' : undefined}
                onclick={() => choose(worker.id)}
                oncontextmenu={(event) => manage(event, worker)}
              >
                <span class="flex w-full items-center gap-2 {single ? '' : 'pr-6'}">
                  <StatusDot {worker} />
                  <span class="min-w-0 flex-1 truncate font-semibold">{name}</span>
                  {#if needs}
                    <span class="tag bg-indigo text-on-accent" title="{needs} {needs === 1 ? 'chat' : 'chats'} finished or {needs === 1 ? 'waits' : 'wait'} for you">{needs}</span>
                  {/if}
                  <span class="tag bg-soft-line text-muted" title={SOURCE_TITLE[worker.source]}>{SOURCE_TEXT[worker.source]}</span>
                </span>
                <span class="truncate pl-[1.1rem] text-[0.85em] text-muted">{where}</span>
                <span class="pl-[1.1rem] {browsable(worker) ? 'pr-16' : ''}"><ActivityChips {worker} compact /></span>
              </button>
              {#if !single}
                <button
                  class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100 {selected
                    ? 'opacity-100'
                    : ''}"
                  title="Rename, change its address or token, or remove it"
                  aria-label="Manage {name}"
                  onclick={(event) => manage(event, worker)}
                >
                  <span class="codicon codicon-settings-gear"></span>
                </button>
              {/if}
              {#if browsable(worker)}
                <button class="chip absolute right-2 bottom-2" title="Browse the folders in the sandbox" onclick={() => files(worker)}>
                  <span class="codicon codicon-list-tree"></span>Files
                </button>
              {/if}
            </div>
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
    {/if}

    <div class="flex flex-col gap-2 border-t-[1.5px] border-soft-line p-3">
      {#if !single && !remote}
        <button class="pill pill-small justify-center" onclick={onAdd}><span class="codicon codicon-add"></span>Add remote sandbox</button>
      {/if}
      {#if !remote}
        <button class="link self-center text-[0.85em]" onclick={() => app.askToQuit()}>{single ? 'Stop the sandbox' : connectOnly ? 'Quit' : 'Stop all and quit'}</button>
      {/if}
    </div>
  </nav>
{/if}

<SandboxDialog bind:worker={managing} />
