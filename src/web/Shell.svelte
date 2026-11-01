<script lang="ts">
  import AddRemoteDialog from './AddRemoteDialog.svelte';
  import AgentLinkDialog from './AgentLinkDialog.svelte';
  import ChatView from './ChatView.svelte';
  import QuitDialog from './QuitDialog.svelte';
  import QuittingBanner from './QuittingBanner.svelte';
  import Toasts from './Toasts.svelte';
  import ServerView from './server/ServerView.svelte';
  import PluginsDialog from './PluginsDialog.svelte';
  import SignInDialog from './SignInDialog.svelte';
  import Sidebar from './Sidebar.svelte';
  import { app } from './lib/app.svelte.ts';
  import { workerTitle } from './lib/format.ts';

  let adding = $state(false);
  // Narrow windows show the sidebar as a drawer.
  let drawer = $state(false);
  let width = $state(0);
  const wide = $derived(width >= 800);

  // Wide windows can fold the sidebar to a rail of icons (Ctrl/⌘+B, as in VS Code); it stays so.
  const COLLAPSED = 'codeflower.sidebarCollapsed';
  let collapsed = $state(stored());
  const folded = $derived(collapsed && wide);
  // The narrow top bar names the sandbox of the chat in front.
  const sandbox = $derived.by(() => {
    const worker = app.route.view === 'chat' ? app.worker(app.route.worker) : undefined;
    return worker && workerTitle(worker);
  });
  /** Chats finished or wait for the user somewhere: the closed drawer says so. */
  const needs = $derived(app.workers.some((worker) => app.attention.count(worker.id) > 0));

  function stored(): boolean {
    try {
      return localStorage.getItem(COLLAPSED) === 'true';
    } catch {
      return false;
    }
  }

  function toggle(): void {
    collapsed = !collapsed;
    try {
      localStorage.setItem(COLLAPSED, String(collapsed));
    } catch {
      // Not kept, e.g. in a private window.
    }
  }

  // Wide windows: the sidebar's width, dragged at its edge (double-click: back to the default); it stays so.
  const WIDTH = 'codeflower.sidebarWidth';
  const DEFAULT_WIDTH = 288;
  const MIN_WIDTH = 200;
  let sidebarWidth = $state(storedWidth());
  /** The edge being dragged: the pointer and the width where the drag began. */
  let resizing: { from: number; width: number } | null = $state(null);
  const maxWidth = () => Math.max(MIN_WIDTH, Math.min(640, width - 320));

  function storedWidth(): number {
    try {
      const stored = Number(localStorage.getItem(WIDTH));
      return stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  }

  function setWidth(next: number): void {
    sidebarWidth = Math.round(Math.min(Math.max(next, MIN_WIDTH), maxWidth()));
  }

  function keep(): void {
    try {
      localStorage.setItem(WIDTH, String(sidebarWidth));
    } catch {
      // Not kept, e.g. in a private window.
    }
  }

  function startResize(event: PointerEvent): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = { from: event.clientX, width: sidebarWidth };
  }

  function moveResize(event: PointerEvent): void {
    if (resizing) setWidth(resizing.width + event.clientX - resizing.from);
  }

  function endResize(): void {
    if (!resizing) return;
    resizing = null;
    keep();
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== 'b' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (wide) toggle();
    else drawer = !drawer;
  }
</script>

<svelte:window bind:innerWidth={width} onkeydown={keydown} />

{#if app.stopped}
  <main class="grid h-full place-items-center p-8 text-center">
    <div>
      {#if app.single}
        <h1 class="font-display text-2xl font-medium">The sandbox has stopped.</h1>
        <p class="text-muted">You can close this tab. Its chats are kept in the project: start the sandbox again to continue them.</p>
      {:else}
        <h1 class="font-display text-2xl font-medium">The app has stopped.</h1>
        <p class="text-muted">You can close this tab. Start code flower again to run another sandbox.</p>
      {/if}
    </div>
  </main>
{:else}
  <div class="flex h-full">
    <div
      class="fixed inset-y-0 left-0 z-20 shrink-0 -translate-x-full min-[800px]:relative min-[800px]:translate-x-0 {resizing
        ? ''
        : 'transition-[translate,width]'} {folded ? 'w-14' : 'w-72 max-[800px]:max-w-[85vw]'}"
      class:translate-x-0={drawer}
      style={wide && !folded ? `width: ${Math.min(sidebarWidth, maxWidth())}px` : undefined}
    >
      <Sidebar collapsed={folded} canCollapse={wide} onToggle={toggle} onAdd={() => (adding = true)} onNavigate={() => (drawer = false)} />
      {#if wide && !folded}
        <!-- A focusable separator is a widget: it moves with the arrow keys too. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar"
          aria-valuenow={sidebarWidth}
          tabindex="0"
          title="Drag to resize; double-click for the default width"
          class="group absolute inset-y-0 -right-[3px] z-10 w-[5px] cursor-col-resize"
          onpointerdown={startResize}
          onpointermove={moveResize}
          onpointerup={endResize}
          onpointercancel={endResize}
          ondblclick={() => (setWidth(DEFAULT_WIDTH), keep())}
          onkeydown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            setWidth(sidebarWidth + (event.key === 'ArrowLeft' ? -16 : 16));
            keep();
          }}
        >
          <span class="absolute inset-y-0 left-[2px] w-[1.5px] transition-colors group-hover:bg-indigo group-focus-visible:bg-indigo {resizing ? 'bg-indigo' : ''}"></span>
        </div>
      {/if}
    </div>
    {#if drawer}
      <button class="fixed inset-0 z-10 bg-black/30 min-[800px]:hidden" aria-label="Close the sidebar" onclick={() => (drawer = false)}></button>
    {/if}
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-2 border-b-[1.5px] border-soft-line px-3 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5 min-[800px]:hidden">
        <button class="chip relative size-9 justify-center p-0!" aria-label="Open the sidebar" onclick={() => (drawer = true)}>
          <span class="codicon codicon-menu"></span>
          {#if needs}<span class="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-indigo ring-2 ring-paper"></span>{/if}
        </button>
        <span class="shrink-0 font-display font-medium">code flower</span>
        {#if sandbox}
          <span class="min-w-0 truncate text-[0.85em] text-muted" title={sandbox.join(' · ')}>{sandbox.filter(Boolean).join(' · ')}</span>
        {/if}
      </header>
      {#if app.quit?.quitting}
        <QuittingBanner />
      {/if}
      <div class="min-h-0 flex-1 overflow-auto">
        {#if app.route.view === 'server'}
          <ServerView />
        {:else}
          <ChatView onAdd={() => (adding = true)} />
        {/if}
      </div>
    </div>
  </div>
  <Toasts />
  <AddRemoteDialog bind:open={adding} />
  <QuitDialog />
  <SignInDialog />
  <PluginsDialog />
  <AgentLinkDialog />
{/if}
