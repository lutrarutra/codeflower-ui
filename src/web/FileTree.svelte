<script lang="ts">
  // A sandbox's folders: where the agent works, and the folders the user
  // mounted. Folders list as they open; a file opens in a tab beside it.
  import { untrack } from 'svelte';
  import { fileKind, formatSize, kindIcon } from '../chat/lib/files.ts';
  import { WORKSPACE, type DirectoryEntry, type Mount } from '../client/workerConnection.ts';
  import { app } from './lib/app.svelte.ts';
  import { ago, short } from './lib/format.ts';

  let { workerId }: { workerId: string } = $props();
  const worker = $derived(app.worker(workerId));
  const agent = $derived(app.agent(workerId));
  // With an older sandbox, connecting takes it over from a window that has it: ask first.
  const elsewhere = $derived(!!worker?.activity?.connected && !worker.activity.multiClient && worker.relays === 0);

  /** The app mounts each of the user's folders in a subfolder of one of these. */
  const GROUPS = [
    { root: '/data/input', label: 'Inputs', icon: 'database' },
    { root: '/data/output', label: 'Outputs', icon: 'output' },
    { root: '/data/code', label: 'Code', icon: 'code' },
    { root: '/data/skills', label: 'Skills', icon: 'lightbulb' }
  ];

  const groups = $derived.by(() => {
    const mounts = agent.status?.mounts ?? [];
    const grouped = GROUPS.map((group) => ({ ...group, mounts: mounts.filter((mount) => mount.target.startsWith(`${group.root}/`)) }));
    const other = mounts.filter((mount) => !GROUPS.some((group) => mount.target.startsWith(`${group.root}/`)));
    return [...grouped.filter((group) => group.mounts.length), ...(other.length ? [{ root: '', label: 'Other', icon: 'folder-library', mounts: other }] : [])];
  });

  type Listing = { entries: DirectoryEntry[]; truncated: boolean } | { error: string };
  let listings = $state<Record<string, Listing>>({});
  let open = $state<Record<string, boolean>>({ [WORKSPACE]: true });

  async function list(path: string): Promise<void> {
    try {
      const listing = await agent.connection!.listDirectory(path);
      listings[path] = { entries: listing.entries, truncated: listing.truncated };
    } catch (error) {
      listings[path] = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  function toggle(path: string): void {
    open[path] = !open[path];
    if (open[path] && !listings[path] && agent.connected) void list(path);
  }

  /** Lists every open folder again. */
  function refresh(): void {
    for (const path of Object.keys(open)) if (open[path]) void list(path);
  }

  // Connected (here or by a chat): list what is open; else connect, unless another window has the sandbox.
  $effect(() => {
    if (agent.state === 'connected') untrack(refresh);
    else if (agent.state === 'idle' && !elsewhere) untrack(() => void agent.connect().catch(() => undefined));
  });

  function show(path: string): void {
    const chatKey = app.route.worker === workerId && app.route.session ? app.route.session : agent.chatFor()?.key;
    void app.previews.openPath(agent, path, chatKey);
  }

  const ROW = 'flex w-full items-center gap-1.5 rounded-md py-0.5 pr-2 text-left hover:bg-soft-line/70';
</script>

{#snippet folder(path: string, label: string, depth: number, icon = 'folder', note = '', title = path)}
  <li>
    <button class={ROW} style="padding-left: {depth * 14 + 6}px" {title} aria-expanded={!!open[path]} onclick={() => toggle(path)}>
      <span class="codicon codicon-chevron-{open[path] ? 'down' : 'right'} shrink-0 text-[12px]! text-muted"></span>
      <span class="codicon codicon-{icon} shrink-0 text-[14px]!"></span>
      <span class="max-w-[70%] shrink-0 truncate">{label}</span>
      {#if note}<span class="min-w-0 truncate text-[0.8em] text-muted">{note}</span>{/if}
    </button>
    {#if open[path]}
      {@const listing = listings[path]}
      <ul class="m-0 list-none p-0">
        {#if !listing}
          <li class="py-0.5 text-[0.85em] text-muted" style="padding-left: {(depth + 1) * 14 + 24}px"><span class="spinner"></span> Loading…</li>
        {:else if 'error' in listing}
          <li class="py-0.5 text-[0.85em] text-red" style="padding-left: {(depth + 1) * 14 + 24}px">{listing.error}</li>
        {:else}
          {#each listing.entries as entry (entry.path)}
            {#if entry.type === 'directory'}
              {@render folder(entry.path, entry.name, depth + 1)}
            {:else}
              <li>
                <button class={ROW} style="padding-left: {(depth + 1) * 14 + 22}px" title={entry.path} onclick={() => show(entry.path)}>
                  <span class="codicon codicon-{entry.mimeType ? kindIcon[fileKind(entry.mimeType)] : 'file'} shrink-0 text-[14px]!"></span>
                  <span class="min-w-0 truncate">{entry.name}</span>
                  <span class="ml-auto shrink-0 pl-2 text-[0.8em] text-muted">{formatSize(entry.size)} · {ago(entry.mtimeMs)}</span>
                </button>
              </li>
            {/if}
          {:else}
            <li class="py-0.5 text-[0.85em] text-muted" style="padding-left: {(depth + 1) * 14 + 24}px">Empty</li>
          {/each}
          {#if listing.truncated}
            <li class="py-0.5 text-[0.85em] text-muted" style="padding-left: {(depth + 1) * 14 + 24}px">More files not shown</li>
          {/if}
        {/if}
      </ul>
    {/if}
  </li>
{/snippet}

{#snippet mounted(mount: Mount, root: string, depth: number)}
  {@render folder(
    mount.target,
    root ? mount.target.slice(root.length + 1) : mount.target,
    depth,
    'folder',
    `${short(mount.source, app.system?.home)} · ${mount.readOnly ? 'read-only' : 'read-write'}`,
    `${mount.target}\nfrom ${mount.source}`
  )}
{/snippet}

<div class="flex h-full flex-col">
  <header class="flex items-center gap-2 border-b-[1.5px] border-soft-line px-4 py-2">
    <h2 class="m-0 flex-1 font-display text-[1.05rem] font-medium">Files in the sandbox</h2>
    <button class="chip" title="List the open folders again" disabled={!agent.connected} onclick={refresh}>
      <span class="codicon codicon-refresh"></span> Refresh
    </button>
  </header>
  <div class="min-h-0 flex-1 overflow-auto px-2 py-2 font-mono text-[0.85em]">
    {#if agent.connected}
      <ul class="m-0 list-none p-0">
        {@render folder(WORKSPACE, 'Workspace', 0, 'root-folder', 'where the agent works')}
        {#each groups as group (group.label)}
          <li>
            <div class="flex items-center gap-1.5 px-1.5 pt-2 pb-0.5 font-sans text-[0.85em] font-semibold tracking-wide text-muted uppercase">
              <span class="codicon codicon-{group.icon} text-[13px]!"></span>{group.label}
              {#if group.root}<span class="font-mono font-normal tracking-normal normal-case">{group.root}</span>{/if}
            </div>
            <ul class="m-0 list-none p-0">
              {#each group.mounts as mount (mount.target)}
                {@render mounted(mount, group.root, 0)}
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {:else if agent.state === 'connecting'}
      <p class="m-0 px-2 font-sans text-muted"><span class="spinner"></span> Connecting to the sandbox…</p>
    {:else}
      <div class="flex flex-col items-start gap-2 px-2 font-sans">
        <p class="m-0 text-muted">
          {agent.state === 'taken-over' || elsewhere
            ? 'This sandbox is open in another window, e.g. VS Code. Browsing its files here moves it to this page; the other window can take it back.'
            : `Could not reach the sandbox${agent.error ? `: ${agent.error}` : ''}.`}
        </p>
        <button class="pill pill-small pill-primary" onclick={() => void agent.takeBack().catch(() => undefined)}>
          {agent.state === 'taken-over' || elsewhere ? 'Open here' : 'Try again'}
        </button>
      </div>
    {/if}
  </div>
</div>
