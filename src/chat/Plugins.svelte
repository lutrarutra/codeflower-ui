<script lang="ts">
  // The agent's own plugins in a sandbox's project (docs/plugins.md): what is
  // installed and in which state, a catalog to browse where the agent has
  // one, and any source to add. Changes apply when the agent restarts. Works
  // the same in the app's page and in a VS Code panel; nothing here knows
  // which agent it is.
  import { onMount } from 'svelte';
  import type { CatalogPlugin, PluginContents, PluginEntry, PluginsOverview } from '../client/codeflower.ts';
  import type { PluginsHostMessage, PluginsMethod, PluginsWebviewMessage } from '../protocol/plugins.ts';
  import type { Host } from './lib/host.ts';
  import Skeleton from './lib/Skeleton.svelte';

  let { host }: { host: Host<PluginsWebviewMessage, PluginsHostMessage> } = $props();

  let agentLabel = $state('the agent');
  let appFetch = $state(false);
  let fetchHint = $state<string | undefined>();
  let overview = $state<PluginsOverview | undefined>();
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let tab = $state<'installed' | 'browse'>('installed');
  let catalogName = $state<string | undefined>();
  let catalog = $state<{ name: string; fetched: boolean; plugins: CatalogPlugin[] } | undefined>();
  let search = $state('');
  let category = $state('');
  let source = $state('');
  let catalogSource = $state('');
  /** The catalog plugin whose details show. */
  let opened = $state<string | undefined>();
  /** A plugin waiting for the user to accept what it may run. */
  let confirming = $state<string | undefined>();

  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;

  function call<T>(method: PluginsMethod, params?: Record<string, unknown>): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      host.send({ type: 'call', id, method, ...(params ? { params } : {}) });
    });
  }

  async function refresh(): Promise<void> {
    try {
      overview = await call<PluginsOverview>('list');
      const names = (overview.catalogs ?? []).flatMap((entry) => (entry.name ? [entry.name] : []));
      if (!catalogName || !names.includes(catalogName)) catalogName = names[0];
      if (tab === 'browse' && catalogName) await loadCatalog();
    } catch (cause) {
      error = describe(cause);
    }
  }

  async function loadCatalog(): Promise<void> {
    if (!catalogName) return;
    try {
      catalog = await call('catalog', { catalog: catalogName });
    } catch (cause) {
      error = describe(cause);
    }
  }

  /** Runs a change and shows how it went; the worker's `changed` brings the new list. */
  async function act(method: PluginsMethod, params?: Record<string, unknown>, done?: string): Promise<boolean> {
    busy = true;
    error = '';
    notice = '';
    try {
      const result = await call<{ pendingFetch?: boolean }>(method, params);
      if (result?.pendingFetch) {
        notice = 'This sandbox has no network: fetch the plugins below before they can be used.';
      } else if (done) {
        notice = done;
      }
      await refresh();
      return true;
    } catch (cause) {
      error = describe(cause);
      return false;
    } finally {
      busy = false;
    }
  }

  function describe(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  onMount(() => {
    const stop = host.listen((message) => {
      if (message.type === 'context') {
        agentLabel = message.agentLabel;
        appFetch = message.appFetch;
        fetchHint = message.fetchHint;
        void refresh();
      } else if (message.type === 'changed') {
        void refresh();
      } else if (message.type === 'result') {
        const waiting = pending.get(message.id);
        pending.delete(message.id);
        if (message.error !== undefined) waiting?.reject(new Error(message.error));
        else waiting?.resolve(message.result);
      }
    });
    host.send({ type: 'ready' });
    return stop;
  });

  const entries = $derived(overview?.entries ?? []);
  const added = $derived(new Set(entries.map((entry) => entry.source)));
  const needsFetch = $derived(entries.some((entry) => entry.state === 'pending' || entry.state === 'error'));
  const catalogsToFetch = $derived((overview?.catalogs ?? []).some((entry) => !entry.fetched));
  const canFetchHere = $derived(overview?.canFetch === true);
  const categories = $derived([...new Set((catalog?.plugins ?? []).flatMap((plugin) => (plugin.category ? [plugin.category] : [])))].sort());
  const shown = $derived.by(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return (catalog?.plugins ?? []).filter(
      (plugin) =>
        (!category || plugin.category === category) &&
        words.every((word) => `${plugin.name} ${plugin.displayName ?? ''} ${plugin.description}`.toLowerCase().includes(word))
    );
  });

  const STATE: Record<PluginEntry['state'], { text: string; tone: string }> = {
    pending: { text: 'not fetched', tone: 'bg-yellow-soft text-orange' },
    fetching: { text: 'fetching…', tone: 'bg-indigo-soft text-indigo' },
    error: { text: 'failed', tone: 'bg-pink-soft text-red' },
    fetched: { text: 'after restart', tone: 'bg-indigo-soft text-indigo' },
    active: { text: 'on', tone: 'bg-green-soft text-green' },
    disabled: { text: 'off', tone: 'bg-code text-muted' }
  };

  /** What may run outside the agent's turns: hooks and servers, or nothing known before it is fetched. */
  function risk(contents: PluginContents | undefined): string | undefined {
    if (!contents) return 'What this plugin adds is known only once it is fetched; it may run hooks or start servers.';
    const parts = [contents.hooks && 'hooks that run on the agent\'s events', contents.mcpServers && 'MCP servers', contents.lspServers && 'language servers'];
    const named = parts.filter(Boolean);
    return named.length ? `This plugin runs ${named.join(' and ')} inside the sandbox.` : undefined;
  }

  function summary(contents: PluginContents | undefined): string {
    if (!contents) return '';
    const parts = [
      contents.skills && `${contents.skills} skill${contents.skills === 1 ? '' : 's'}`,
      contents.commands && `${contents.commands} command${contents.commands === 1 ? '' : 's'}`,
      contents.agents && `${contents.agents} agent${contents.agents === 1 ? '' : 's'}`,
      contents.hooks && 'hooks',
      contents.mcpServers && 'MCP servers',
      contents.lspServers && 'language servers'
    ];
    return parts.filter(Boolean).join(' · ');
  }

  async function install(plugin: CatalogPlugin): Promise<void> {
    if (confirming !== plugin.source && risk(plugin.contents)) {
      confirming = plugin.source;
      return;
    }
    confirming = undefined;
    await act('add', { source: plugin.source }, `Added ${plugin.displayName ?? plugin.name}.`);
  }

  async function addSource(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (source.trim() && (await act('add', { source: source.trim() }, `Added ${source.trim()}.`))) source = '';
  }

  async function addCatalog(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (catalogSource.trim() && (await act('addCatalog', { source: catalogSource.trim() }, 'Added the catalog.'))) catalogSource = '';
  }

  async function fetchNow(): Promise<void> {
    await act(canFetchHere ? 'fetch' : 'appFetch', undefined, canFetchHere ? 'Fetching…' : 'Fetched.');
  }

  async function restart(): Promise<void> {
    await act('restart', undefined, `${agentLabel} restarted with its plugins.`);
  }

  async function showBrowse(): Promise<void> {
    tab = 'browse';
    await loadCatalog();
  }
</script>

<main class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-auto px-4 py-6">
  <header>
    <h1 class="m-0 font-display text-2xl font-medium">{agentLabel} plugins</h1>
    <p class="m-0 text-muted">
      The agent's own plugins in this sandbox's project. The app's config may add some to every project; switch those off here
      for this one.
    </p>
  </header>

  {#if !overview}
    {#if error}
      <p class="m-0 text-red">{error}</p>
    {:else}
      <Skeleton lines={['70%', '55%', '62%']} class="py-1" />
    {/if}
  {:else if !overview.available}
    <p class="m-0 text-muted">{agentLabel} has no plugins in code flower yet, or this sandbox's image is older than plugins.</p>
  {:else}
    {#if overview.restartPending}
      <section class="card flex flex-wrap items-center gap-3 border-indigo! p-4">
        <p class="m-0 min-w-0 flex-1">Changes apply when {agentLabel} restarts. Chats keep their history; working chats must stop first.</p>
        <button class="pill pill-small pill-primary" disabled={busy} onclick={() => void restart()}>Restart the agent</button>
      </section>
    {/if}
    {#if needsFetch || (tab === 'browse' && catalogsToFetch)}
      <section class="card flex flex-wrap items-center gap-3 p-4">
        {#if canFetchHere || appFetch}
          <p class="m-0 min-w-0 flex-1">
            {canFetchHere ? 'Some plugins are not fetched yet.' : 'This sandbox has no network; the app can fetch the plugins for it.'}
          </p>
          <button class="pill pill-small" disabled={busy || overview.fetching} onclick={() => void fetchNow()}>
            {overview.fetching ? 'Fetching…' : 'Fetch now'}
          </button>
        {:else}
          <p class="m-0 min-w-0 flex-1 text-muted">
            This sandbox has no network. {fetchHint ?? 'Run `codeflower plugins fetch` for its project where there is internet access, then restart the agent.'}
          </p>
        {/if}
      </section>
    {/if}
    {#if error}<p class="m-0 text-red" role="alert">{error}</p>{/if}
    {#if notice}<p class="m-0 text-muted" role="status">{notice}</p>{/if}

    <div class="flex gap-1.5" role="tablist">
      <button role="tab" aria-selected={tab === 'installed'} class="pill pill-small {tab === 'installed' ? 'pill-primary' : ''}" onclick={() => (tab = 'installed')}>
        Installed
      </button>
      {#if overview.browsable}
        <button role="tab" aria-selected={tab === 'browse'} class="pill pill-small {tab === 'browse' ? 'pill-primary' : ''}" onclick={() => void showBrowse()}>
          Browse
        </button>
      {/if}
    </div>

    {#if tab === 'installed'}
      <section class="card flex flex-col gap-2 p-4">
        {#if entries.length}
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            {#each entries as entry (entry.id)}
              <li class="flex flex-wrap items-center gap-2">
                <label class="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    disabled={busy}
                    onchange={(event) => void act('setEnabled', { id: entry.id, enabled: event.currentTarget.checked })}
                  />
                  <span class="truncate font-mono text-[0.9em]" title={entry.source}>{entry.source}</span>
                </label>
                {#if entry.version}<span class="text-[0.8em] text-muted">{entry.version}</span>{/if}
                <span class="rounded-full px-2 py-0.5 text-[0.8em] font-semibold {STATE[entry.state].tone}">{STATE[entry.state].text}</span>
                <span class="text-[0.8em] text-muted" title={entry.origin === 'config' ? "From the app's config.yaml" : 'Added to this project'}>
                  {entry.origin === 'config' ? 'config' : 'project'}
                </span>
                {#if entry.origin === 'project'}
                  <button class="pill pill-small" disabled={busy} aria-label="Remove {entry.source}" onclick={() => void act('remove', { id: entry.id })}>
                    Remove
                  </button>
                {/if}
                {#if entry.error}<p class="m-0 w-full text-[0.85em] text-red">{entry.error}</p>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="m-0 text-muted">No plugins yet. {overview.browsable ? 'Browse a catalog, or add' : 'Add'} one from its source below.</p>
        {/if}
      </section>

      {#if overview.native?.length}
        <section class="card flex flex-col gap-2 p-4">
          <h2 class="m-0 font-display text-lg font-medium">Installed in {agentLabel} itself</h2>
          <p class="m-0 text-muted">Plugins the agent installed on its own, e.g. from a chat; change them there.</p>
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            {#each overview.native as plugin (plugin.name)}
              <li class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-mono text-[0.9em]">{plugin.name}</span>
                {#if plugin.version}<span class="text-[0.8em] text-muted">{plugin.version}</span>{/if}
                <span class="text-[0.8em] text-muted">{plugin.enabled ? 'on' : 'off'}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <form class="card flex flex-col gap-2 p-4" onsubmit={(event) => void addSource(event)}>
        <label for="plugin-source" class="font-semibold">Add from source</label>
        <p class="m-0 text-[0.9em] text-muted">
          {agentLabel} takes {(overview.kinds ?? []).map((kind) => `${kind}:`).join(', ')}, e.g. <code>github:owner/repo#v1.0.0</code> or a
          path in the sandbox.
        </p>
        <div class="flex gap-2">
          <input id="plugin-source" class="min-w-0 flex-1" bind:value={source} placeholder="github:owner/repo" disabled={busy} />
          <button class="pill pill-small pill-primary" type="submit" disabled={busy || !source.trim()}>Add</button>
        </div>
      </form>
    {:else}
      <section class="card flex flex-col gap-3 p-4">
        <div class="flex flex-wrap items-center gap-2">
          {#if (overview.catalogs ?? []).length > 1}
            <select bind:value={catalogName} onchange={() => void loadCatalog()} aria-label="Catalog">
              {#each overview.catalogs ?? [] as entry (entry.source)}
                {#if entry.name}<option value={entry.name}>{entry.name}</option>{/if}
              {/each}
            </select>
          {:else if catalogName}
            <span class="font-semibold">{catalogName}</span>
          {/if}
          <input class="min-w-0 flex-1" type="search" bind:value={search} placeholder="Search plugins" aria-label="Search plugins" />
          {#if categories.length}
            <select bind:value={category} aria-label="Category">
              <option value="">All categories</option>
              {#each categories as name (name)}<option value={name}>{name}</option>{/each}
            </select>
          {/if}
        </div>
        {#if !catalog}
          <Skeleton lines={['70%', '60%']} class="py-1" />
        {:else if !catalog.fetched}
          <p class="m-0 text-muted">This catalog is not fetched yet. Fetch it to browse it.</p>
        {:else if !shown.length}
          <p class="m-0 text-muted">No plugin matches.</p>
        {:else}
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            {#each shown as plugin (plugin.source)}
              <li class="rounded-lg px-2 py-1.5 hover:bg-soft-line">
                <div class="flex items-start gap-2">
                  <button class="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left" aria-expanded={opened === plugin.source}
                          onclick={() => (opened = opened === plugin.source ? undefined : plugin.source)}>
                    <span class="font-semibold">{plugin.displayName ?? plugin.name}</span>
                    {#if plugin.category}<span class="ml-1 text-[0.8em] text-muted">{plugin.category}</span>{/if}
                    <span class="line-clamp-2 block text-[0.9em] text-muted">{plugin.description}</span>
                  </button>
                  {#if added.has(plugin.source)}
                    <span class="rounded-full bg-green-soft px-2 py-0.5 text-[0.8em] font-semibold text-green">added</span>
                  {:else}
                    <button class="pill pill-small" disabled={busy} onclick={() => void install(plugin)}>Add</button>
                  {/if}
                </div>
                {#if opened === plugin.source}
                  <dl class="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-[0.85em]">
                    {#if plugin.contents}<dt class="text-muted">Adds</dt><dd class="m-0">{summary(plugin.contents) || 'nothing listed'}</dd>{/if}
                    {#if plugin.version}<dt class="text-muted">Version</dt><dd class="m-0">{plugin.version}</dd>{/if}
                    {#if plugin.author}<dt class="text-muted">By</dt><dd class="m-0">{plugin.author}</dd>{/if}
                    {#if plugin.homepage}<dt class="text-muted">Home</dt><dd class="m-0 truncate"><a href={plugin.homepage} target="_blank" rel="noreferrer">{plugin.homepage}</a></dd>{/if}
                    <dt class="text-muted">Source</dt><dd class="m-0 truncate font-mono">{plugin.source}</dd>
                  </dl>
                {/if}
                {#if confirming === plugin.source}
                  <div class="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-yellow-soft p-2 text-[0.9em]" role="alert">
                    <span class="min-w-0 flex-1">{risk(plugin.contents)} Add it only if you trust its author.</span>
                    <button class="pill pill-small" onclick={() => (confirming = undefined)}>Cancel</button>
                    <button class="pill pill-small pill-primary" disabled={busy} onclick={() => void install(plugin)}>Add anyway</button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <form class="card flex flex-col gap-2 p-4" onsubmit={(event) => void addCatalog(event)}>
        <label for="catalog-source" class="font-semibold">Add a catalog</label>
        <p class="m-0 text-[0.9em] text-muted">Another marketplace, e.g. <code>github:owner/repo</code>, a git URL, or a path in the sandbox.</p>
        <div class="flex gap-2">
          <input id="catalog-source" class="min-w-0 flex-1" bind:value={catalogSource} placeholder="github:owner/repo" disabled={busy} />
          <button class="pill pill-small" type="submit" disabled={busy || !catalogSource.trim()}>Add</button>
        </div>
        {#each (overview.catalogs ?? []).filter((entry) => entry.origin === 'project') as entry (entry.source)}
          <div class="flex items-center gap-2 text-[0.9em]">
            <span class="min-w-0 flex-1 truncate font-mono">{entry.name ?? entry.source}</span>
            {#if entry.error}<span class="text-red">{entry.error}</span>{:else if !entry.fetched}<span class="text-muted">not fetched</span>{/if}
            <button class="pill pill-small" disabled={busy} onclick={() => void act('removeCatalog', { source: entry.source })}>Remove</button>
          </div>
        {/each}
      </form>
    {/if}
  {/if}
</main>
