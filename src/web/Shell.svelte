<script lang="ts">
  import AddRemoteDialog from './AddRemoteDialog.svelte';
  import AgentLinkDialog from './AgentLinkDialog.svelte';
  import ChatView from './ChatView.svelte';
  import QuitDialog from './QuitDialog.svelte';
  import QuittingBanner from './QuittingBanner.svelte';
  import ServerView from './server/ServerView.svelte';
  import SignInDialog from './SignInDialog.svelte';
  import Sidebar from './Sidebar.svelte';
  import { app } from './lib/app.svelte.ts';

  let adding = $state(false);
  // Narrow windows show the sidebar as a drawer.
  let drawer = $state(false);
  let width = $state(0);
  const wide = $derived(width >= 800);

  // Wide windows can fold the sidebar to a rail of icons (Ctrl/⌘+B, as in VS Code); it stays so.
  const COLLAPSED = 'codeflower.sidebarCollapsed';
  let collapsed = $state(stored());
  const folded = $derived(collapsed && wide);

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
      class="fixed inset-y-0 left-0 z-20 shrink-0 -translate-x-full transition-[translate,width] min-[800px]:static min-[800px]:translate-x-0 {folded
        ? 'w-14'
        : 'w-72'}"
      class:translate-x-0={drawer}
    >
      <Sidebar collapsed={folded} canCollapse={wide} onToggle={toggle} onAdd={() => (adding = true)} onNavigate={() => (drawer = false)} />
    </div>
    {#if drawer}
      <button class="fixed inset-0 z-10 bg-black/30 min-[800px]:hidden" aria-label="Close the sidebar" onclick={() => (drawer = false)}></button>
    {/if}
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-2 border-b-[1.5px] border-soft-line px-3 py-2 min-[800px]:hidden">
        <button class="chip" aria-label="Open the sidebar" onclick={() => (drawer = true)}><span class="codicon codicon-menu"></span></button>
        <span class="font-display font-medium">code flower</span>
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
  <AddRemoteDialog bind:open={adding} />
  <QuitDialog />
  <SignInDialog />
  <AgentLinkDialog />
{/if}
