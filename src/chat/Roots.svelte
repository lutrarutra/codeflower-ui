<script lang="ts">
  // Roots: the project's map of analysis ideas, which the agents keep with
  // codeflower-roots. Each idea sits below the ideas it builds on; a side panel
  // shows the chosen one: its chats, todos, needs, conclusion, files and
  // comments. Works the same in the app's page and in a VS Code panel.
  import { onMount } from 'svelte';
  import {
    IDEA_STATUSES,
    needMet,
    unansweredComments,
    type Idea,
    type IdeaPatch,
    type IdeaStatus,
    type RootsChat,
    type RootsHostMessage,
    type RootsMap,
    type RootsMethod,
    type RootsWebviewMessage
  } from '../protocol/roots.ts';
  import ErrorState from './lib/ErrorState.svelte';
  import type { Host } from './lib/host.ts';
  import Markdown from './lib/Markdown.svelte';
  import Skeleton from './lib/Skeleton.svelte';

  let { host }: { host: Host<RootsWebviewMessage, RootsHostMessage> } = $props();

  const STATUS_COLOR: Record<IdeaStatus, string> = {
    idea: 'var(--cf-violet)',
    active: 'var(--cf-teal)',
    blocked: 'var(--cf-orange)',
    done: 'var(--cf-green)',
    dropped: 'var(--cf-muted)'
  };
  const CHAT_STATE: Record<RootsChat['state'], string> = { working: 'working', waiting: 'waiting for you', idle: 'idle' };

  let label = $state('');
  let map = $state<RootsMap | undefined>();
  let chats = $state(new Map<string, RootsChat>());
  let selected = $state<number | undefined>();
  let hidden = $state(new Set<IdeaStatus>());
  let error = $state('');
  let loadError = $state('');
  let busy = $state(false);
  let comment = $state('');
  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;

  function call<T>(method: RootsMethod, params?: Record<string, unknown>): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      host.send({ type: 'call', id, method, ...(params ? { params } : {}) });
    });
  }

  const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  function say(text: string): void {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2600);
  }

  async function load(): Promise<void> {
    loadError = '';
    try {
      map = await call<RootsMap>('list');
    } catch (cause) {
      loadError = describe(cause);
    }
  }

  async function update(id: number, patch: IdeaPatch): Promise<void> {
    busy = true;
    error = '';
    try {
      await call('update', { id, patch });
    } catch (cause) {
      error = describe(cause);
    } finally {
      busy = false;
    }
  }

  async function sendComment(idea: Idea): Promise<void> {
    const text = comment.trim();
    if (!text) return;
    busy = true;
    error = '';
    try {
      const result = await call<{ told?: string }>('comment', { id: idea.id, text });
      comment = '';
      const chat = result.told ? chats.get(result.told) : undefined;
      say(
        chat
          ? `Sent to “${chat.title}” as a notice`
          : result.told
            ? 'Saved on the idea; its chat gets it when it next runs'
            : 'Saved on the idea; no chat is working on it'
      );
    } catch (cause) {
      error = describe(cause);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    const stop = host.listen((message) => {
      switch (message.type) {
        case 'context':
          label = message.label;
          return;
        case 'map': {
          const first = !map;
          map = message.map;
          if (first && !moved) requestAnimationFrame(fit);
          return;
        }
        case 'chats':
          chats = new Map(message.chats.map((chat) => [chat.key, chat]));
          return;
        case 'focus':
          selected = message.idea;
          requestAnimationFrame(() => center(message.idea));
          return;
        case 'result': {
          const waiter = pending.get(message.id);
          if (!waiter) return;
          pending.delete(message.id);
          if (message.error !== undefined) waiter.reject(new Error(message.error));
          else waiter.resolve(message.result);
          return;
        }
      }
    });
    host.send({ type: 'ready' });
    void load();
    return stop;
  });

  // ---- layout: rows by how deep an idea builds, each below its parents ----

  const W = 228;
  const H = 112;
  const GX = 36;
  const GY = 64;

  const ideas = $derived(map?.ideas ?? []);
  const byId = $derived(new Map(ideas.map((idea) => [idea.id, idea])));
  const current = $derived(selected === undefined ? undefined : byId.get(selected));

  const placed = $derived.by(() => {
    const depth = new Map<number, number>();
    const visiting = new Set<number>();
    const depthOf = (idea: Idea): number => {
      const known = depth.get(idea.id);
      if (known !== undefined) return known;
      if (visiting.has(idea.id)) return 0;
      visiting.add(idea.id);
      const parents = idea.from.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      const value = parents.length ? 1 + Math.max(...parents.map(depthOf)) : 0;
      depth.set(idea.id, value);
      return value;
    };
    const rows: Idea[][] = [];
    for (const idea of ideas) (rows[depthOf(idea)] ??= []).push(idea);
    const x = new Map<number, number>();
    const parentX = (idea: Idea) => {
      const known = idea.from.filter((id) => x.has(id));
      return known.length ? known.reduce((sum, id) => sum + x.get(id)!, 0) / known.length : 0;
    };
    rows.forEach((row, index) => {
      if (index) row.sort((a, b) => parentX(a) - parentX(b) || a.id - b.id);
      let cursor = 0;
      for (const idea of row) {
        const at = Math.max(cursor, index ? parentX(idea) : cursor);
        x.set(idea.id, at);
        cursor = at + W + GX;
      }
    });
    const left = Math.min(0, ...x.values());
    return new Map(ideas.map((idea) => [idea.id, { x: (x.get(idea.id) ?? 0) - left, y: (depth.get(idea.id) ?? 0) * (H + GY) }]));
  });

  const bounds = $derived.by(() => {
    let w = 0;
    let h = 0;
    for (const { x, y } of placed.values()) {
      w = Math.max(w, x + W + GX * 2);
      h = Math.max(h, y + H);
    }
    return { w, h };
  });

  interface Edge {
    path: string;
    kind: 'from' | 'need';
    faint: boolean;
  }
  const edges = $derived.by(() => {
    const result: Edge[] = [];
    const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const x1 = a.x + W / 2;
      const y1 = a.y + H - 4;
      const x2 = b.x + W / 2;
      const y2 = b.y - 2;
      const mid = (y1 + y2) / 2;
      return `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
    };
    // A need across several rows goes around the ideas between, on their right.
    const around = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      if (b.y - a.y <= H + GY) return curve(a, b);
      const x1 = a.x + W;
      const y1 = a.y + H / 2;
      const x2 = b.x + W;
      const y2 = b.y + H / 2;
      const side = Math.max(x1, x2) + GX * 1.5;
      return `M${x1} ${y1} C${side} ${y1} ${side} ${y2} ${x2 + 2} ${y2}`;
    };
    for (const idea of ideas) {
      const to = placed.get(idea.id);
      if (!to) continue;
      const faint = hidden.has(idea.status) || idea.status === 'dropped';
      for (const id of idea.from) {
        const from = placed.get(id);
        if (from) result.push({ path: curve(from, to), kind: 'from', faint });
      }
      for (const need of idea.needs) {
        // A need that is met no longer matters for the map; its panel still lists it.
        if (need.idea === undefined || idea.from.includes(need.idea) || needMet(need, byId)) continue;
        const from = placed.get(need.idea);
        if (from) result.push({ path: around(from, to), kind: 'need', faint: hidden.has(idea.status) });
      }
    }
    return result;
  });

  const counts = $derived(Object.fromEntries(IDEA_STATUSES.map((status) => [status, ideas.filter((idea) => idea.status === status).length])));

  // ---- pan and zoom ----

  let canvas = $state<HTMLElement | undefined>();
  let view = $state({ x: 24, y: 24, k: 1 });
  let drag: { x: number; y: number } | undefined;
  /** The user panned or zoomed: the map stays where they put it. */
  let moved = false;

  function fit(): void {
    if (!canvas || !ideas.length) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pad = 32;
    const k = Math.min(1.1, (rect.width - pad * 2) / Math.max(bounds.w, 1), (rect.height - pad * 2 - 36) / Math.max(bounds.h, 1));
    const scale = Math.max(0.3, k);
    view = { k: scale, x: Math.max(pad, (rect.width - bounds.w * scale) / 2), y: pad };
  }

  function center(id: number): void {
    const at = placed.get(id);
    if (!canvas || !at) return;
    const rect = canvas.getBoundingClientRect();
    view = { ...view, x: rect.width / 2 - (at.x + W / 2) * view.k, y: rect.height / 3 - (at.y + H / 2) * view.k };
  }

  function zoom(factor: number, cx?: number, cy?: number): void {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = cx ?? rect.width / 2;
    const py = cy ?? rect.height / 2;
    moved = true;
    const k = Math.min(2, Math.max(0.3, view.k * factor));
    view = { k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k };
  }

  function wheel(event: WheelEvent): void {
    event.preventDefault();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
    else if (event.shiftKey) view = { ...view, x: view.x - event.deltaY };
    else view = { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY };
    moved = true;
  }

  function pointerDown(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest('.node, button')) return;
    drag = { x: event.clientX - view.x, y: event.clientY - view.y };
    canvas?.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent): void {
    if (!drag) return;
    moved = true;
    view = { ...view, x: event.clientX - drag.x, y: event.clientY - drag.y };
  }

  // Fits the map to the tab as it gets its size (a new tab) or changes it, until the user moves it.
  $effect(() => {
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      if (!moved) fit();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  // ---- what an idea shows ----

  function select(id: number | undefined): void {
    if (id !== selected) comment = '';
    selected = id;
    error = '';
  }

  function chatOf(entry: Idea['chats'][number]): RootsChat | undefined {
    return entry.key ? chats.get(entry.key) : undefined;
  }

  const kindOf = (path: string) => {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    const kinds: Record<string, string> = { png: 'IMG', jpg: 'IMG', jpeg: 'IMG', svg: 'SVG', pdf: 'PDF', py: 'PY', r: 'R', ipynb: 'NB', csv: 'CSV', tsv: 'TSV', html: 'HTML', md: 'MD', h5ad: 'H5AD', parquet: 'PQ' };
    return kinds[extension] ?? (extension.slice(0, 4).toUpperCase() || 'FILE');
  };

  const when = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const today = new Date().toDateString() === date.toDateString();
    return today ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };
</script>

<div class="roots">
  <header class="bar">
    <h1 class="m-0 flex items-center gap-2 font-display text-lg font-medium">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class="h-5 w-5 text-teal">
        <path d="M12 3v7M12 10c-3 2-5 4-6 9M12 10c3 2 5 4 6 9M12 10v10M9 15c-1 1-2 2-2 4M15 15c1 1 2 2 2 4" />
      </svg>
      Roots
    </h1>
    {#if label}<span class="text-[0.85em] text-muted">{label}</span>{/if}
    {#if ideas.length}
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Show ideas by status">
        {#each IDEA_STATUSES as status (status)}
          <button
            class="chip"
            aria-pressed={!hidden.has(status)}
            onclick={() => {
              const next = new Set(hidden);
              if (next.has(status)) next.delete(status);
              else next.add(status);
              hidden = next;
            }}
          >
            <span class="dot" style:background={STATUS_COLOR[status]}></span>{status} {counts[status]}
          </button>
        {/each}
      </div>
    {/if}
    <span class="flex-1"></span>
    {#if ideas.length}<button class="pill pill-small" onclick={() => ((moved = false), fit())}>Fit</button>{/if}
  </header>

  {#if loadError}
    <div class="p-6">
      <ErrorState title="The map could not load" detail={loadError}>
        <button class="pill pill-small" onclick={() => void load()}>Try again</button>
      </ErrorState>
    </div>
  {:else if !map}
    <div class="p-6"><Skeleton /></div>
  {:else if !ideas.length && !map.errors.length}
    <div class="empty">
      <h2 class="m-0 font-display text-xl font-medium">No ideas yet</h2>
      <p class="m-0 text-muted">
        Agents start an idea here before they analyse, and branch from it as the work grows: what each idea builds on, its todos, what
        it needs, the files it made and what it found. Start a chat and ask for an analysis, and its first idea appears here.
      </p>
    </div>
  {:else}
    <div class="main" class:open={current !== undefined}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="canvas"
        bind:this={canvas}
        onwheel={wheel}
        onpointerdown={pointerDown}
        onpointermove={pointerMove}
        onpointerup={() => (drag = undefined)}
        onpointercancel={() => (drag = undefined)}
      >
        <div class="world" style:transform="translate({view.x}px, {view.y}px) scale({view.k})">
          <svg class="edges" width={bounds.w} height={bounds.h} aria-hidden="true">
            <defs>
              <marker id="roots-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" fill="var(--cf-muted)" />
              </marker>
              <marker id="roots-arrow-need" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" fill="var(--cf-orange)" />
              </marker>
            </defs>
            {#each edges as edge, index (index)}
              <path
                d={edge.path}
                fill="none"
                stroke={edge.kind === 'need' ? 'var(--cf-orange)' : 'var(--cf-muted)'}
                stroke-width="2"
                stroke-dasharray={edge.kind === 'from' ? undefined : '5 4'}
                marker-end="url(#{edge.kind === 'need' ? 'roots-arrow-need' : 'roots-arrow'})"
                opacity={edge.faint ? 0.3 : 1}
              />
            {/each}
          </svg>
          {#each ideas as idea (idea.id)}
            {@const at = placed.get(idea.id)}
            {@const done = idea.todos.filter((todo) => todo.done).length}
            {@const unmet = idea.needs.filter((need) => !needMet(need, byId)).length}
            {@const asks = unansweredComments(idea).length}
            <button
              class="node {idea.status}"
              class:origin={!idea.from.length}
              class:selected={idea.id === selected}
              class:dim={hidden.has(idea.status)}
              style:left="{at?.x ?? 0}px"
              style:top="{at?.y ?? 0}px"
              onclick={() => select(idea.id === selected ? undefined : idea.id)}
            >
              <span class="top">
                <span class="id">#{idea.id}</span>
                <span class="status s-{idea.status}">{idea.status}</span>
                <span class="chats">
                  {#each idea.chats as entry, index (index)}
                    {@const chat = chatOf(entry)}
                    <span class="chat-dot c-{chat?.state ?? 'idle'}" title="{chat?.title ?? entry.agent ?? 'A chat'}: {CHAT_STATE[chat?.state ?? 'idle']}"></span>
                  {/each}
                </span>
              </span>
              <span class="title">{idea.title}</span>
              <span class="meta">
                {#if idea.todos.length}
                  <span>{done}/{idea.todos.length}</span>
                  <span class="progress"><i style:width="{(done / idea.todos.length) * 100}%"></i></span>
                {/if}
                {#if unmet}<span class="warn">{unmet} need{unmet === 1 ? '' : 's'}</span>{/if}
                {#if asks}<span class="asks" title="Your comments the agents have not answered">✎ {asks}</span>{/if}
                {#if idea.files.length}<span>{idea.files.length} file{idea.files.length === 1 ? '' : 's'}</span>{/if}
              </span>
            </button>
          {/each}
        </div>
        <div class="legend">
          <span><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--cf-muted)" stroke-width="2" /></svg>builds on</span>
          <span><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--cf-orange)" stroke-width="2" stroke-dasharray="5 4" /></svg>needs</span>
          <span><span class="chat-dot c-working"></span>working</span>
          <span><span class="chat-dot c-waiting"></span>waiting for you</span>
        </div>
        <div class="zoom">
          <button class="pill pill-small" aria-label="Zoom out" onclick={() => zoom(1 / 1.2)}>−</button>
          <button class="pill pill-small" aria-label="Zoom in" onclick={() => zoom(1.2)}>+</button>
        </div>
        {#if map.errors.length}
          <div class="broken" role="alert">
            {#each map.errors as broken (broken.file)}<p class="m-0">roots/{broken.file} cannot be read: {broken.error}</p>{/each}
          </div>
        {/if}
      </div>

      {#if current}
        {@const idea = current}
        {@const kids = ideas.filter((other) => other.from.includes(idea.id))}
        {@const done = idea.todos.filter((todo) => todo.done).length}
        <aside class="panel" aria-label="Idea {idea.id}">
          <div class="flex items-center gap-2">
            <span class="id">#{idea.id}</span>
            <select
              class="status-select"
              aria-label="Status"
              value={idea.status}
              disabled={busy}
              onchange={(event) => void update(idea.id, { status: event.currentTarget.value as IdeaStatus })}
            >
              {#each IDEA_STATUSES as status (status)}<option value={status}>{status}</option>{/each}
            </select>
            <span class="flex-1"></span>
            <button class="close" aria-label="Close" onclick={() => select(undefined)}>×</button>
          </div>
          <h2 class="m-0 font-display text-xl font-medium [text-wrap:balance]">{idea.title}</h2>
          <p class="m-0 text-[0.88em] text-muted">
            {#if idea.from.length}
              Builds on
              {#each idea.from as id, index (id)}{index ? ', ' : ' '}<button class="link" onclick={() => (select(id), center(id))}>#{id} {byId.get(id)?.title ?? ''}</button>{/each}
            {:else}
              Starts from the data
            {/if}
            {#if kids.length}
              <br />Leads to
              {#each kids as kid, index (kid.id)}{index ? ', ' : ' '}<button class="link" onclick={() => (select(kid.id), center(kid.id))}>#{kid.id}</button>{/each}
            {/if}
          </p>
          {#if error}<p class="m-0 text-red" role="alert">{error}</p>{/if}

          <section>
            <h3>Chats</h3>
            <div class="flex flex-col gap-1.5">
              {#each [...idea.chats].reverse() as entry, index (index)}
                {@const chat = chatOf(entry)}
                <div class="chat-row">
                  <span class="chat-dot c-{chat?.state ?? 'idle'}"></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate">{chat?.title ?? 'A chat of this project'}</span>
                    <small class="text-muted">{chat ? CHAT_STATE[chat.state] : 'not listed in this sandbox'} · {when(entry.at)}</small>
                  </span>
                  {#if chat?.agentLabel ?? entry.agent}<span class="agent">{chat?.agentLabel ?? entry.agent}</span>{/if}
                  {#if entry.key && chat}
                    <button class="pill pill-small" onclick={() => host.send({ type: 'openChat', key: entry.key! })}>Open</button>
                  {/if}
                </div>
              {:else}
                <p class="m-0 text-[0.9em] text-muted">No chat has worked on it yet.</p>
              {/each}
              <div>
                <button class="pill pill-small pill-primary" onclick={() => host.send({ type: 'newChat', idea: idea.id, title: idea.title })}>
                  New chat on this idea
                </button>
              </div>
            </div>
          </section>

          {#if idea.todos.length}
            <section>
              <h3>To do <span class="tabular-nums">{done}/{idea.todos.length}</span></h3>
              <ul class="list">
                {#each idea.todos as todo, index (index)}
                  <li>
                    <label class="flex items-start gap-2" class:checked={todo.done}>
                      <input type="checkbox" checked={todo.done} disabled={busy} onchange={(event) => void update(idea.id, { todo: { index, done: event.currentTarget.checked } })} />
                      <span>{todo.text}</span>
                    </label>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if idea.needs.length}
            <section>
              <h3>Needs</h3>
              <ul class="list">
                {#each idea.needs as need, index (index)}
                  {@const met = needMet(need, byId)}
                  <li>
                    {#if need.idea !== undefined}
                      <span class="mark" class:met>{met ? '✓' : '○'}</span>
                      <span>
                        <button class="link" onclick={() => (select(need.idea), center(need.idea!))}>#{need.idea} {byId.get(need.idea)?.title ?? '(missing)'}</button>
                        <small class="text-muted">({byId.get(need.idea)?.status ?? 'missing'})</small>
                      </span>
                    {:else}
                      <label class="flex items-start gap-2" class:checked={met}>
                        <input type="checkbox" checked={met} disabled={busy} onchange={(event) => void update(idea.id, { need: { index, met: event.currentTarget.checked } })} />
                        <span>{need.text}</span>
                      </label>
                    {/if}
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          <section>
            <h3>Conclusion</h3>
            {#if idea.conclusion}
              <div class="conclusion"><Markdown text={idea.conclusion} openFile={(path) => host.send({ type: 'openFile', path })} /></div>
            {:else}
              <p class="conclusion m-0 italic text-muted">Not concluded yet. The agent writes it when this line of work ends.</p>
            {/if}
          </section>

          {#if idea.files.length}
            <section>
              <h3>Files</h3>
              <div class="flex flex-col gap-0.5">
                {#each idea.files as file (file)}
                  <button class="file" onclick={() => host.send({ type: 'openFile', path: file })}><span class="kind">{kindOf(file)}</span><span class="truncate">{file}</span></button>
                {/each}
              </div>
            </section>
          {/if}

          <section>
            <h3>Comments</h3>
            <div class="flex flex-col gap-2">
              {#each idea.comments as entry, index (index)}
                <div class="comment {entry.by}">
                  <small class="block text-muted">{entry.by === 'user' ? 'You' : (entry.agent ?? 'Agent')} · {when(entry.at)}</small>
                  {entry.text}
                </div>
              {/each}
              <form class="flex flex-col gap-1.5" onsubmit={(event) => (event.preventDefault(), void sendComment(idea))}>
                <textarea
                  id="roots-comment"
                  rows="3"
                  placeholder="Comment on this idea"
                  bind:value={comment}
                  onkeydown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void sendComment(idea);
                    }
                  }}
                ></textarea>
                <div class="flex items-center justify-between gap-2">
                  <small class="text-muted">
                    {#if idea.chats.some((entry) => entry.key)}The chat working on it gets it as a notice{:else}Kept on the idea until an agent reads it{/if}
                  </small>
                  <button class="pill pill-small pill-primary" type="submit" disabled={busy || !comment.trim()}>Comment</button>
                </div>
              </form>
            </div>
          </section>
        </aside>
      {/if}
    </div>
  {/if}
  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</div>

<style>
  .roots {
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--cf-paper);
    color: var(--cf-ink);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    padding: 10px 16px;
    background: var(--cf-sunken);
    border-bottom: 1px solid var(--cf-soft-line);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px 2px 8px;
    border: 1px solid var(--cf-line);
    border-radius: 999px;
    background: var(--cf-card);
    font-size: 0.82em;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .chip[aria-pressed='false'] {
    opacity: 0.45;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .empty {
    max-width: 36rem;
    margin: 12vh auto 0;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: center;
  }
  .main {
    display: grid;
    grid-template-columns: 1fr;
    min-height: 0;
  }
  .main.open {
    grid-template-columns: 1fr minmax(300px, 380px);
  }
  .canvas {
    position: relative;
    overflow: hidden;
    min-height: 0;
    cursor: grab;
    touch-action: none;
    background-image: radial-gradient(var(--cf-soft-line) 1px, transparent 1px);
    background-size: 22px 22px;
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .edges {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
  }
  .node {
    position: absolute;
    width: 228px;
    min-height: 92px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px 9px;
    text-align: left;
    color: inherit;
    font: inherit;
    background: var(--cf-card);
    border: 1px solid var(--cf-soft-line);
    border-radius: 14px;
    box-shadow: var(--cf-elevation);
    cursor: pointer;
  }
  .node:hover {
    box-shadow: var(--cf-hover);
  }
  .node:focus-visible {
    outline: 2px solid var(--cf-indigo);
    outline-offset: 2px;
  }
  .node.selected {
    border-color: var(--cf-indigo);
    box-shadow: 0 0 0 2px var(--cf-indigo), var(--cf-hover);
  }
  .node.dim {
    opacity: 0.35;
  }
  .node.origin::before {
    content: 'origin';
    position: absolute;
    top: -9px;
    left: 12px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--cf-muted);
    background: var(--cf-paper);
    border: 1px solid var(--cf-soft-line);
    border-radius: 6px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .id {
    font-family: var(--font-mono);
    font-size: 0.8em;
    font-weight: 600;
    color: var(--cf-muted);
  }
  .status {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 0.75em;
    font-weight: 600;
  }
  .s-idea {
    background: var(--cf-violet-soft);
    color: var(--cf-violet);
  }
  .s-active {
    background: var(--cf-teal-soft);
    color: var(--cf-teal);
  }
  .s-blocked {
    background: color-mix(in srgb, var(--cf-orange) 18%, var(--cf-card));
    color: var(--cf-orange);
  }
  .s-done {
    background: var(--cf-green-soft);
    color: var(--cf-green);
  }
  .s-dropped {
    background: var(--cf-sunken);
    color: var(--cf-muted);
  }
  .title {
    font-weight: 600;
    line-height: 1.3;
  }
  .node.dropped .title {
    text-decoration: line-through;
    color: var(--cf-muted);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: auto;
    font-size: 0.78em;
    color: var(--cf-muted);
    font-variant-numeric: tabular-nums;
  }
  .progress {
    flex: 1;
    min-width: 40px;
    height: 5px;
    border-radius: 3px;
    background: var(--cf-sunken);
    overflow: hidden;
  }
  .progress i {
    display: block;
    height: 100%;
    background: var(--cf-green);
  }
  .warn {
    color: var(--cf-orange);
    font-weight: 600;
  }
  .asks {
    color: var(--cf-pink);
    font-weight: 600;
  }
  .chats {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }
  .chat-dot {
    display: inline-block;
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--cf-line);
  }
  .c-working {
    background: var(--cf-teal);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .c-waiting {
    background: var(--cf-yellow);
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--cf-teal) 25%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .c-working {
      animation: none;
    }
  }
  .legend {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: 6px 10px;
    font-size: 0.75em;
    color: var(--cf-muted);
    background: var(--cf-card);
    border: 1px solid var(--cf-soft-line);
    border-radius: 10px;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .zoom {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 4px;
  }
  .broken {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 12px;
    padding: 8px 12px;
    font-size: 0.85em;
    color: var(--cf-red);
    background: var(--cf-card);
    border: 1px solid var(--cf-red);
    border-radius: 10px;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 18px 28px;
    background: var(--cf-card);
    border-left: 1px solid var(--cf-soft-line);
  }
  .panel h3 {
    margin: 0 0 8px;
    display: flex;
    gap: 6px;
    font-size: 0.72em;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--cf-muted);
  }
  .status-select {
    padding: 1px 8px;
    font-size: 0.82em;
    color: inherit;
    background: var(--cf-card);
    border: 1px solid var(--cf-line);
    border-radius: 999px;
  }
  .close {
    padding: 0 6px;
    font-size: 20px;
    line-height: 1;
    color: var(--cf-muted);
    background: none;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .close:hover {
    background: var(--cf-sunken);
  }
  .link {
    padding: 0;
    font: inherit;
    color: var(--cf-indigo);
    background: none;
    border: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .list input {
    margin-top: 3px;
    accent-color: var(--cf-green);
  }
  .checked span {
    color: var(--cf-muted);
    text-decoration: line-through;
  }
  .mark {
    font-weight: 700;
    color: var(--cf-orange);
  }
  .mark.met {
    color: var(--cf-green);
  }
  .chat-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: 1px solid var(--cf-soft-line);
    border-radius: 10px;
  }
  .agent {
    padding: 3px 6px;
    font-size: 0.72em;
    font-weight: 600;
    color: var(--cf-muted);
    background: var(--cf-sunken);
    border-radius: 6px;
  }
  .conclusion {
    padding: 10px 12px;
    font-size: 0.95em;
    background: var(--cf-paper);
    border: 1px solid var(--cf-soft-line);
    border-radius: 12px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    font-family: var(--font-mono);
    font-size: 0.85em;
    text-align: left;
    color: var(--cf-indigo);
    background: none;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
    min-width: 0;
  }
  .file:hover {
    background: var(--cf-sunken);
  }
  .kind {
    flex: none;
    width: 38px;
    padding: 3px 0;
    font-family: var(--font-sans);
    font-size: 0.72em;
    font-weight: 600;
    text-align: center;
    color: var(--cf-indigo);
    background: var(--cf-indigo-soft);
    border-radius: 5px;
  }
  .comment {
    max-width: 92%;
    padding: 7px 10px;
    font-size: 0.92em;
    border-radius: 12px;
    white-space: pre-wrap;
  }
  .comment.user {
    align-self: flex-end;
    background: var(--cf-pink-soft);
  }
  .comment.agent {
    background: var(--cf-sunken);
  }
  textarea {
    width: 100%;
    resize: vertical;
    padding: 8px 10px;
    font: inherit;
    color: inherit;
    background: var(--cf-paper);
    border: 1px solid var(--cf-line);
    border-radius: 10px;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    padding: 8px 14px;
    font-size: 0.9em;
    color: var(--cf-paper);
    background: var(--cf-ink);
    border-radius: 999px;
    box-shadow: var(--cf-elevation);
  }
  @media (max-width: 720px) {
    .main.open {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr auto;
    }
    .panel {
      max-height: 55vh;
      border-left: 0;
      border-top: 1px solid var(--cf-soft-line);
    }
  }
</style>
