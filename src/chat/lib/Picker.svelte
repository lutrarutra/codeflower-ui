<script lang="ts" module>
  export { choices, groups, matches, SEARCH_FROM, shownGroups, type SelectOption } from './picker.ts';
</script>

<script lang="ts">
  import type { SessionConfigSelectOption } from '@agentclientprotocol/sdk';
  import { tick, type Snippet } from 'svelte';
  import { choices, SEARCH_FROM, shownGroups, type SelectOption } from './picker.ts';

  // A compact selector that opens a card above the composer. With `favorite`,
  // each choice can be pinned, and pinned ones come first. `footer` stays at
  // the card's foot while the list scrolls (the model menu's effort slider).
  let {
    option,
    choose,
    trigger,
    triggerClass = '',
    favorites = [],
    favorite,
    footer,
    label
  }: {
    option: SelectOption;
    choose: (value: string) => void;
    trigger: Snippet<[SessionConfigSelectOption | undefined]>;
    triggerClass?: string;
    favorites?: readonly string[];
    favorite?: (value: string, pinned: boolean) => void;
    footer?: Snippet;
    /** What the trigger's title and label say, when it shows more than the option. */
    label?: string;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let root: HTMLElement | undefined = $state();
  let list: HTMLElement | undefined = $state();
  let search: HTMLInputElement | undefined = $state();
  const current = $derived(choices(option).find((choice) => choice.value === option.currentValue));
  const searchable = $derived(choices(option).length >= SEARCH_FROM);
  const shown = $derived(shownGroups(option, query, favorite ? favorites : []));

  /** How tall the card may be: the room above it, so a short window still shows a long list. */
  let room = $state<number>();

  async function toggle(): Promise<void> {
    open = !open;
    query = '';
    if (!open) return;
    room = undefined;
    await tick();
    const card = list?.parentElement;
    if (card) room = Math.max(160, card.getBoundingClientRect().bottom - 8);
    await tick();
    (searchable ? search : list?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]'))?.focus();
    // The chosen one in the middle of a long list. Only the list
    // scrolls, not the chat behind it.
    const chosen = list?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (chosen && list) {
      const offset = chosen.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      list.scrollTop = Math.max(0, offset - (list.clientHeight - chosen.offsetHeight) / 2);
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
    // The footer's slider takes its own arrows.
    if ((event.target as HTMLElement).closest('.picker-footer')) return;
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

<div class="anchor relative" bind:this={root} onkeydown={keydown} role="presentation">
  <button
    type="button"
    class="chip {triggerClass}"
    aria-haspopup="menu"
    aria-expanded={open}
    title="{label ?? `${option.name}: ${current?.name ?? option.currentValue}`}{option.description ? `\n${option.description}` : ''}"
    aria-label={label ?? `${option.name}: ${current?.name ?? option.currentValue}`}
    onclick={toggle}
  >
    {@render trigger(current)}
    <span class="codicon codicon-chevron-up text-[11px]! opacity-60 transition-transform {open ? '' : 'rotate-180'}"></span>
  </button>

  {#if open}
    <!-- Only the list scrolls, inside the card's rounded edge: the name and search above it, the footer below. -->
    <div class="card absolute bottom-full left-0 z-20 mb-2 flex w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
      style:max-height={room ? `min(40rem, ${room}px)` : '40rem'}
    >
      <!-- The title line: the option's name, and the search box beside it in a long list. -->
      <div class="flex shrink-0 items-center gap-3 px-1.5 pt-1.5 pb-1">
        <div class="eyebrow shrink-0 px-2 py-1 text-indigo">{option.name}</div>
        {#if searchable}
          <input
            bind:this={search}
            bind:value={query}
            type="search"
            class="field mr-0.5 min-w-0 flex-1 py-1! text-[0.9em]"
            placeholder="Search {option.name.toLowerCase()}…"
            aria-label="Search {option.name.toLowerCase()}"
            spellcheck="false"
            onkeydown={searchKeydown}
          />
        {/if}
      </div>
      <div bind:this={list} role="menu" aria-label={option.name} class="thin-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-1.5 {footer ? '' : 'pb-1.5'}">
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
      {#if footer}
        <div class="picker-footer shrink-0 border-t border-soft-line px-1.5 pb-1.5">
          {@render footer()}
        </div>
      {/if}
    </div>
  {/if}
</div>
