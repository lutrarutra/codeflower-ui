<script lang="ts">
  // The chat's title in its header, and a list of the sandbox's other chats under it: the latest
  // first, to bring one to the front (or open it) without going back to the sidebar or tree.
  import type { SandboxChat, SessionStatus } from '../../protocol/messages.ts';
  import AgentIcon from './AgentIcon.svelte';
  import ChatTitle from './ChatTitle.svelte';
  import { ago, epoch } from './time.ts';

  let {
    title,
    chats,
    list,
    choose
  }: {
    title: string;
    /** The sandbox's chats, once the host told them. */
    chats: SandboxChat[] | undefined;
    /** Asks the host for the chats (again). */
    list: () => void;
    choose: (key: string) => void;
  } = $props();

  /** A filter shows once the list is longer than this. */
  const FILTER_FROM = 8;
  /** The rows that can be chosen: every chat but this one. */
  const ITEM = '[role="menuitem"]:not(:disabled)';
  const DOT: Record<SessionStatus, string> = { working: 'bg-cyan', waiting: 'bg-orange', ready: 'bg-green', offline: 'bg-transparent' };

  let open = $state(false);
  let query = $state('');
  let root: HTMLElement | undefined = $state();
  let menu: HTMLElement | undefined = $state();

  const sorted = $derived(
    [...(chats ?? [])].sort((a, b) => (epoch(b.updatedAt) ?? 0) - (epoch(a.updatedAt) ?? 0))
  );
  const shown = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? sorted.filter((chat) => words.every((word) => (chat.title || 'untitled chat').toLowerCase().includes(word))) : sorted;
  });

  function toggle(): void {
    open = !open;
    if (!open) return;
    query = '';
    list();
    queueMicrotask(focusFirst);
  }

  function focusFirst(): void {
    (menu?.querySelector<HTMLElement>('input') ?? menu?.querySelector<HTMLElement>(ITEM))?.focus();
  }

  function close(): void {
    open = false;
    root?.querySelector<HTMLElement>('button')?.focus();
  }

  function pick(chat: SandboxChat): void {
    close();
    if (!chat.current) choose(chat.key);
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      const first = shown.find((chat) => !chat.current);
      if (first) pick(first);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(menu?.querySelectorAll<HTMLElement>(`input, ${ITEM}`) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }}
/>

<div class="relative flex min-w-0" bind:this={root} onkeydown={keydown} role="presentation">
  <button
    type="button"
    class="-mx-1 flex min-w-0 items-center gap-1 rounded-lg border-none bg-transparent px-1 py-0.5 text-left font-[inherit] text-ink hover:bg-sunken aria-expanded:bg-sunken"
    aria-haspopup="menu"
    aria-expanded={open}
    title="{title || 'New session'}: switch to another chat of this sandbox"
    onclick={toggle}
  >
    <ChatTitle {title} fallback="New session" />
    <span class="codicon codicon-chevron-down shrink-0 text-[12px]! text-muted"></span>
  </button>

  {#if open}
    <div
      bind:this={menu}
      role="menu"
      aria-label="Chats of this sandbox"
      class="card absolute top-full left-0 z-30 mt-2 flex max-h-[min(28rem,70vh)] w-96 max-w-[calc(100vw-2rem)] flex-col p-1.5 font-sans text-[0.8rem] font-normal"
    >
      <div class="eyebrow px-2 pt-1 pb-1.5 text-teal">Chats in this sandbox</div>
      {#if (chats?.length ?? 0) > FILTER_FROM}
        <input
          class="mx-1 mb-1.5 rounded-lg border-[1.5px] border-line bg-card px-2 py-1 text-[1em] focus:border-teal focus:outline-none"
          placeholder="Filter chats"
          aria-label="Filter chats"
          bind:value={query}
        />
      {/if}
      <div class="min-h-0 overflow-y-auto">
        {#if !chats}
          <div class="px-2 py-1.5 text-muted">Loading…</div>
        {:else if !shown.length}
          <div class="px-2 py-1.5 text-muted">{query ? 'No chat matches' : 'No chats yet'}</div>
        {/if}
        {#each shown as chat (chat.key)}
          <button
            type="button"
            role="menuitem"
            disabled={chat.current}
            aria-current={chat.current ? 'page' : undefined}
            class="group flex w-full items-center gap-2 rounded-lg border-none px-2 py-1.5 text-left {chat.current
              ? 'cursor-default bg-teal-soft font-semibold shadow-[inset_3px_0_0_var(--color-teal)]'
              : 'bg-transparent hover:bg-code focus-visible:bg-code focus-visible:outline-none'}"
            title={chat.current ? 'The chat you are in' : `Show ${chat.title || 'Untitled chat'} in its own tab`}
            onclick={() => pick(chat)}
          >
            <span
              class="size-2 shrink-0 rounded-full {chat.status ? DOT[chat.status] : 'bg-transparent'}"
              class:animate-pulse={chat.status === 'working'}
            ></span>
            {#if chat.agent}<AgentIcon agent={chat.agent} size="0.95em" title={chat.agent.name ?? chat.agent.id} />{/if}
            <span class="flex min-w-0 flex-1"><ChatTitle title={chat.title} /></span>
            {#if chat.current}
              <span class="shrink-0 text-[0.85em] font-normal text-muted">this chat</span>
            {:else}
              {#if epoch(chat.updatedAt)}
                <span class="shrink-0 text-[0.85em] text-muted" title={new Date(chat.updatedAt!).toLocaleString()}>{ago(epoch(chat.updatedAt)!)}</span>
              {/if}
              <span
                class="codicon codicon-link-external shrink-0 text-[12px]! text-muted group-hover:text-ink group-focus-visible:text-ink"
                aria-hidden="true"
              ></span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
