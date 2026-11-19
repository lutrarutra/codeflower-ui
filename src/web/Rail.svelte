<script lang="ts">
  // The rail, beside the page also with the sidebar folded: Focus, then the sandboxes that run, by
  // the computer they run on, then + for a new chat (in a sandbox chosen there, or a new one). A computer that can start sandboxes shows even
  // with none. Computers that do not answer and sandboxes that stopped stay off it: the computers
  // button at the bottom (the Server view) lists them, and says that some are hidden.
  // With the sidebar folded, the rail also reaches the chats: the sandbox in front unfolds into a
  // numbered tile per chat that works, waits or finished unseen (or
  // the latest three, with none of those), the rest behind "…", and in Focus the chats of the list take the top (Alt+1…9).
  import { untrack } from 'svelte';
  import Tulip from '../chat/lib/Tulip.svelte';
  import NewChatDialog from './NewChatDialog.svelte';
  import SandboxDialog from './SandboxDialog.svelte';
  import StatusDot from './lib/StatusDot.svelte';
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import { chatStatus } from './lib/focusList.ts';
  import { plural, statusText, WAITING_FOR, workerTitle } from './lib/format.ts';
  import type { Machine } from './lib/machines.svelte.ts';
  import { badge, ELSEWHERE_COLOR, inRail, machineColor, startState, stopped } from './lib/rail.ts';
  import { age, PHASE_DOT } from './focus/phase.ts';

  let {
    canFold = false,
    folded = false,
    shortcut,
    searchShortcut,
    onToggle,
    onNavigate,
    onSearch
  }: {
    canFold?: boolean;
    folded?: boolean;
    shortcut: string;
    searchShortcut: string;
    onToggle: () => void;
    onNavigate: () => void;
    onSearch: () => void;
  } = $props();

  const single = $derived(app.single);
  const keys = $derived(app.machines.map((machine) => machine.key));
  const focusing = $derived(app.route.view === 'focus');
  /** The sandbox in front: Focus's chat's, else the one the sidebar lists. */
  const current = $derived(focusing ? app.focus.selected?.workerId : app.route.view === 'chat' ? app.browsing : undefined);

  const answers = (machine: Machine) => machine.reach === 'reachable' || machine.reach === 'loading';
  const shown = (worker: Worker) => inRail(worker, app.machine(worker.id), app.browsing);

  interface Group {
    key: string;
    name: string;
    /** Named above its sandboxes: with one computer, its color says enough. */
    labeled: boolean;
    color: string;
    workers: Worker[];
    /** Whether a sandbox can start there: a + under its sandboxes when there are none, among several computers. */
    start?: 'ok' | 'locked';
  }
  const groups: Group[] = $derived.by(() => {
    const list: Group[] = [];
    for (const machine of app.machines) {
      const workers = machine.workers.filter((worker) => worker.source !== 'added' && shown(worker));
      const state = startState(machine);
      const start = app.several && (state === 'ok' || state === 'locked') ? state : undefined;
      if (!workers.length && !start) continue;
      list.push({ key: machine.key, name: machine.name || 'This computer', labeled: app.several, color: machineColor(machine.key, keys), workers, start });
    }
    // Added by their line: they run on none of the page's computers.
    const elsewhere = app.workers.filter((worker) => worker.source === 'added' && shown(worker));
    if (elsewhere.length) list.push({ key: 'elsewhere', name: 'Elsewhere', labeled: true, color: ELSEWHERE_COLOR, workers: elsewhere });
    return list;
  });

  const needs = $derived(app.workers.reduce((sum, worker) => sum + app.attention.count(worker.id), 0));
  const hidden = $derived(app.workers.filter((worker) => !shown(worker)).length);
  const quiet = $derived(app.machines.filter((machine) => !answers(machine)));
  const computers = $derived(
    [
      'Computers and every sandbox',
      ...quiet.map((machine) => `${machine.name || 'This computer'} is not answering`),
      ...(hidden ? [`${plural(hidden, 'sandbox', 'sandboxes')} not shown here`] : [])
    ].join('\n')
  );

  function create(key?: string): void {
    app.creating = { tab: 'start', machine: key ?? (app.browsing ? app.machine(app.browsing).key : undefined) };
  }

  /** Out of Focus into the editor: Focus's chat opens there in front of its group, else the chats as they were. */
  function toEditor(): void {
    const chat = app.focus.selected;
    app.go(chat ? { view: 'chat', worker: chat.workerId, session: chat.key } : { view: 'chat' });
    onNavigate();
  }

  /** The sandbox or chat under the pointer: its name and what it does, beside the rail. */
  let tip = $state<{ x: number; y: number; lines: string[] } | null>(null);
  function tipAt(event: Event, lines: string[]): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tip = { x: box.right + 10, y: box.top, lines };
  }
  function showTip(event: Event, worker: Worker): void {
    const [name, where] = workerTitle(worker);
    const count = app.attention.count(worker.id);
    tipAt(event, [
      name,
      [where, app.several || worker.source === 'added' ? `on ${worker.source === 'added' ? 'its own computer' : app.machine(worker.id).name}` : ''].filter(Boolean).join(' · '),
      count ? `${statusText(worker)} · ${count} need${count === 1 ? 's' : ''} you` : statusText(worker)
    ]);
  }

  /** A chat the folded rail offers: a tile, numbered for Alt+1…9. */
  interface Tile {
    id: string;
    /** Its number, for Alt+1…9. */
    label: string;
    title: string;
    /** The dot's color class, if the chat does something. */
    dot?: string;
    working: boolean;
    current: boolean;
    lines: string[];
    open: () => void;
    /** In Focus: the list's group, which a line separates; and the sandbox's computer's color. */
    group?: string;
    color?: string;
  }
  const TILES = 6;
  /** With none working, waiting or finished unseen: the latest chats the rail shows. */
  const RECENT = 3;
  const SESSION_DOT: Record<string, string> = { working: 'bg-cyan', waiting: 'bg-orange', done: 'bg-indigo' };
  const SESSION_TEXT: Record<string, string> = { working: 'Working', waiting: 'Waiting for you', done: 'Finished while you were elsewhere' };
  const key = (index: number) => (index < 9 ? `Alt+${index + 1}` : '');

  // Folded, the sidebar does not list the sandbox's chats: the rail reads them.
  const browsed = $derived(folded && !focusing && current ? app.worker(current) : undefined);
  const chatsKnown = (worker: Worker) => !!worker.url && worker.kind !== 'task';
  $effect(() => {
    const worker = browsed;
    if (!worker || !chatsKnown(worker)) return;
    void worker.activity?.chats.length;
    untrack(() => void app.agent(worker.id).listSessions());
  });

  /** One of the sandbox in front's chats, as a tile; numbered (index) when the rail shows it. */
  function chatTile(worker: Worker, session: { key: string; title?: string | null; updatedAt?: string | null }, index?: number): Tile & { active: boolean } {
    const agent = app.agent(worker.id);
    const busy = worker.activity?.chats.find((chat) => chat.key === session.key);
    const status = chatStatus(agent.chats[session.key]?.status, busy, agent.chats[session.key]?.backgroundWork);
    const active = status === 'working' || status === 'waiting';
    const state = active ? status : app.attention.need(worker.id, session.key) ? 'done' : undefined;
    const title = session.title || 'Untitled chat';
    const updated = session.updatedAt ? `changed ${age(Date.now() - Date.parse(session.updatedAt))} ago` : '';
    const shown = app.route.worker === worker.id ? app.route.session : undefined;
    return {
      id: session.key,
      label: index === undefined ? '' : String(index + 1),
      title,
      dot: state && SESSION_DOT[state],
      working: status === 'working',
      current: app.route.view === 'chat' && session.key === shown,
      active: !!state,
      lines: [title, [state ? SESSION_TEXT[state] : '', updated].filter(Boolean).join(' · '), index === undefined ? '' : key(index)],
      open: () => (app.go({ view: 'chat', worker: worker.id, session: session.key }), onNavigate())
    };
  }

  /**
   * The sandbox in front's chats, split: the rail shows those that work, wait or finished unseen
   * (or, with none of those, the latest few), and the one open; "…" lists the rest.
   */
  const chatSplit = $derived.by(() => {
    const worker = browsed;
    if (!worker || !chatsKnown(worker)) return { tiles: [] as Tile[], rest: [] as Tile[] };
    const sessions = app.agent(worker.id).sessions;
    const all = sessions.map((session) => chatTile(worker, session));
    const active = all.some((tile) => tile.active);
    const shown = (tile: Tile & { active: boolean }, index: number) => tile.current || (active ? tile.active : index < RECENT);
    return {
      tiles: sessions.filter((_, index) => shown(all[index]!, index)).map((session, index) => chatTile(worker, session, index)),
      rest: all.filter((tile, index) => !shown(tile, index))
    };
  });
  const chatTiles = $derived(chatSplit.tiles);
  const moreChats = $derived(chatSplit.rest);

  /** The "…" menu of the chats the rail does not show: where it opens, beside the rail. */
  let more = $state<{ x: number; y: number } | null>(null);
  let moreList: HTMLElement | undefined = $state();
  function toggleMore(event: Event): void {
    if (more) return void (more = null);
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    more = { x: box.right + 10, y: Math.max(8, Math.min(box.top, window.innerHeight - 8 - Math.min(moreChats.length * 34 + 16, window.innerHeight * 0.6))) };
    tip = null;
    queueMicrotask(() => moreList?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }
  function moreKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      more = null;
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(moreList?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
  $effect(() => {
    if (!moreChats.length) more = null;
  });

  /** In Focus: its list's chats, in its order. */
  const queue = $derived(folded && focusing ? app.focus.groups.flatMap((group) => group.chats.map((chat) => ({ chat, group }))) : []);
  const queueTiles: Tile[] = $derived(
    queue.slice(0, TILES + 3).map(({ chat, group }, index) => {
      const worker = app.worker(chat.workerId);
      const selected = app.focus.selected?.workerId === chat.workerId && app.focus.selected.key === chat.key;
      const phase = group.id === 'done' ? 'done' : chat.phase;
      const color = !worker ? ELSEWHERE_COLOR : worker.source === 'added' ? ELSEWHERE_COLOR : machineColor(app.machine(worker.id).key, keys);
      return {
        id: `${chat.workerId}/${chat.key}`,
        label: String(index + 1),
        title: chat.title || 'Untitled chat',
        dot: phase === 'idle' ? undefined : PHASE_DOT[phase],
        working: chat.phase === 'working',
        current: selected,
        group: group.id,
        color,
        lines: [
          chat.title || 'Untitled chat',
          [chat.sandbox, group.id === 'idle' ? '' : `${group.label.toLowerCase()} for ${age(Date.now() - chat.since)}`, chat.waitingFor ? `wants ${WAITING_FOR[chat.waitingFor]}` : '']
            .filter(Boolean)
            .join(' · '),
          key(index)
        ],
        open: () => (app.focus.select(chat), onNavigate())
      };
    })
  );
  const moreQueue = $derived(queue.length - queueTiles.length);

  function keydown(event: KeyboardEvent): void {
    if (!folded || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const digit = /^Digit([1-9])$/.exec(event.code);
    const tile = digit && (focusing ? queueTiles : chatTiles)[Number(digit[1]) - 1];
    if (!tile) return;
    event.preventDefault();
    tile.open();
  }

  // The sandbox whose name, address or place in the list the user manages.
  let managing: Worker | null = $state(null);
  function manage(event: Event, worker: Worker): void {
    if (single) return;
    event.preventDefault();
    tip = null;
    managing = worker;
  }

  let newChat: NewChatDialog | undefined = $state();

  const ICON = 'grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-card hover:text-ink';
</script>

<svelte:window
  onkeydown={keydown}
  onclick={(event) => {
    const target = event.target as HTMLElement;
    if (more && !moreList?.contains(target) && !target.closest('[data-more-chats]')) more = null;
  }}
/>

{#snippet tileButton(tile: Tile, index: number, ring: string, shape: string)}
  <button
    class="relative grid shrink-0 place-items-center {shape} {tile.current
      ? 'bg-indigo-soft text-indigo shadow-[0_0_0_2px_var(--cf-indigo)]'
      : 'bg-card text-ink hover:shadow-[0_0_0_1px_var(--cf-line)]'}"
    style:box-shadow={!tile.current && tile.color ? `inset 0 0 0 1.5px ${tile.color}` : undefined}
    aria-label="{tile.title}{tile.lines[1] ? `, ${tile.lines[1]}` : ''}"
    aria-current={tile.current ? 'page' : undefined}
    aria-keyshortcuts={index < 9 ? `Alt+${index + 1}` : undefined}
    onclick={tile.open}
    onpointerenter={(event) => tipAt(event, tile.lines)}
    onpointerleave={() => (tip = null)}
    onfocus={(event) => tipAt(event, tile.lines)}
    onblur={() => (tip = null)}
  >
    {tile.label}
    {#if tile.dot}
      <span class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 {ring} {tile.dot}" class:animate-pulse={tile.working}></span>
    {/if}
  </button>
{/snippet}

{#snippet sandboxButton(worker: Worker, group: Group, selected: boolean, bed: 'sunken' | 'soft-line')}
  {@const count = app.attention.count(worker.id)}
  {@const [name, where] = workerTitle(worker)}
  {@const ring = bed === 'sunken' ? 'ring-sunken' : 'ring-soft-line'}
  <button
    class="relative grid size-11 shrink-0 place-items-center bg-card text-[0.9em] font-bold text-ink {selected ? 'rounded-xl' : 'rounded-full hover:rounded-xl'}"
    class:opacity-60={stopped(worker)}
    style:box-shadow={selected ? `0 0 0 2px var(--cf-${bed}), 0 0 0 4px ${group.color}` : undefined}
    aria-label="{name}, {where}"
    aria-current={selected ? 'page' : undefined}
    onclick={() => app.go({ view: 'chat', worker: worker.id })}
    oncontextmenu={(event) => manage(event, worker)}
    onpointerenter={(event) => showTip(event, worker)}
    onpointerleave={() => (tip = null)}
    onfocus={(event) => showTip(event, worker)}
    onblur={() => (tip = null)}
  >
    {badge(worker)}
    <span class="absolute -right-0.5 -bottom-0.5 flex rounded-full ring-2 {ring}"><StatusDot {worker} /></span>
    {#if count}
      <span class="absolute -top-1.5 -right-1.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-indigo px-1 text-[11px] font-bold text-on-accent ring-2 {ring}"
        >{count}</span
      >
    {/if}
  </button>
{/snippet}

<div class="flex h-full w-18 shrink-0 flex-col items-center gap-1.5 border-r-[1.5px] border-line bg-soft-line py-3">
  <Tulip size={28} />
  {#if focusing}
    <!-- In Focus, the same place leads back to the editor, with Focus's chat in front. -->
    <button
      class="relative mt-2 grid size-11 shrink-0 place-items-center rounded-xl bg-card text-ink hover:shadow-[0_0_0_1px_var(--cf-line)]"
      aria-label="Editor"
      title="Editor: the chat in Focus, with the tabs of the sandboxes"
      onclick={toEditor}
    >
      <span class="codicon codicon-layout text-[18px]!"></span>
    </button>
  {:else}
    <button
      class="relative mt-2 grid size-11 shrink-0 place-items-center rounded-xl bg-card text-ink hover:shadow-[0_0_0_1px_var(--cf-line)]"
      aria-label={needs ? `Focus: ${needs} ${needs === 1 ? 'chat needs' : 'chats need'} you` : 'Focus'}
      title="Focus: the chats of every sandbox, those that need you first"
      onclick={() => app.go({ view: 'focus' })}
    >
      <span class="codicon codicon-pulse text-[18px]!"></span>
      {#if needs}
        <span class="absolute -top-1.5 -right-1.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-indigo px-1 text-[11px] font-bold text-on-accent ring-2 ring-soft-line"
          >{needs}</span
        >
      {/if}
    </button>
  {/if}
  <span class="my-1 h-[1.5px] w-8 shrink-0 bg-line"></span>

  <ul class="m-0 flex min-h-0 w-full flex-1 list-none flex-col items-center gap-2 overflow-y-auto p-0 pt-1.5 scrollbar-none">
    {#if queueTiles.length}
      <li class="flex w-16 flex-col items-center gap-1.5 pb-1" aria-label="Focus's chats">
        {#each queueTiles as tile, index (tile.id)}
          {#if index && tile.group !== queueTiles[index - 1]!.group}<span class="my-0.5 h-[1.5px] w-5 shrink-0 bg-line"></span>{/if}
          {@render tileButton(tile, index, 'ring-soft-line', 'size-9 rounded-[10px] text-[0.85em] font-semibold')}
        {/each}
        {#if moreQueue}
          <button class="h-6 rounded-lg px-2 text-[0.8em] font-semibold text-muted hover:text-ink" title="All of Focus's chats: show the sidebar" onclick={onToggle}
            >+{moreQueue}</button
          >
        {/if}
        <span class="mt-1 h-[1.5px] w-8 shrink-0 bg-line"></span>
      </li>
    {/if}
    {#each groups as group (group.key)}
      <li
        class="flex w-16 flex-col items-center gap-2 {group.labeled ? 'rounded-2xl bg-sunken px-1 pt-1.5 pb-2' : 'py-1'}"
        title={group.name}
      >
        {#if group.labeled}
          <span class="w-full truncate text-center text-[0.56rem] font-bold tracking-wide uppercase" style:color={group.color}>{group.name}</span>
        {/if}
        {#each group.workers as worker (worker.id)}
          {@const selected = current === worker.id}
          {#if selected && chatTiles.length}
            {@const ring = group.labeled ? 'ring-soft-line' : 'ring-sunken'}
            <div class="-my-0.5 flex w-15 flex-col items-center gap-1.5 rounded-2xl pt-1.5 pb-2 {group.labeled ? 'bg-soft-line' : 'bg-sunken'}">
              {@render sandboxButton(worker, group, selected, group.labeled ? 'soft-line' : 'sunken')}
              <span class="h-[1.5px] w-6 shrink-0 bg-line"></span>
              {#each chatTiles as tile, index (tile.id)}
                {@render tileButton(tile, index, ring, 'size-9 rounded-[10px] text-[0.85em] font-semibold')}
              {/each}
              {#if moreChats.length}
                <button
                  class="grid h-6 w-9 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink aria-expanded:bg-card aria-expanded:text-ink"
                  title="{plural(moreChats.length, 'more chat', 'more chats')}"
                  aria-label="{plural(moreChats.length, 'more chat', 'more chats')}"
                  aria-haspopup="menu"
                  aria-expanded={!!more}
                  data-more-chats
                  onclick={toggleMore}><span class="codicon codicon-ellipsis"></span></button
                >
              {/if}
            </div>
          {:else}
            {@render sandboxButton(worker, group, selected, group.labeled ? 'sunken' : 'soft-line')}
          {/if}
        {/each}
        {#if !group.workers.length && group.start}
          <button
            class="grid size-9 place-items-center rounded-xl border-[1.5px] border-dashed border-line text-muted hover:text-ink"
            class:opacity-50={group.start === 'locked'}
            title={group.start === 'locked' ? `Starting on ${group.name} through the tunnel is off: see how to allow it` : `Start a sandbox on ${group.name}`}
            aria-label={group.start === 'locked' ? `Starting on ${group.name} is off` : `Start a sandbox on ${group.name}`}
            onclick={() => create(group.key)}
          >
            <span class="codicon codicon-add"></span>
          </button>
        {/if}
      </li>
    {/each}
    {#if !single}
      <li>
        <button
          class="grid size-11 place-items-center rounded-xl bg-indigo text-on-accent hover:shadow-(--cf-hover)"
          title="New chat: in one of the sandboxes, or in a new one"
          aria-label="New chat"
          aria-haspopup="dialog"
          onclick={() => newChat?.openAny(current ?? app.browsing)}
        >
          <span class="codicon codicon-add text-[18px]!"></span>
        </button>
      </li>
    {/if}
  </ul>

  <button class={ICON} title="Search chats and files ({searchShortcut})" aria-label="Search" aria-haspopup="dialog" onclick={() => (onNavigate(), onSearch())}>
    <span class="codicon codicon-search text-[18px]!"></span>
  </button>
  {#if !single}
    <button
      class="relative {ICON} {app.route.view === 'server' ? 'bg-card text-ink' : ''}"
      aria-label="Computers"
      aria-current={app.route.view === 'server' ? 'page' : undefined}
      title={computers}
      onclick={() => (app.go({ view: 'server' }), onNavigate())}
    >
      <span class="codicon codicon-server text-[18px]!"></span>
      {#if quiet.length || hidden}<span class="absolute top-2 right-2 size-2 rounded-full bg-muted ring-2 ring-soft-line"></span>{/if}
    </button>
  {/if}
  {#if canFold}
    <button
      class={ICON}
      title="{folded ? 'Show' : 'Hide'} the sidebar ({shortcut})"
      aria-label="{folded ? 'Show' : 'Hide'} the sidebar"
      aria-expanded={!folded}
      onclick={onToggle}
    >
      <span class="codicon codicon-{folded ? 'layout-sidebar-left-off' : 'layout-sidebar-left'} text-[18px]!"></span>
    </button>
  {/if}
</div>

{#if tip}
  <div
    role="tooltip"
    class="pointer-events-none fixed z-50 flex max-w-72 flex-col gap-0.5 rounded-lg bg-ink px-3 py-2 text-[0.85em] text-paper shadow-lg"
    style:left="{tip.x}px"
    style:top="{tip.y}px"
  >
    <strong class="truncate">{tip.lines[0]}</strong>
    {#each tip.lines.slice(1).filter(Boolean) as line, index (index)}<span class="truncate opacity-85">{line}</span>{/each}
  </div>
{/if}

{#if more && moreChats.length}
  <div
    bind:this={moreList}
    role="menu"
    tabindex="-1"
    aria-label="More chats"
    class="fixed z-50 flex max-h-[60vh] w-64 flex-col overflow-y-auto rounded-xl border-[1.5px] border-line bg-card p-1 shadow-lg"
    style:left="{more.x}px"
    style:top="{more.y}px"
    onkeydown={moreKeydown}
  >
    {#each moreChats as tile (tile.id)}
      <button
        role="menuitem"
        class="flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-left text-[0.9em] text-ink hover:bg-sunken focus:bg-sunken focus:outline-none"
        title={tile.lines.slice(0, 2).filter(Boolean).join('\n')}
        onclick={() => ((more = null), tile.open())}
      >
        <span class="size-2 shrink-0 rounded-full {tile.dot ?? 'bg-transparent'}" class:animate-pulse={tile.working}></span>
        <span class="min-w-0 flex-1 truncate">{tile.title}</span>
      </button>
    {/each}
  </div>
{/if}

<SandboxDialog bind:worker={managing} />
<NewChatDialog
  bind:this={newChat}
  onstarted={(workerId, key) => app.go({ view: focusing ? 'focus' : 'chat', worker: workerId, session: key })}
  {onNavigate}
/>
