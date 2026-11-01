<script lang="ts">
  // The rail, beside the page also with the sidebar folded: Focus, then the sandboxes that run, by
  // the computer they run on, then + for a new one. A computer that can start sandboxes shows even
  // with none. Computers that do not answer and sandboxes that stopped stay off it: the computers
  // button at the bottom (the Server view) lists them, and says that some are hidden.
  import Tulip from '../chat/lib/Tulip.svelte';
  import SandboxDialog from './SandboxDialog.svelte';
  import StatusDot from './lib/StatusDot.svelte';
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import { plural, statusText, workerTitle } from './lib/format.ts';
  import type { Machine } from './lib/machines.svelte.ts';
  import { badge, ELSEWHERE_COLOR, inRail, machineColor, startState, stopped } from './lib/rail.ts';

  let {
    canFold = false,
    folded = false,
    shortcut,
    onToggle,
    onNavigate
  }: { canFold?: boolean; folded?: boolean; shortcut: string; onToggle: () => void; onNavigate: () => void } = $props();

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

  /** The sandbox under the pointer: its name, where it runs and what it does, beside the rail. */
  let tip = $state<{ x: number; y: number; lines: string[] } | null>(null);
  function showTip(event: Event, worker: Worker): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const [name, where] = workerTitle(worker);
    const count = app.attention.count(worker.id);
    tip = {
      x: box.right + 10,
      y: box.top,
      lines: [
        name,
        [where, app.several || worker.source === 'added' ? `on ${worker.source === 'added' ? 'its own computer' : app.machine(worker.id).name}` : ''].filter(Boolean).join(' · '),
        count ? `${statusText(worker)} · ${count} need${count === 1 ? 's' : ''} you` : statusText(worker)
      ]
    };
  }

  // The sandbox whose name, address or place in the list the user manages.
  let managing: Worker | null = $state(null);
  function manage(event: Event, worker: Worker): void {
    if (single) return;
    event.preventDefault();
    tip = null;
    managing = worker;
  }

  const ICON = 'grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-card hover:text-ink';
</script>

<div class="flex h-full w-18 shrink-0 flex-col items-center gap-1.5 border-r-[1.5px] border-line bg-soft-line py-3">
  <Tulip size={28} />
  <button
    class="relative mt-2 grid size-11 shrink-0 place-items-center rounded-xl {focusing ? 'bg-indigo text-on-accent' : 'bg-card text-ink hover:shadow-[0_0_0_1px_var(--cf-line)]'}"
    aria-label={needs ? `Focus: ${needs} ${needs === 1 ? 'chat needs' : 'chats need'} you` : 'Focus'}
    aria-pressed={focusing}
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
  <span class="my-1 h-[1.5px] w-8 shrink-0 bg-line"></span>

  <ul class="m-0 flex min-h-0 w-full flex-1 list-none flex-col items-center gap-2 overflow-y-auto p-0 pt-1.5 scrollbar-none">
    {#each groups as group (group.key)}
      <li
        class="flex w-[3.6rem] flex-col items-center gap-2 {group.labeled ? 'rounded-2xl border-t-[3px] bg-sunken px-0.5 pt-1 pb-2' : 'py-1'}"
        style:border-top-color={group.labeled ? group.color : undefined}
        title={group.name}
      >
        {#if group.labeled}
          <span class="w-full truncate text-center text-[0.56rem] font-bold text-muted uppercase">{group.name}</span>
        {/if}
        {#each group.workers as worker (worker.id)}
          {@const selected = current === worker.id}
          {@const count = app.attention.count(worker.id)}
          {@const [name, where] = workerTitle(worker)}
          <button
            class="relative grid size-11 shrink-0 place-items-center bg-card text-[0.9em] font-bold text-ink {selected ? 'rounded-xl' : 'rounded-full hover:rounded-xl'}"
            class:opacity-60={stopped(worker)}
            style:box-shadow={selected ? `0 0 0 2px var(--cf-${group.labeled ? 'sunken' : 'soft-line'}), 0 0 0 4px ${group.color}` : undefined}
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
            <span class="absolute -right-0.5 -bottom-0.5 flex rounded-full ring-2 {group.labeled ? 'ring-sunken' : 'ring-soft-line'}"><StatusDot {worker} /></span>
            {#if count}
              <span class="absolute -top-1.5 -right-1.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-indigo px-1 text-[11px] font-bold text-on-accent ring-2 {group.labeled ? 'ring-sunken' : 'ring-soft-line'}"
                >{count}</span
              >
            {/if}
          </button>
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
          title="New sandbox: start one, or connect one running elsewhere"
          aria-label="New sandbox"
          onclick={() => create()}
        >
          <span class="codicon codicon-add text-[18px]!"></span>
        </button>
      </li>
    {/if}
  </ul>

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

<SandboxDialog bind:worker={managing} />
