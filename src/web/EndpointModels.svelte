<script lang="ts">
  // The models of an OpenAI-compatible endpoint that the agent's model picker offers: selected from those the
  // endpoint lists, which can be hundreds, or added by hand, each with its settings; at first those saved.
  // A pinned model is selected and also stands at the top of the chat's picker. The ones not selected stay
  // listed here only. Also tests that the endpoint answers and takes the key, the saved one when `keySaved`
  // and none is typed.
  import { untrack } from 'svelte';
  import type { EndpointCheck, EndpointModel, WorkerConnection } from '../client/workerConnection.ts';
  import type { AgentName } from '../protocol/messages.ts';

  let {
    connection,
    agent,
    baseURL,
    apiKey,
    keySaved = false,
    saved = [],
    savedPins = [],
    models = $bindable([]),
    pins = $bindable([])
  }: {
    connection: WorkerConnection | undefined;
    /** The agent whose endpoint this is. */
    agent: AgentName;
    baseURL: string;
    apiKey: string;
    keySaved?: boolean;
    saved?: EndpointModel[];
    /** The ids of the models pinned at first. */
    savedPins?: string[];
    models?: EndpointModel[];
    /** The ids of the models to pin, all of them in `models`. */
    pins?: string[];
  } = $props();

  /** A model the picker offers, with the settings to save: listed ones keep their id, added ones type it. */
  interface Row {
    id: string;
    name?: string;
    contextWindow?: number | null;
    image: boolean;
    thinks: boolean;
    listed: boolean;
    /** Keeps each row's fields with it when one above goes. */
    key: number;
  }
  let keys = 0;

  // An endpoint that lists at most this many has them all selected at first, and none otherwise.
  const SELECT_ALL_UP_TO = 8;

  const url = $derived(baseURL.trim());
  const urlReady = $derived(/^https?:\/\/\S+$/.test(url));

  let checking = $state(false);
  let check = $state<(EndpointCheck & { from: string; withKey: boolean }) | null>(null);
  let checkError = $state('');

  let fetching = $state(false);
  let listed = $state<EndpointModel[]>([]);
  let listedFrom = $state('');
  let listError = $state('');
  let filter = $state('');
  let selectedOnly = $state(false);

  let rows = $state<Row[]>([]);
  let pinList = $state<string[]>([]);
  $effect.pre(() => {
    const from = saved;
    const pinnedFrom = savedPins;
    untrack(() => {
      rows = from.map(toRow);
      pinList = [...pinnedFrom];
    });
  });

  const available = $derived(listedFrom === url ? listed : []);
  const selected = $derived(new Set(rows.map((row) => row.id.trim()).filter(Boolean)));
  const pinned = $derived(new Set(pinList.filter((id) => selected.has(id))));
  const shown = $derived(
    available.filter(
      (model) =>
        (!selectedOnly || selected.has(model.id)) &&
        (!filter.trim() || `${model.id} ${model.name ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()))
    )
  );

  $effect(() => {
    models = rows
      .filter((row) => row.id.trim())
      .map((row) => ({
        id: row.id.trim(),
        ...(row.name ? { name: row.name } : {}),
        ...(row.contextWindow && row.contextWindow > 0 ? { contextWindow: Math.round(row.contextWindow) } : {}),
        input: row.image ? ['text', 'image'] : ['text'],
        reasoning: row.thinks
      }));
    pins = [...pinned];
  });

  // With the key saved, the list is fetched at once, so the models not selected show too.
  let fetchedFirst = false;
  $effect(() => {
    if (fetchedFirst || !keySaved || !urlReady || !connection) return;
    fetchedFirst = true;
    untrack(() => void fetchModels());
  });

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  async function test(): Promise<void> {
    if (!connection || !urlReady) return;
    checking = true;
    checkError = '';
    const from = url;
    const withKey = !!apiKey.trim() || keySaved;
    try {
      check = { ...(await connection.checkEndpoint(agent, from, apiKey.trim())), from, withKey };
    } catch (error) {
      check = null;
      checkError = message(error);
    } finally {
      checking = false;
    }
  }

  async function fetchModels(): Promise<void> {
    if (!connection || !urlReady) return;
    fetching = true;
    listError = '';
    const from = url;
    try {
      const found = await connection.endpointModels(agent, from, apiKey.trim());
      listed = found;
      listedFrom = from;
      filter = '';
      selectedOnly = false;
      // The models already offered stay, listed or not.
      if (!rows.length && found.length <= SELECT_ALL_UP_TO) rows = found.map(toRow);
      if (!found.length) listError = 'The endpoint lists no models. Add them by hand below.';
    } catch (error) {
      listError = `${message(error)}. Add the models by hand below.`;
    } finally {
      fetching = false;
    }
  }

  function toRow(model: EndpointModel): Row {
    return {
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      image: !!model.input?.includes('image'),
      thinks: model.reasoning !== false,
      listed: true,
      key: keys++
    };
  }

  /** Offers the model in the chat's picker, or leaves it out (and unpins it). */
  function select(model: EndpointModel, on: boolean): void {
    if (on) {
      if (!selected.has(model.id)) rows = [...rows, toRow(model)];
    } else {
      rows = rows.filter((row) => row.id.trim() !== model.id);
      pinList = pinList.filter((id) => id !== model.id);
    }
  }

  /** Pins the model at the top of the chat's picker, which selects it, or unpins it. */
  function pin(id: string, on: boolean, model?: EndpointModel): void {
    if (on && model) select(model, true);
    pinList = on ? [...pinList.filter((other) => other !== id), id] : pinList.filter((other) => other !== id);
  }

  const allShownSelected = $derived(shown.length > 0 && shown.every((model) => selected.has(model.id)));

  /** Selects every model shown, or unselects them all when they all are. */
  function toggleAll(): void {
    if (allShownSelected) {
      const ids = new Set(shown.map((model) => model.id));
      rows = rows.filter((row) => !ids.has(row.id.trim()));
      pinList = pinList.filter((id) => !ids.has(id));
    } else {
      rows = [...rows, ...shown.filter((model) => !selected.has(model.id)).map(toRow)];
    }
  }

  function add(): void {
    rows = [...rows, { id: '', image: false, thinks: true, listed: false, key: keys++ }];
  }

  const contextText = (tokens: number) => (tokens >= 1024 ? `${Math.round(tokens / 1024)}k` : String(tokens));
</script>

{#snippet pinButton(id: string, on: boolean, model?: EndpointModel)}
  <button
    type="button"
    class="grid size-7 shrink-0 place-items-center rounded-lg disabled:opacity-30 {on ? 'bg-indigo/15 text-indigo' : 'text-muted hover:bg-soft-line hover:text-ink'}"
    aria-pressed={on}
    title={on ? 'Unpin it from the top of the chat’s model picker' : 'Pin it to the top of the chat’s model picker'}
    aria-label="{on ? 'Unpin' : 'Pin'} {id || 'the model'}"
    disabled={!id}
    onclick={() => pin(id, !on, model)}
  >
    <span class="codicon {on ? 'codicon-pinned' : 'codicon-pin'}"></span>
  </button>
{/snippet}

{#snippet line(ok: boolean | undefined, text: string)}
  <li class="flex items-start gap-1.5">
    <span
      class="codicon mt-0.5 shrink-0 {ok === true ? 'codicon-pass text-green' : ok === false ? 'codicon-error text-red' : 'codicon-question text-muted'}"
    ></span>
    <span>{text}</span>
  </li>
{/snippet}

<div class="flex flex-col gap-2">
  <div class="flex flex-wrap gap-1.5">
    <button type="button" class="pill pill-small" disabled={!urlReady || checking || !connection} onclick={test}
      >{#if checking}<span class="spinner"></span>{:else}<span class="codicon codicon-plug"></span>{/if}Test the connection</button
    >
    <button type="button" class="pill pill-small" disabled={!urlReady || fetching || !connection} onclick={fetchModels}
      >{#if fetching}<span class="spinner"></span>{:else}<span class="codicon codicon-cloud-download"></span>{/if}{available.length
        ? 'Fetch the models again'
        : 'Fetch the models'}</button
    >
  </div>

  {#if checkError}<p class="m-0 text-[0.9em] text-red" role="alert">{checkError}</p>{/if}
  {#if check && check.from === url}
    <ul class="m-0 flex list-none flex-col gap-0.5 p-0 text-[0.9em]" role="status">
      {#if !check.reachable}
        {@render line(false, check.error ?? 'The endpoint does not answer.')}
      {:else if check.modelsStatus === 404}
        {@render line(undefined, 'The server answers, but has no /models (404). Check that the URL is the API’s root, often ending in /v1.')}
      {:else}
        {@render line(true, `The endpoint answers (GET /models: ${check.modelsStatus}).`)}
      {/if}
      {#if check.reachable && check.withKey}
        {#if check.keyAccepted === true}
          {@render line(true, 'The key is accepted.')}
        {:else if check.keyAccepted === false}
          {@render line(false, `The key is rejected (${check.keyStatus}).`)}
        {:else}
          {@render line(undefined, `Could not tell whether the key is accepted${check.keyStatus ? ` (${check.keyStatus})` : ''}.`)}
        {/if}
      {:else if check.reachable}
        {@render line(undefined, 'Type the key to test it too.')}
      {/if}
    </ul>
  {/if}

  {#if listError}<p class="m-0 text-[0.9em] text-red" role="alert">{listError}</p>{/if}

  {#if available.length}
    <div class="flex flex-col gap-1.5 rounded-xl border-[1.5px] border-soft-line p-2">
      <div class="flex flex-wrap items-center gap-2">
        <input
          class="field min-w-40 flex-1"
          bind:value={filter}
          onkeydown={(event) => event.key === 'Enter' && event.preventDefault()}
          placeholder="Filter {available.length} models"
          aria-label="Filter the models"
          spellcheck="false"
        />
        <label class="flex items-center gap-1.5 text-[0.85em] text-muted"><input type="checkbox" bind:checked={selectedOnly} /> Selected only</label>
        <button type="button" class="pill pill-small" onclick={toggleAll} disabled={!shown.length}
          >{allShownSelected ? 'Unselect' : 'Select'} all {shown.length}{filter.trim() ? ' shown' : ''}</button
        >
      </div>
      <ul class="m-0 flex max-h-56 list-none flex-col overflow-auto p-0">
        {#each shown as model (model.id)}
          {@const on = selected.has(model.id)}
          {@const top = pinned.has(model.id)}
          <li class="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-soft-line">
            <input
              type="checkbox"
              class="shrink-0"
              checked={on}
              title={on ? 'Offered in the chat’s model picker: uncheck to leave it out' : 'Offer it in the chat’s model picker'}
              aria-label="Select {model.id}"
              onchange={(event) => select(model, event.currentTarget.checked)}
            />
            {@render pinButton(model.id, top, model)}
            <span class="flex min-w-0 flex-1 flex-col leading-tight {on ? '' : 'text-muted'}">
              <span class="truncate font-mono text-[0.9em]" title={model.id}>{model.id}</span>
              {#if model.name}<span class="truncate text-[0.8em] text-muted">{model.name}</span>{/if}
            </span>
            {#if model.contextWindow}<span class="tag shrink-0 bg-soft-line text-muted" title="Context window, in tokens">{contextText(model.contextWindow)}</span>{/if}
            {#if model.input?.includes('image')}<span class="tag shrink-0 bg-soft-line text-muted" title="Reads images">image</span>{/if}
            {#if model.reasoning}<span class="tag shrink-0 bg-violet-soft text-violet" title="Thinks">thinks</span>{/if}
          </li>
        {:else}
          <li class="px-2 py-1 text-[0.9em] text-muted">No model matches.</li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="flex flex-col gap-1">
    <span class="text-[0.9em] text-muted">
      {rows.length
        ? `The chat’s model picker offers ${rows.length === 1 ? 'this model' : `these ${rows.length} models`}${pinned.size ? ', the pinned ones at the top' : ''}:`
        : 'Select models above, or add them by hand.'}
    </span>
    {#each rows as row (row.key)}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border-[1.5px] border-soft-line px-2 py-1.5">
        {@render pinButton(row.id.trim(), pinned.has(row.id.trim()))}
        {#if row.listed}
          <span class="min-w-0 flex-1 truncate font-mono text-[0.9em]" title={row.name ?? row.id}>{row.id}</span>
        {:else}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="field min-w-40 flex-1 py-0.5! font-mono" bind:value={row.id} placeholder="Model id" aria-label="Model id" spellcheck="false" autofocus />
        {/if}
        <input
          class="field w-28! py-0.5!"
          type="number"
          min="1"
          bind:value={row.contextWindow}
          placeholder="Context"
          title="Context window, in tokens; blank for the agent's default"
          aria-label="Context window of {row.id || 'the model'}"
        />
        <label class="flex items-center gap-1 text-[0.85em]" title="The model reads images"><input type="checkbox" bind:checked={row.image} /> image</label>
        <label class="flex items-center gap-1 text-[0.85em]" title="The model thinks, and the chat offers the reasoning effort values"
          ><input type="checkbox" bind:checked={row.thinks} /> thinks</label
        >
        <button
          type="button"
          class="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft-line hover:text-ink"
          title="Leave it out of the model picker"
          aria-label="Remove {row.id || 'the model'}"
          onclick={() => {
            rows = rows.filter((other) => other !== row);
            pinList = pinList.filter((id) => id !== row.id.trim());
          }}
        >
          <span class="codicon codicon-close"></span>
        </button>
      </div>
    {/each}
    <button type="button" class="link self-start text-[0.9em]" onclick={add}><span class="codicon codicon-add"></span> Add a model by hand</button>
  </div>
</div>
