<script lang="ts">
  // The sidebar beside the rail: the chats (or folders) of the sandbox chosen there, with what can
  // be done to it, or in Focus the chats of every sandbox. It folds (Ctrl/⌘+B) to give the tabs the
  // room; the rail stays. Through the tunnel its foot says how the page reaches the computers.
  import { tunnelConnectorId } from '../tunnel/connect.ts';
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import SandboxDialog from './SandboxDialog.svelte';
  import FileTree from './FileTree.svelte';
  import SessionList from './SessionList.svelte';
  import FocusList from './focus/FocusList.svelte';
  import { app, KEEP_PAGE } from './lib/app.svelte.ts';
  import { canStop, REACH_TEXT, statusText, workerTitle } from './lib/format.ts';
  import type { Worker } from './lib/api.ts';
  import { ELSEWHERE_COLOR, inRail, machineColor } from './lib/rail.ts';

  let {
    canFold = false,
    shortcut,
    onToggle,
    onNavigate
  }: { canFold?: boolean; shortcut: string; onToggle: () => void; onNavigate: () => void } = $props();

  const connectOnly = $derived(app.system?.capabilities.connectOnly ?? false);
  // Through the tunnel, adding sandboxes and quitting stay on the computer itself.
  const remote = tunnelConnectorId() !== undefined;
  // A sandbox's own page (`--server`): only it, nothing to start or add.
  const single = $derived(app.single);
  const focusing = $derived(app.route.view === 'focus');

  /** The sandbox's chats, or its folders, in place of them. */
  let showing: 'chats' | 'files' = $state('chats');
  const shows = [
    { id: 'chats', label: 'Chats', icon: 'comment-discussion', title: "The sandbox's chats" },
    { id: 'files', label: 'Files', icon: 'list-tree', title: 'The folders in the sandbox' }
  ] as const;

  const browsed = $derived(app.worker(app.browsing ?? undefined));
  /** Some sandbox is in the rail to choose. */
  const railed = $derived(app.workers.some((worker) => inRail(worker, app.machine(worker.id), app.browsing)));
  const browsable = (worker: Worker) => !!worker.url && worker.kind !== 'task';
  const color = (worker: Worker) =>
    worker.source === 'added' ? ELSEWHERE_COLOR : machineColor(app.machine(worker.id).key, app.machines.map((machine) => machine.key));
  /** Where the sandbox runs: its project or address, and its computer when there are several. */
  function place(worker: Worker): string {
    const where = workerTitle(worker)[1];
    if (worker.source === 'added') return where;
    return app.several ? [where, `on ${app.machine(worker.id).name}`].filter(Boolean).join(' ') : where;
  }

  let stopping = $state(false);
  async function stop(worker: Worker): Promise<void> {
    stopping = true;
    await app.workerApi(worker.id, '/stop', { body: {} }).catch(() => undefined);
    await app.refreshWorkers();
    stopping = false;
  }

  /** Whether the page stays on this computer's page instead of the newest computer's. */
  let keepPage = $state(stored(KEEP_PAGE) === 'true');
  function stored(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function setKeepPage(keep: boolean): void {
    keepPage = keep;
    try {
      localStorage.setItem(KEEP_PAGE, String(keep));
    } catch {
      // Not kept, e.g. in a private window.
    }
  }

  // The sandbox whose name, address or place in the list the user manages.
  let managing: Worker | null = $state(null);
</script>

{#snippet fold()}
  {#if canFold}
    <button
      class="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink"
      title="Hide the sidebar ({shortcut})"
      aria-label="Hide the sidebar"
      onclick={onToggle}
    >
      <span class="codicon codicon-chevron-left"></span>
    </button>
  {/if}
{/snippet}

<div class="flex h-full min-w-0 flex-1 flex-col bg-sunken">
  {#if focusing}
    <header class="flex items-center gap-2 px-4 pt-4 pb-2">
      <h2 class="m-0 font-display text-[1.15rem] font-medium">Focus</h2>
      <span class="text-[0.85em] text-muted">every sandbox</span>
      {@render fold()}
    </header>
    <FocusList {onNavigate} />
  {:else if browsed}
    {@const name = workerTitle(browsed)[0]}
    <header class="flex flex-col gap-1 px-4 pt-4 pb-3">
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="m-0 min-w-0 truncate font-display text-[1.15rem] font-medium" title={name}>{name}</h2>
        <span class="tag shrink-0 bg-soft-line text-muted">{statusText(browsed)}</span>
        {@render fold()}
      </div>
      <div class="flex min-w-0 items-center gap-1.5 text-[0.85em] text-muted">
        <span class="size-2.5 shrink-0 rounded-[3px]" style:background={color(browsed)}></span>
        <span class="truncate" title={place(browsed)}>{place(browsed)}</span>
      </div>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        {#if !single && canStop(browsed)}
          <button class="pill pill-small" disabled={stopping} onclick={() => stop(browsed)}>{stopping ? 'Stopping…' : 'Stop'}</button>
        {:else if browsed.status === 'stopping'}
          <button class="pill pill-small" disabled>Stopping…</button>
        {/if}
        {#if !single}
          <button class="pill pill-small" title="Rename, change its address or token, or remove it" onclick={() => (managing = browsed)}>Manage</button>
        {/if}
        <button
          class="pill pill-small"
          title="The sandbox: its chats, the agent's sign-in, and how to reach it from VS Code"
          onclick={() => (app.workbench.openOverview(browsed.id), onNavigate())}>Details</button
        >
      </div>
    </header>
    {#if browsable(browsed)}
      <div class="flex px-3 pb-2">
        <div class="flex flex-1 rounded-full border-[1.5px] border-soft-line bg-card p-0.5" role="tablist" aria-label="Show">
          {#each shows as show (show.id)}
            <button
              role="tab"
              aria-selected={showing === show.id}
              title={show.title}
              class="flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[0.85em] font-semibold pointer-coarse:py-1.5 {showing === show.id
                ? 'bg-indigo text-on-accent'
                : 'text-muted hover:text-ink'}"
              onclick={() => (showing = show.id)}
            >
              <span class="codicon codicon-{show.icon} text-[13px]!"></span>{show.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}
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
    <header class="flex items-center gap-2 px-4 pt-4 pb-2">
      <h2 class="m-0 font-display text-[1.15rem] font-medium">{railed ? 'Sandboxes' : app.workers.length ? 'No sandbox running' : 'No sandboxes yet'}</h2>
      {@render fold()}
    </header>
    <div class="flex min-h-0 flex-1 flex-col gap-3 px-4">
      {#if !app.listed}
        <div role="status" aria-label="Loading the sandboxes"><Skeleton lines={['60%', '40%']} height="0.75rem" /></div>
      {:else if railed}
        <p class="m-0 text-[0.9em] text-muted">Choose a sandbox in the rail to see its chats, or Focus for the chats of every sandbox.</p>
      {:else if !single}
        <p class="m-0 text-[0.9em] text-muted">
          {#if app.workers.length}
            {app.workers.length === 1 ? 'Your sandbox has' : `Your ${app.workers.length} sandboxes have`} stopped or {app.workers.length === 1 ? 'does' : 'do'} not
            answer; the computers button at the bottom of the rail lists them.
          {:else}
            A sandbox is where an agent works on a project.
          {/if}
          {connectOnly && !remote ? 'Connect one running elsewhere.' : 'Start one, or connect one running elsewhere.'}
        </p>
        <button class="pill pill-small pill-primary justify-center" onclick={() => (app.creating = { tab: connectOnly && !remote ? 'connect' : 'start' })}
          ><span class="codicon codicon-add"></span>New sandbox</button
        >
      {/if}
    </div>
  {/if}

  <footer class="flex flex-col gap-2 border-t-[1.5px] border-soft-line px-3 py-2.5">
    {#if remote}
      <!-- How this page reaches the computers. -->
      <div class="flex items-center gap-2.5" title="This page reaches your computers through the tunnel. It was loaded from {app.head.name}: {REACH_TEXT[app.head.reach]}">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-soft text-violet"><span class="codicon codicon-plug"></span></span>
        <span class="flex min-w-0 flex-1 flex-col leading-tight">
          <span class="text-[0.9em] font-semibold">Through the tunnel</span>
          <span class="truncate text-[0.8em] text-muted">page from {app.head.name || 'this computer'}</span>
        </span>
        <span class="size-2 shrink-0 rounded-full {app.head.reach === 'reachable' ? 'bg-green' : 'bg-orange'}"></span>
      </div>
      {#if app.several}
        <label class="flex items-center gap-2 text-[0.8em] text-muted" title="Otherwise the page opens from the computer with the newest code flower">
          <input type="checkbox" checked={keepPage} onchange={(event) => setKeepPage(event.currentTarget.checked)} />
          Keep {app.head.name}'s page
        </label>
      {/if}
    {:else}
      <div class="flex items-center gap-2 text-[0.8em] text-muted">
        {#if app.system?.version}<span>code flower {app.system.version}</span>{/if}
        <button class="link ml-auto" onclick={() => app.askToQuit()}>{single ? 'Stop the sandbox' : connectOnly ? 'Quit' : 'Stop all and quit'}</button>
      </div>
    {/if}
  </footer>
</div>

<SandboxDialog bind:worker={managing} />
