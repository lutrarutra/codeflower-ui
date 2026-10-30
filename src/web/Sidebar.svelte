<script lang="ts">
  import Tulip from '../chat/lib/Tulip.svelte';
  import ActivityChips from './lib/ActivityChips.svelte';
  import SessionList from './SessionList.svelte';
  import StatusDot from './lib/StatusDot.svelte';
  import { app, type View } from './lib/app.svelte.ts';
  import { SOURCE_TEXT, SOURCE_TITLE, workerTitle } from './lib/format.ts';

  let { onAdd, onNavigate }: { onAdd: () => void; onNavigate: () => void } = $props();

  const views: { id: View; label: string; icon: string }[] = [
    { id: 'chat', label: 'Chat', icon: 'comment-discussion' },
    { id: 'server', label: 'Server', icon: 'server-process' }
  ];
  const connectOnly = $derived(app.system?.capabilities.connectOnly ?? false);

  function show(view: View): void {
    app.go({ view, worker: app.route.worker });
    onNavigate();
  }

  function choose(id: string): void {
    app.go({ view: 'chat', worker: id });
    onNavigate();
  }
</script>

<nav class="flex h-full flex-col border-r-[1.5px] border-soft-line bg-paper" aria-label="Sandboxes">
  <header class="flex items-center gap-2.5 px-4 pt-4 pb-3">
    <Tulip size={30} />
    <div class="min-w-0">
      <div class="font-display text-[1.15rem] leading-tight font-medium">code flower</div>
      {#if app.system?.version}<div class="text-[0.75em] text-muted">{app.system.version}</div>{/if}
    </div>
  </header>

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

  <div class="eyebrow px-4 pb-1 text-muted">Sandboxes</div>
  <ul class="m-0 min-h-0 flex-1 list-none overflow-auto px-2 py-0">
    {#each app.workers as worker (worker.id)}
      {@const [name, where] = workerTitle(worker)}
      {@const selected = app.route.view === 'chat' && app.route.worker === worker.id}
      <li>
        <button
          class="flex w-full flex-col gap-1 rounded-xl px-2.5 py-2 text-left {selected ? 'bg-card shadow-[0_0_0_1.5px_var(--cf-line)]' : 'hover:bg-card'}"
          aria-current={selected ? 'page' : undefined}
          onclick={() => choose(worker.id)}
        >
          <span class="flex w-full items-center gap-2">
            <StatusDot {worker} />
            <span class="min-w-0 flex-1 truncate font-semibold">{name}</span>
            <span class="tag bg-soft-line text-muted" title={SOURCE_TITLE[worker.source]}>{SOURCE_TEXT[worker.source]}</span>
          </span>
          <span class="truncate pl-[1.1rem] text-[0.85em] text-muted">{where}</span>
          <span class="pl-[1.1rem]"><ActivityChips {worker} compact /></span>
        </button>
        {#if selected && worker.url && worker.kind !== 'task'}
          <SessionList {worker} {onNavigate} />
        {/if}
      </li>
    {:else}
      {#if app.listed}
        <li class="px-2.5 py-2 text-[0.9em] text-muted">
          No sandboxes yet. {connectOnly ? 'Add one running elsewhere.' : 'Start one under Server, or add one running elsewhere.'}
        </li>
      {/if}
    {/each}
  </ul>

  <div class="flex flex-col gap-2 border-t-[1.5px] border-soft-line p-3">
    <button class="pill pill-small justify-center" onclick={onAdd}><span class="codicon codicon-add"></span>Add remote sandbox</button>
    <button class="link self-center text-[0.85em]" onclick={() => app.askToQuit()}>{connectOnly ? 'Quit' : 'Stop all and quit'}</button>
  </div>
</nav>
