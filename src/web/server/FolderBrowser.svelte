<script lang="ts">
  // Picks a folder on this computer through the app, which can see the disk.
  import type { FolderListing } from '../lib/api.ts';
  import type { Machine } from '../lib/machines.svelte.ts';

  let {
    machine,
    title,
    canCreate,
    start,
    onchoose,
    onclose
  }: { machine: Machine; title: string; canCreate: boolean; start: string; onchoose: (path: string) => void; onclose: () => void } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let listing = $state<FolderListing | null>(null);
  let location = $state('');
  let error = $state('');

  async function browse(path: string): Promise<void> {
    error = '';
    try {
      listing = await machine.api<FolderListing>(`/api/folders?${new URLSearchParams({ path })}`);
      location = listing.path;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
  }

  async function create(): Promise<void> {
    const name = prompt('Name of the new folder:', 'results');
    if (!name || !listing) return;
    try {
      const folder = await machine.api<{ path: string }>('/api/folders', { body: { parent: listing.path, name } });
      await browse(folder.path);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
  }

  $effect(() => {
    dialog?.showModal();
    // svelte-ignore state_referenced_locally
    void browse(start);
  });
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="browser-title">
  <div class="card flex max-h-[85vh] flex-col gap-3 p-5">
    <header class="flex items-center gap-2">
      <h2 id="browser-title" class="m-0 flex-1 font-display text-lg font-medium">{title}</h2>
      <button class="chip" aria-label="Close" onclick={() => dialog?.close()}><span class="codicon codicon-close"></span></button>
    </header>
    <div class="flex items-center gap-2">
      <button class="chip" title="Up one folder" aria-label="Up one folder" disabled={!listing?.parent} onclick={() => listing?.parent && browse(listing.parent)}
        ><span class="codicon codicon-arrow-up"></span></button
      >
      <input
        class="field font-mono text-[0.9em]"
        bind:value={location}
        aria-label="Folder path"
        spellcheck="false"
        onkeydown={(event) => event.key === 'Enter' && (event.preventDefault(), browse(location.trim()))}
      />
      <button class="pill pill-small" onclick={() => browse(location.trim())}>Go</button>
    </div>
    <div class="flex min-h-0 flex-1 gap-3">
      <nav class="flex w-36 shrink-0 flex-col gap-0.5" aria-label="Places">
        {#each listing?.places ?? [] as place (place.path)}
          <button class="truncate rounded-lg px-2 py-1 text-left text-[0.9em] hover:bg-soft-line" title={place.path} onclick={() => browse(place.path)}
            >{place.name}</button
          >
        {/each}
      </nav>
      <ul class="m-0 min-h-48 flex-1 list-none overflow-auto rounded-xl border-[1.5px] border-soft-line p-1" role="listbox" aria-label="Folders">
        {#each listing?.folders ?? [] as folder (folder.path)}
          <li>
            <button class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-soft-line" title={folder.path} onclick={() => browse(folder.path)}>
              <span class="codicon codicon-folder text-muted"></span>{folder.name}
            </button>
          </li>
        {:else}
          <li class="px-2 py-1 text-muted">{listing ? 'No folders here' : 'Loading…'}</li>
        {/each}
      </ul>
    </div>
    {#if error}<p class="m-0 text-red">{error}</p>{/if}
    <footer class="flex flex-wrap items-center gap-2">
      <span class="flex-1 text-[0.85em] text-muted">
        {#if listing}{listing.folders.length} folder{listing.folders.length === 1 ? '' : 's'}, {listing.files} file{listing.files === 1 ? '' : 's'}{/if}
      </span>
      {#if canCreate}<button class="pill pill-small" onclick={create}>New folder</button>{/if}
      <button class="pill" onclick={() => dialog?.close()}>Cancel</button>
      <button
        class="pill pill-primary"
        disabled={!listing}
        onclick={() => {
          if (listing) onchoose(listing.path);
          dialog?.close();
        }}>Use this folder</button
      >
    </footer>
  </div>
</dialog>
