<script lang="ts">
  import type { ChatAction } from '../../protocol/messages.ts';

  let {
    actions,
    busy,
    live,
    choose
  }: {
    actions: ChatAction[];
    busy: boolean;
    live: boolean;
    choose: (id: string) => void;
  } = $props();

  let open = $state(false);
  let confirmation = $state<string | null>(null);
  let root: HTMLElement | undefined = $state();
  let list: HTMLElement | undefined = $state();

  $effect(() => {
    if (!busy) confirmation = null;
    if (!live) {
      open = false;
      confirmation = null;
    }
  });

  function toggle(): void {
    open = !open;
    confirmation = null;
    if (open) queueMicrotask(() => list?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }

  function activate(action: ChatAction): void {
    if (busy && action.mode === 'interrupt' && confirmation !== action.id) {
      confirmation = action.id;
      return;
    }
    open = false;
    confirmation = null;
    root?.querySelector<HTMLElement>('button')?.focus();
    choose(action.id);
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      open = false;
      confirmation = null;
      root?.querySelector<HTMLElement>('button')?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(list?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) {
      open = false;
      confirmation = null;
    }
  }}
/>

<div class="relative shrink-0" bind:this={root} onkeydown={keydown} role="presentation">
  <button
    type="button"
    class="grid size-7 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink disabled:opacity-50 aria-expanded:bg-sunken aria-expanded:text-ink"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Tools"
    title="Tools: actions for this chat"
    disabled={!live}
    onclick={toggle}
  >
    <span class="codicon codicon-tools"></span>
  </button>

  {#if open}
    <div
      bind:this={list}
      role="menu"
      aria-label="Chat actions"
      class="card absolute top-full right-0 z-30 mt-2 flex max-h-96 w-80 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto p-1.5"
    >
      {#each actions as action (action.id)}
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-start gap-2 rounded-lg border-none bg-transparent px-2 py-2 text-left hover:bg-code focus-visible:bg-code focus-visible:outline-none"
          onclick={() => activate(action)}
        >
          <span class="codicon codicon-{action.icon} mt-0.5 text-indigo"></span>
          <span class="min-w-0 flex-1">
            <span class="block font-semibold">{confirmation === action.id ? 'Stop and wrap up?' : action.title}</span>
            <span class="block text-[0.8em] text-muted">
              {confirmation === action.id
                ? 'Click again to stop the current step.'
                : busy
                  ? action.mode === 'interrupt'
                    ? 'Stops the current step'
                    : 'After this turn'
                  : action.description}
            </span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
