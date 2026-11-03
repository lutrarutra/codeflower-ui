<script lang="ts" module>
  export { choices, groups, matches, SEARCH_FROM, shownGroups, type SelectOption } from './picker.ts';
</script>

<script lang="ts">
  import type { SessionConfigSelectOption } from '@agentclientprotocol/sdk';
  import type { Snippet } from 'svelte';
  import { choices, SEARCH_FROM, shownGroups, type SelectOption } from './picker.ts';

  // A compact selector that opens a card above the composer. With `favorite`,
  // each choice can be pinned, and pinned ones come first.
  let {
    option,
    choose,
    trigger,
    triggerClass = '',
    favorites = [],
    favorite
  }: {
    option: SelectOption;
    choose: (value: string) => void;
    trigger: Snippet<[SessionConfigSelectOption | undefined]>;
    triggerClass?: string;
    favorites?: readonly string[];
    favorite?: (value: string, pinned: boolean) => void;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let root: HTMLElement | undefined = $state();
  let list: HTMLElement | undefined = $state();
  let search: HTMLInputElement | undefined = $state();
  const current = $derived(choices(option).find((choice) => choice.value === option.currentValue));
  const searchable = $derived(choices(option).length >= SEARCH_FROM);
  const shown = $derived(shownGroups(option, query, favorite ? favorites : []));

  function toggle(): void {
    open = !open;
    query = '';
    if (open) {
      queueMicrotask(() =>
        (searchable ? search : list?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]'))?.focus()
      );
    }
  }

  function pick(value: string): void {
    open = false;
    root?.querySelector<HTMLElement>('button')?.focus();
    if (value !== option.currentValue) choose(value);
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
    const items = [...(list?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  // Enter in the search box takes the first match.
  function searchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = shown[0]?.options[0];
    if (first) pick(first.value);
  }
</script>

<svelte:window
  onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }}
/>

<div class="relative" bind:this={root} onkeydown={keydown} role="presentation">
  <button
    type="button"
    class="chip {triggerClass}"
    aria-haspopup="menu"
    aria-expanded={open}
    title={option.description ?? option.name}
    onclick={toggle}
  >
    {@render trigger(current)}
    <span class="codicon codicon-chevron-up text-[11px]! opacity-60 transition-transform {open ? '' : 'rotate-180'}"></span>
  </button>

  {#if open}
    <div
      bind:this={list}
      role="menu"
      aria-label={option.name}
      class="card absolute bottom-full left-0 z-20 mb-2 flex max-h-80 w-72 flex-col overflow-x-hidden overflow-y-auto p-1.5"
    >
      <!-- The search box stays in view while a long list scrolls under it. -->
      <div class="{searchable ? 'sticky -top-1.5 z-10 -mx-1.5 -mt-1.5 bg-card px-1.5 pt-1.5' : ''}">
        <div class="eyebrow px-2 pt-1 pb-1.5 text-indigo">{option.name}</div>
        {#if searchable}
          <input
            bind:this={search}
            bind:value={query}
            type="search"
            class="field mx-1 mb-1.5 w-[calc(100%-0.5rem)]"
            placeholder="Search {option.name.toLowerCase()}…"
            aria-label="Search {option.name.toLowerCase()}"
            spellcheck="false"
            onkeydown={searchKeydown}
          />
        {/if}
      </div>
      {#each shown as group, index (`${index}:${group.name}`)}
        {#if group.name}
          <div class="flex items-center gap-1 px-2 pt-1.5 text-[0.75em] font-semibold text-muted">
            {#if group.pinned}<span class="codicon codicon-pinned text-[11px]!"></span>{/if}{group.name}
          </div>
        {/if}
        {#each group.options as choice (choice.value)}
          {@const selected = choice.value === option.currentValue}
          {@const pinned = favorites.includes(choice.value)}
          <div class="group flex items-start rounded-lg hover:bg-code focus-within:bg-code">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              class="flex min-w-0 flex-1 items-start gap-2 rounded-lg border-none bg-transparent px-2 py-1.5 text-left focus-visible:outline-none"
              onclick={() => pick(choice.value)}
            >
              <span class="codicon codicon-check mt-[3px] {selected ? 'text-indigo' : 'invisible'}"></span>
              <span class="min-w-0 flex-1">
                <span class="block font-semibold">{choice.name}</span>
                {#if choice.description}<span class="block text-[0.8em] text-muted">{choice.description}</span>{/if}
              </span>
            </button>
            {#if favorite}
              <button
                type="button"
                tabindex="-1"
                class="mt-1 mr-1 rounded border-none bg-transparent px-1 py-0.5 hover:text-indigo {pinned
                  ? 'text-indigo!'
                  : 'text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}"
                title={pinned ? 'Unpin' : 'Pin to the top'}
                aria-label="{pinned ? 'Unpin' : 'Pin'} {choice.name}"
                aria-pressed={pinned}
                onclick={(event) => {
                  event.stopPropagation();
                  favorite(choice.value, !pinned);
                }}
              >
                <span class="codicon {pinned ? 'codicon-pinned' : 'codicon-pin'}"></span>
              </button>
            {/if}
          </div>
        {/each}
      {:else}
        <div class="px-2 py-1.5 text-muted">No {option.name.toLowerCase()} matches “{query}”</div>
      {/each}
    </div>
  {/if}
</div>
