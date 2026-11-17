<script lang="ts">
  import { isImage } from './files.ts';
  import type { ShownFile } from './transcript.ts';

  // The files the agent showed the user in this chat, to open again without
  // finding them in the file tree or scrolling back to where they were shown.
  let { files, open: openFile }: { files: ShownFile[]; open: (path: string) => void } = $props();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let list: HTMLElement | undefined = $state();

  const label = $derived(`Shown files (${files.length})`);

  function toggle(): void {
    open = !open;
    if (open) queueMicrotask(() => list?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }

  function choose(path: string): void {
    open = false;
    root?.querySelector<HTMLElement>('button')?.focus();
    openFile(path);
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

<div class="relative shrink-0" bind:this={root} onkeydown={keydown} role="presentation">
  <button
    type="button"
    class="flex h-7 items-center gap-1 rounded-lg px-1.5 text-[0.8em] font-semibold text-muted hover:bg-sunken hover:text-ink aria-expanded:bg-sunken aria-expanded:text-ink"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    title="{label}: open a file the agent showed you"
    onclick={toggle}
  >
    <span class="codicon codicon-files"></span>
    <span class="hidden @2xl:inline">Shown files</span>
    <span class="tabular-nums">{files.length}</span>
    <span class="codicon codicon-chevron-down text-[12px]!"></span>
  </button>

  {#if open}
    <div
      bind:this={list}
      role="menu"
      aria-label="Shown files"
      class="card absolute top-full right-0 z-30 mt-2 flex max-h-96 w-80 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto p-1.5"
    >
      <div class="eyebrow px-2 pt-1 pb-1.5 text-teal">{label}</div>
      {#each files as file (file.path)}
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-start gap-2 rounded-lg border-none bg-transparent px-2 py-1.5 text-left hover:bg-code focus-visible:bg-code focus-visible:outline-none"
          title="Open {file.path}{file.message ? `\n${file.message}` : ''}"
          onclick={() => choose(file.path)}
        >
          <span class="codicon {isImage(file.path) ? 'codicon-file-media' : 'codicon-file'} mt-0.5 text-teal"></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-mono text-[0.9em]">{name(file.path)}</span>
            {#if folder(file.path)}<span class="block truncate text-[0.8em] text-muted">{folder(file.path)}</span>{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
