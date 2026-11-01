<script lang="ts">
  // Focus: one chat from any sandbox, what its agent showed beside it, and the
  // way to the next agent that waits for the user. Alt+J goes there; Alt+↑/↓
  // steps through the list. It never changes the chat by itself while one shows.
  import { untrack } from 'svelte';
  import App from '../../chat/App.svelte';
  import Skeleton from '../../chat/lib/Skeleton.svelte';
  import { app } from '../lib/app.svelte.ts';
  import { WAITING_FOR, workerTitle } from '../lib/format.ts';
  import ShowPane from './ShowPane.svelte';

  const selected = $derived(app.focus.selected);
  const worker = $derived(selected ? app.worker(selected.workerId) : undefined);
  const agent = $derived(selected ? app.agent(selected.workerId) : undefined);
  const chat = $derived(selected && agent ? agent.chats[selected.key] : undefined);
  const elsewhere = $derived(!!worker && app.elsewhere(worker));
  const next = $derived(app.focus.next);
  // The way on shows once this chat no longer waits for the user.
  const offerNext = $derived(!!next && chat?.status !== 'waiting');

  // Nothing chosen yet: the chat that needs the user most, else the first.
  $effect(() => {
    if (selected || !app.focus.groups.length) return;
    untrack(() => {
      const first = app.focus.next ?? app.focus.groups[0]!.chats[0];
      if (first) app.focus.select(first);
    });
  });

  // The chat connects once its sandbox is ready, unless another window has it.
  $effect(() => {
    if (!selected || !worker || !agent || agent.chats[selected.key]) return;
    if (worker.status === 'ready' && !elsewhere) {
      const key = selected.key;
      untrack(() => void agent.open(key));
    }
  });

  // The split between the chat and the pane, and whether the pane shows; they stay so.
  const SPLIT = 'codeflower.focusSplit';
  const PANE = 'codeflower.focusPane';
  let split = $state(stored(SPLIT, 0.5));
  let pane = $state(stored(PANE, 1) === 1);
  let width = $state(0);
  let main: HTMLElement | undefined = $state();
  let resizing = $state(false);
  const narrow = $derived(width > 0 && width < 720);
  /** Narrow: the chat or the pane, one at a time. */
  let front = $state<'chat' | 'pane'>('chat');

  function stored(key: string, fallback: number): number {
    try {
      const value = Number(localStorage.getItem(key) ?? NaN);
      return Number.isFinite(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function keep(key: string, value: number): void {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Not kept, e.g. in a private window.
    }
  }

  function togglePane(): void {
    pane = !pane;
    keep(PANE, pane ? 1 : 0);
  }

  function setSplit(next: number): void {
    split = Math.min(Math.max(next, 0.25), 0.75);
  }

  function startResize(event: PointerEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = true;
  }

  function moveResize(event: PointerEvent): void {
    if (!resizing || !main) return;
    const box = main.getBoundingClientRect();
    setSplit((event.clientX - box.left) / box.width);
  }

  function endResize(): void {
    if (!resizing) return;
    resizing = false;
    keep(SPLIT, split);
  }

  function keydown(event: KeyboardEvent): void {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // By the key's place: Alt+J types a letter on a Mac.
    if (event.code === 'KeyJ') app.focus.goNext();
    else if (event.key === 'ArrowDown') app.focus.move(1);
    else if (event.key === 'ArrowUp') app.focus.move(-1);
    else return;
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="flex h-full flex-col" bind:clientWidth={width}>
  {#if !selected}
    <div class="grid h-full place-items-center p-8 text-center text-muted">
      <div class="max-w-sm">
        <span class="codicon codicon-pulse text-[32px]!"></span>
        <h1 class="font-display text-xl font-medium text-ink">Focus</h1>
        <p>
          Every agent at work, in one list: those waiting for you on top, longest first. Start chats in your sandboxes and keep them moving from
          here.
        </p>
      </div>
    </div>
  {:else}
    {#if !worker}
      <p class="m-0 border-b-[1.5px] border-soft-line px-4 py-2.5 text-muted">This chat's sandbox is gone from the list.</p>
    {:else if agent?.state === 'taken-over' || elsewhere}
      <section class="flex flex-wrap items-center gap-3 border-b-[1.5px] border-orange bg-yellow-soft px-4 py-2.5" role="status">
        <span class="min-w-0 flex-1">
          {agent?.state === 'taken-over'
            ? 'Another window took this sandbox over: VS Code, or another tab. It keeps working there.'
            : 'This sandbox is open in another window, e.g. VS Code. Opening the chat here moves the sandbox to this page; the other window can take it back.'}
        </span>
        <button class="pill pill-small pill-primary" onclick={() => void app.openHere(worker)}>Open here</button>
      </section>
    {:else if agent?.connected && agent.status?.signedIn === false}
      <section class="flex flex-wrap items-center gap-3 border-b-[1.5px] border-orange bg-yellow-soft px-4 py-2.5" role="status">
        <span class="min-w-0 flex-1">{agent.status.agentLabel} is not signed in for this project, so it cannot answer yet.</span>
        <button class="pill pill-small pill-primary" onclick={() => void app.signIn.start(agent)}>Sign in</button>
      </section>
    {:else if agent?.state === 'connecting'}
      <p class="m-0 px-4 py-2.5 text-muted"><span class="spinner"></span> Connecting to {workerTitle(worker)[0]}…</p>
    {:else if agent?.state === 'disconnected' && agent.error}
      <p class="m-0 border-b-[1.5px] border-soft-line px-4 py-2.5 text-red">Could not reach the sandbox: {agent.error}. Trying again…</p>
    {/if}

    {#if narrow}
      <div class="flex gap-1 border-b-[1.5px] border-soft-line px-2 py-1.5" role="tablist" aria-label="Show">
        <button role="tab" class="chip" aria-selected={front === 'chat'} aria-expanded={front === 'chat'} onclick={() => (front = 'chat')}>
          <span class="codicon codicon-comment-discussion"></span>Chat
        </button>
        <button role="tab" class="chip" aria-selected={front === 'pane'} aria-expanded={front === 'pane'} onclick={() => (front = 'pane')}>
          <span class="codicon codicon-preview"></span>Shown{#if chat?.shown.length}<span class="text-muted">{chat.shown.length}</span>{/if}
        </button>
      </div>
    {/if}

    <div class="relative flex min-h-0 flex-1" bind:this={main} class:select-none={resizing}>
      {#if !narrow || front === 'chat'}
        <div class="min-w-0 {narrow || !pane ? 'flex-1' : ''}" style={!narrow && pane ? `width: ${split * 100}%` : undefined}>
          {#if chat}
            {#key chat}<App host={chat.host} />{/key}
          {:else}
            <div class="mx-auto w-full max-w-3xl p-4"><Skeleton lines={['40%', '90%', '75%']} /></div>
          {/if}
        </div>
      {/if}
      {#if !narrow && pane}
        <!-- A focusable separator is a widget: it moves with the arrow keys too. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the chat and the pane"
          aria-valuenow={Math.round(split * 100)}
          tabindex="0"
          title="Drag to resize; double-click to share evenly"
          class="group relative z-10 -mx-[2px] w-[5px] shrink-0 cursor-col-resize"
          onpointerdown={startResize}
          onpointermove={moveResize}
          onpointerup={endResize}
          onpointercancel={endResize}
          ondblclick={() => (setSplit(0.5), keep(SPLIT, split))}
          onkeydown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            setSplit(split + (event.key === 'ArrowLeft' ? -0.05 : 0.05));
            keep(SPLIT, split);
          }}
        >
          <span class="absolute inset-y-0 left-[2px] w-[1.5px] bg-soft-line transition-colors group-hover:bg-indigo group-focus-visible:bg-indigo {resizing ? 'bg-indigo' : ''}"></span>
        </div>
      {/if}
      {#if narrow ? front === 'pane' : pane}
        <div class="min-w-0 flex-1">
          {#key selected.workerId + '/' + selected.key}
            <ShowPane workerId={selected.workerId} chatKey={selected.key} onCollapse={narrow ? undefined : togglePane} />
          {/key}
        </div>
      {/if}
      {#if !narrow && !pane}
        <button
          class="chip absolute top-2 right-3 z-10"
          title="Show what the agent showed you"
          onclick={togglePane}
        >
          <span class="codicon codicon-layout-sidebar-right"></span>Shown{#if chat?.shown.length}<span class="text-muted">{chat.shown.length}</span>{/if}
        </button>
      {/if}
    </div>

    {#if offerNext && next}
      <div class="flex items-center gap-2 border-t-[1.5px] border-soft-line bg-sunken px-3 py-1.5 text-[0.9em]" role="status">
        <span class="size-2 shrink-0 rounded-full {next.phase === 'waiting' ? 'bg-orange' : 'bg-indigo'}"></span>
        <span class="min-w-0 flex-1 truncate">
          <span class="text-muted">Next:</span>
          <span class="font-semibold">{next.title}</span>
          <span class="text-muted">
            · {next.sandbox} · {next.phase === 'waiting' ? `waits for ${next.waitingFor ? WAITING_FOR[next.waitingFor] : 'you'}` : 'finished'}
          </span>
        </span>
        <button class="pill pill-small pill-primary shrink-0" title="Go to it (Alt+J)" onclick={() => app.focus.goNext()}>
          Go<span class="hidden text-[0.85em] opacity-80 min-[600px]:inline">Alt+J</span>
        </button>
      </div>
    {/if}
  {/if}
</div>
