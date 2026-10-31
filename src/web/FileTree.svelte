<script lang="ts">
  // A sandbox's folders, in the sidebar: where the agent works, and the
  // folders the user mounted. Folders list as they open; a file opens in a
  // tab beside the chat. Files and folders dropped on a writable folder, or
  // picked from its menu, are sent to it; a file, or a folder as a zip, is
  // saved from the menu (see lib/transfers.svelte.ts).
  import { untrack } from 'svelte';
  import { fileKind, formatSize, kindIcon } from '../chat/lib/files.ts';
  import { WORKSPACE, type DirectoryEntry, type Mount } from '../client/workerConnection.ts';
  import Transfers from './Transfers.svelte';
  import { app } from './lib/app.svelte.ts';
  import { ago, plural, short } from './lib/format.ts';
  import { chooseSink, droppedEntries, filesOfEntries, filesOfInput, transfers, type PickedFile } from './lib/transfers.svelte.ts';

  let { workerId, onOpen }: { workerId: string; onOpen: () => void } = $props();
  const worker = $derived(app.worker(workerId));
  const agent = $derived(app.agent(workerId));
  // With an older sandbox, connecting takes it over from a window that has it: ask first.
  const elsewhere = $derived(!!worker?.activity?.connected && !worker.activity.multiClient && worker.relays === 0);
  // Older sandboxes cannot send files to folders or save them.
  const canTransfer = $derived(agent.connected && !!agent.connection?.fileTransfers);

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

  type Listing = { entries: DirectoryEntry[]; truncated: boolean; writable?: boolean } | { error: string };
  let listings = $state<Record<string, Listing>>({});
  let open = $state<Record<string, boolean>>({ [WORKSPACE]: true });

  async function list(path: string): Promise<void> {
    try {
      const listing = await agent.connection!.listDirectory(path);
      listings[path] = { entries: listing.entries, truncated: listing.truncated, writable: listing.writable };
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
    if (pressed) return void (pressed = false);
    const chatKey = app.route.worker === workerId && app.route.session ? app.route.session : agent.chatFor()?.key;
    if (app.route.view !== 'chat') app.go({ view: 'chat' });
    void app.previews.openPath(agent, path, chatKey);
    onOpen();
  }

  /** Whether files may be sent to a folder: as its own listing says once open, else as its parent's said. */
  function writable(path: string, fallback: boolean): boolean {
    const listing = listings[path];
    return listing && !('error' in listing) && listing.writable !== undefined ? listing.writable : fallback;
  }

  const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

  // ---- sending files ----

  /** A problem to show above the tree, e.g. a drop with too many files. */
  let problem = $state('');
  let confirmDialog: HTMLDialogElement | undefined = $state();
  let pending = $state<{ dir: string; label: string; files: PickedFile[]; tooBig: PickedFile[]; clashes: string[] } | null>(null);

  /** Asks before sending: what goes where, and what to do with names that are taken. */
  async function prepare(dir: string, files: PickedFile[], label: string): Promise<void> {
    const connection = agent.connection;
    const limits = connection?.fileTransfers;
    if (!connection || !limits || !files.length) return;
    const tooBig = files.filter((picked) => picked.file.size > limits.upload.maxBytes);
    const sendable = files.filter((picked) => picked.file.size <= limits.upload.maxBytes);
    try {
      const existing = sendable.length ? await connection.filesExist(dir, sendable.map((picked) => picked.relativePath)) : [];
      pending = { dir, label, files: sendable, tooBig, clashes: existing.map((found) => found.path) };
      confirmDialog?.showModal();
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  async function send(conflict: 'number' | 'replace'): Promise<void> {
    confirmDialog?.close();
    const connection = agent.connection;
    if (!pending || !connection) return;
    const { dir, files, label } = pending;
    pending = null;
    await transfers.upload(connection, workerId, dir, files, conflict, label);
    open[dir] = true;
    if (agent.connected) void list(dir);
  }

  let dropTarget = $state<{ path: string; writable: boolean } | null>(null);
  const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');

  function dragOver(event: DragEvent, dir: string, canWrite: boolean): void {
    if (!canTransfer || !carriesFiles(event)) return;
    dropTarget = { path: dir, writable: canWrite };
    // Only writable folders take the drop; elsewhere the browser shows it cannot.
    if (canWrite) {
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
    }
  }

  function dragLeave(event: DragEvent): void {
    if (!(event.currentTarget as Node).contains(event.relatedTarget as Node | null)) dropTarget = null;
  }

  function drop(event: DragEvent, dir: string): void {
    event.preventDefault();
    dropTarget = null;
    // The drop's data is gone once the event is over.
    const entries = droppedEntries(event.dataTransfer!);
    if (!entries.length) return;
    const label = entries.length === 1 ? entries[0].name : plural(entries.length, 'item', 'items');
    filesOfEntries(entries).then(
      (files) => prepare(dir, files, label),
      (error: unknown) => (problem = error instanceof Error ? error.message : String(error))
    );
  }

  let filesInput: HTMLInputElement | undefined = $state();
  let folderInput: HTMLInputElement | undefined = $state();
  let pickTarget = '';
  // iOS has no folder picker.
  const pickFolders = typeof navigator !== 'undefined' && !/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

  function picked(input: HTMLInputElement): void {
    const list = input.files ? [...input.files] : [];
    input.value = '';
    if (!list.length) return;
    try {
      const files = filesOfInput(list);
      const folder = files[0]?.relativePath.includes('/') ? files[0].relativePath.split('/')[0] : '';
      void prepare(pickTarget, files, folder || (files.length === 1 ? files[0].relativePath : plural(files.length, 'file', 'files')));
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  // ---- the menu ----

  type Target = { path: string; type: 'file' | 'directory'; writable: boolean };
  let menu = $state<(Target & { x: number; y: number }) | null>(null);

  function openMenu(event: MouseEvent, target: Target): void {
    event.preventDefault();
    // From the keyboard (the menu key, Shift+F10) there is no pointer: place it at the row.
    const row = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    menu = { ...target, x: fromKeyboard ? row.left + 24 : event.clientX, y: fromKeyboard ? row.bottom : event.clientY };
  }

  // A long press opens the menu on touch screens that do not send `contextmenu` (iOS).
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;
  function pressStart(event: PointerEvent, target: Target): void {
    if (event.pointerType !== 'touch') return;
    const { clientX: x, clientY: y } = event;
    pressTimer = setTimeout(() => {
      pressed = true;
      menu = { ...target, x, y };
    }, 550);
  }
  function pressEnd(): void {
    clearTimeout(pressTimer);
  }

  function rowEvents(target: Target) {
    return {
      oncontextmenu: (event: MouseEvent) => openMenu(event, target),
      onpointerdown: (event: PointerEvent) => pressStart(event, target),
      onpointerup: pressEnd,
      onpointermove: pressEnd,
      onpointercancel: pressEnd
    };
  }

  function choose(action: 'files' | 'folder' | 'download' | 'copy'): void {
    const target = menu!;
    menu = null;
    if (action === 'files' || action === 'folder') {
      pickTarget = target.path;
      // In this click: browsers open their file picker only for one.
      (action === 'files' ? filesInput : folderInput)?.click();
    } else if (action === 'download') {
      const name = target.type === 'directory' ? `${baseName(target.path)}.zip` : baseName(target.path);
      // The save dialog needs this click too, so it opens before anything is asked of the sandbox.
      const sink = chooseSink(name);
      const connection = agent.connection;
      sink.then(
        (chosen) => chosen && connection && transfers.download(connection, workerId, target.path, chosen, name),
        (error: unknown) => (problem = error instanceof Error ? error.message : String(error))
      );
    } else {
      void navigator.clipboard?.writeText(target.path).catch(() => undefined);
    }
  }

  const ROW = 'flex w-full items-center gap-1.5 rounded-md py-0.5 pr-2 text-left hover:bg-soft-line/70';
  const MENU_ITEM = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-soft-line disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent';
</script>

{#snippet folder(path: string, label: string, depth: number, canWrite: boolean, icon = 'folder', note = '', title = path)}
  {@const here = writable(path, canWrite)}
  <li
    class="rounded-md"
    class:drop-ok={dropTarget?.path === path && dropTarget.writable}
    class:drop-refused={dropTarget?.path === path && !dropTarget.writable}
    ondragover={(event) => dragOver(event, path, here)}
    ondragleave={dragLeave}
    ondrop={(event) => drop(event, path)}
  >
    <button
      class={ROW}
      style="padding-left: {depth * 14 + 6}px"
      title={dropTarget?.path === path && !dropTarget.writable ? `${path}\nread-only: files cannot be sent here` : title}
      aria-expanded={!!open[path]}
      onclick={() => (pressed ? (pressed = false) : toggle(path))}
      {...rowEvents({ path, type: 'directory', writable: here })}
    >
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
              {@render folder(entry.path, entry.name, depth + 1, entry.writable ?? false)}
            {:else}
              <li>
                <button
                  class={ROW}
                  style="padding-left: {(depth + 1) * 14 + 22}px"
                  title="{entry.path}\n{formatSize(entry.size)} · {ago(entry.mtimeMs)}"
                  onclick={() => show(entry.path)}
                  {...rowEvents({ path: entry.path, type: 'file', writable: false })}
                >
                  <span class="codicon codicon-{entry.mimeType ? kindIcon[fileKind(entry.mimeType)] : 'file'} shrink-0 text-[14px]!"></span>
                  <span class="min-w-0 truncate">{entry.name}</span>
                  <span class="ml-auto hidden shrink-0 pl-2 text-[0.8em] text-muted @sm:inline">{formatSize(entry.size)} · {ago(entry.mtimeMs)}</span>
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
    !mount.readOnly,
    'folder',
    `${short(mount.source, app.system?.home)} · ${mount.readOnly ? 'read-only' : 'read-write'}`,
    `${mount.target}\nfrom ${mount.source}`
  )}
{/snippet}

<div class="@container flex h-full flex-col">
  <header class="flex items-center gap-2 pt-2 pr-2 pl-4">
    <span class="eyebrow flex-1 text-muted">Files in the sandbox</span>
    <button
      class="grid size-6 place-items-center rounded-md text-muted hover:bg-card hover:text-ink disabled:opacity-40 pointer-coarse:size-9"
      title="List the open folders again"
      aria-label="List the open folders again"
      disabled={!agent.connected}
      onclick={refresh}
    >
      <span class="codicon codicon-refresh"></span>
    </button>
  </header>
  {#if problem}
    <p class="mx-3 my-1 flex items-start gap-2 rounded-md bg-red/10 px-2 py-1 font-sans text-[0.85em] text-red" role="alert">
      <span class="min-w-0 flex-1">{problem}</span>
      <button class="shrink-0 text-muted hover:text-ink" aria-label="Dismiss" onclick={() => (problem = '')}>
        <span class="codicon codicon-close text-[12px]!"></span>
      </button>
    </p>
  {/if}
  <div class="min-h-0 flex-1 overflow-auto px-2 pb-2 font-mono text-[0.85em]">
    {#if agent.connected}
      <ul class="m-0 list-none p-0">
        {@render folder(WORKSPACE, 'Workspace', 0, true, 'root-folder', 'where the agent works')}
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
  <Transfers {workerId} />
</div>

<input bind:this={filesInput} type="file" multiple hidden onchange={(event) => picked(event.currentTarget)} />
<input bind:this={folderInput} type="file" webkitdirectory hidden onchange={(event) => picked(event.currentTarget)} />

<svelte:window
  onkeydown={(event) => event.key === 'Escape' && (menu = null)}
  onblur={() => (menu = null)}
  onresize={() => (menu = null)}
  ondragend={() => (dropTarget = null)}
/>

{#if menu}
  <!-- Closes the menu on a click anywhere else. -->
  <button
    class="fixed inset-0 z-40 cursor-default"
    aria-label="Close the menu"
    onclick={() => (menu = null)}
    oncontextmenu={(event) => (event.preventDefault(), (menu = null))}
  ></button>
  <div
    role="menu"
    aria-label={menu.type === 'directory' ? 'Folder' : 'File'}
    class="card fixed z-50 flex w-52 flex-col p-1 font-sans text-[0.9em]"
    style="left: {Math.min(menu.x, innerWidth - 216)}px; top: {Math.min(menu.y, innerHeight - 160)}px"
  >
    {#if menu.type === 'directory'}
      {#if canTransfer}
        <button role="menuitem" class={MENU_ITEM} disabled={!menu.writable} onclick={() => choose('files')}>
          <span class="codicon codicon-cloud-upload"></span>Upload files…
          {#if !menu.writable}<span class="ml-auto text-[0.85em] text-muted">read-only</span>{/if}
        </button>
        {#if pickFolders}
          <button role="menuitem" class={MENU_ITEM} disabled={!menu.writable} onclick={() => choose('folder')}>
            <span class="codicon codicon-file-directory-create"></span>Upload folder…
            {#if !menu.writable}<span class="ml-auto text-[0.85em] text-muted">read-only</span>{/if}
          </button>
        {/if}
        <button role="menuitem" class={MENU_ITEM} onclick={() => choose('download')}>
          <span class="codicon codicon-cloud-download"></span>Download as .zip…
        </button>
      {/if}
    {:else if canTransfer}
      <button role="menuitem" class={MENU_ITEM} onclick={() => choose('download')}>
        <span class="codicon codicon-cloud-download"></span>Download…
      </button>
    {/if}
    <button role="menuitem" class={MENU_ITEM} onclick={() => choose('copy')}>
      <span class="codicon codicon-copy"></span>Copy path
    </button>
  </div>
{/if}

<dialog bind:this={confirmDialog} aria-labelledby="send-title" onclose={() => (pending = null)}>
  {#if pending}
    {@const size = pending.files.reduce((sum, one) => sum + one.file.size, 0)}
    <div class="card flex max-w-md flex-col gap-3 p-5">
      <h2 id="send-title" class="m-0 font-display text-lg font-medium">Send to the sandbox?</h2>
      <p class="m-0">
        {plural(pending.files.length, 'file', 'files')} ({formatSize(size)}) to
        <code class="break-all">{pending.dir}</code>
      </p>
      {#if pending.tooBig.length}
        <p class="m-0 text-[0.9em] text-red">
          {plural(pending.tooBig.length, 'file is', 'files are')} larger than the sandbox takes and will be left out:
          {pending.tooBig.map((one) => one.relativePath).join(', ')}
        </p>
      {/if}
      {#if pending.clashes.length}
        <div class="flex flex-col gap-1">
          <p class="m-0 text-[0.9em]">These names are taken already:</p>
          <ul class="m-0 max-h-32 list-none overflow-auto rounded-md bg-soft-line/50 p-2 font-mono text-[0.85em]">
            {#each pending.clashes as clash (clash)}<li class="truncate">{clash}</li>{/each}
          </ul>
        </div>
      {/if}
      <footer class="flex flex-wrap justify-end gap-2">
        <button class="pill" onclick={() => confirmDialog?.close()}>Cancel</button>
        {#if pending.clashes.length}
          <button class="pill pill-pink" onclick={() => send('replace')}>Replace</button>
          <!-- svelte-ignore a11y_autofocus -->
          <button class="pill pill-primary" autofocus onclick={() => send('number')}>Keep both</button>
        {:else}
          <!-- svelte-ignore a11y_autofocus -->
          <button class="pill pill-primary" autofocus disabled={!pending.files.length} onclick={() => send('number')}>Send</button>
        {/if}
      </footer>
    </div>
  {/if}
</dialog>

<style>
  .drop-ok {
    outline: 1.5px dashed var(--color-indigo);
    background: color-mix(in srgb, var(--color-indigo) 8%, transparent);
  }
  .drop-refused {
    outline: 1.5px dashed var(--color-red);
  }
</style>
