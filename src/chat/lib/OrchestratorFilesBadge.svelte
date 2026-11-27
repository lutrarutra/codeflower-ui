<script lang="ts">
  import type { OrchestratorFile } from '../../protocol/orchestrators.ts';
  import { chatHost } from './host.ts';

  // In an orchestrator chat's footer, at the right end: what has been shared
  // with it (figures, reports, the code it read), and the files that wait for
  // the user's answer in the executor's chat or were kept from it. Choosing one
  // opens it as a shown file opens.
  let { files }: { files: OrchestratorFile[] } = $props();
  const host = chatHost();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let list: HTMLElement | undefined = $state();

  const visible = $derived(files.filter((file) => file.status === 'visible'));
  const pending = $derived(files.filter((file) => file.status === 'pending'));
  const label = $derived(
    `${visible.length} file${visible.length === 1 ? '' : 's'} shared with the orchestrator${pending.length ? `, ${pending.length} waiting for you` : ''}`
  );
  const order = { pending: 0, visible: 1, declined: 2 } as const;
  const sorted = $derived([...files].sort((a, b) => order[a.status] - order[b.status]));
  const icon = { figure: 'file-media', report: 'book', code: 'code' } as const;
  const statusText = {
    visible: '',
    pending: 'waiting for you to share it, in the executor chat',
    declined: 'not shared'
  } as const;

  function toggle(): void {
    open = !open;
    if (open) queueMicrotask(() => list?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }

  function choose(path: string): void {
    open = false;
    root?.querySelector<HTMLElement>('button')?.focus();
    host.send({ type: 'openFile', path });
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      open = false;
      root?.querySelector<HTMLElement>('button')?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(list?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const name = (path: string) => path.split('/').pop() || path;
  const folder = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }}
/>

{#if files.length}
  <div class="flex items-center" bind:this={root} onkeydown={keydown} role="presentation">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-full border-none bg-transparent px-1 py-0 leading-none text-inherit hover:text-ink {pending.length
        ? 'font-semibold text-orange'
        : ''}"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onclick={toggle}
    >
      <span class="codicon codicon-files {pending.length ? 'animate-pulse' : ''}"></span>
      {visible.length}{#if pending.length}<span>+{pending.length}</span>{/if}
    </button>
    {#if open}
      <div
        bind:this={list}
        role="menu"
        aria-label="Shared with the orchestrator"
        class="card absolute right-0 bottom-full z-20 mb-2 flex max-h-96 w-80 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto p-1.5 text-[1.25em] text-ink"
      >
        <div class="eyebrow px-2 pt-1 pb-1.5 text-violet">Shared with the orchestrator</div>
        {#each sorted as file (file.path)}
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-start gap-2 rounded-lg border-none bg-transparent px-2 py-1.5 text-left hover:bg-code focus-visible:bg-code focus-visible:outline-none {file.status ===
            'declined'
              ? 'opacity-60'
              : ''}"
            title="Open {file.path}"
            onclick={() => choose(file.path)}
          >
            <span class="codicon codicon-{icon[file.kind]} mt-0.5 {file.status === 'pending' ? 'text-orange' : 'text-violet'}"></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-mono text-[0.85em]">{name(file.path)}</span>
              <span class="block truncate text-[0.75em] text-muted">{statusText[file.status] || folder(file.path)}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
