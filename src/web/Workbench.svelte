<script lang="ts">
  // A sandbox's tabs in a grid of groups, arranged as in VS Code by dragging
  // tabs. The grid lays out the strips and leaves each group's body empty; what
  // the tabs show lies in a layer above, placed over its group's body. Moving a
  // tab or splitting a group so never reloads a chat or a running report.
  import { untrack } from 'svelte';
  import App from '../chat/App.svelte';
  import { fileKind, kindIcon } from '../chat/lib/files.ts';
  import Skeleton from '../chat/lib/Skeleton.svelte';
  import PreviewView from '../chat/Preview.svelte';
  import FileTree from './FileTree.svelte';
  import GridNode from './GridNode.svelte';
  import type { Worker } from './lib/api.ts';
  import { app } from './lib/app.svelte.ts';
  import type { Grid, TabLabel } from './lib/grid.ts';
  import type { Placement } from './lib/layout.svelte.ts';
  import { FILES, INTERACTIVE } from './lib/previews.svelte.ts';
  import { chatKeyOf, dragging, endDrag, OVERVIEW } from './lib/workbench.svelte.ts';
  import type { WebWorker } from './lib/worker.svelte.ts';
  import ReportFrame from './ReportFrame.svelte';
  import WorkerOverview from './WorkerOverview.svelte';
  import { workerTitle } from './lib/format.ts';

  let { worker, agent, elsewhere }: { worker: Worker; agent: WebWorker; elsewhere: boolean } = $props();
  const workbench = $derived(app.workbench(worker.id));
  const layout = $derived(workbench.layout);

  interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  let container: HTMLElement | undefined = $state();
  let width = $state(0);
  /** Where each group's body is, relative to the workbench. */
  let rects = $state<Record<string, Rect>>({});
  const bodies = new Map<string, HTMLElement>();
  let resizing = $state(false);
  let target = $state<Placement | null>(null);
  const narrow = $derived(width > 0 && width < 640);
  const dragged = $derived(dragging.tab !== null);

  let frame = 0;
  function measureAll(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!container) return;
      const origin = container.getBoundingClientRect();
      const next: Record<string, Rect> = {};
      for (const [id, body] of bodies) {
        const box = body.getBoundingClientRect();
        next[id] = { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
      }
      rects = next;
    });
  }

  const observer = new ResizeObserver(() => measureAll());
  $effect(() => {
    if (!container) return;
    observer.observe(container);
    return () => observer.disconnect();
  });

  // Splitting or closing a group moves the others.
  $effect(() => {
    void JSON.stringify(layout.root);
    void narrow;
    measureAll();
  });

  // The grid is remembered as the user leaves it.
  $effect(() => {
    void JSON.stringify(layout.root);
    untrack(() => workbench.save());
  });

  // Chats in the grid connect once the sandbox is ready; a chat deleted elsewhere leaves it.
  $effect(() => {
    if (!agent.sessionsKnown) return;
    const known = new Set(agent.sessions.map((session) => session.key));
    const ready = worker.status === 'ready' && !elsewhere;
    for (const tab of layout.tabs()) {
      const key = chatKeyOf(tab);
      if (!key || agent.chats[key]) continue;
      if (!known.has(key)) untrack(() => workbench.remove(tab));
      else if (ready) untrack(() => void agent.open(key));
    }
  });

  // Previews of files that went (the sandbox restarted) leave the grid too.
  $effect(() => {
    for (const tab of layout.tabs()) {
      if (chatKeyOf(tab) || tab === FILES || tab === OVERVIEW) continue;
      if (!app.previews.find(worker.id, tab)) untrack(() => workbench.remove(tab));
    }
  });

  function label(tab: string): TabLabel {
    const key = chatKeyOf(tab);
    if (key) {
      const chat = agent.chats[key];
      const title = chat?.state.title || agent.sessions.find((session) => session.key === key)?.title || 'Chat';
      const status = chat?.status;
      return { icon: 'comment', label: title, title, chat: true, ...(status === 'working' || status === 'waiting' ? { status } : {}) };
    }
    if (tab === FILES) return { icon: 'list-tree', label: 'Files', title: 'The folders in the sandbox' };
    if (tab === OVERVIEW) return { icon: 'home', label: workerTitle(worker)[0], title: 'The sandbox: its chats and sign-in' };
    const preview = app.previews.find(worker.id, tab);
    const interactive = tab.endsWith(INTERACTIVE);
    return {
      icon: interactive ? 'play' : preview ? kindIcon[fileKind(preview.file.mimeType)] : 'file',
      label: `${preview?.title ?? tab}${interactive ? ' (interactive)' : ''}`,
      title: preview?.file.path ?? tab
    };
  }

  const grid: Grid = {
    get workbench() {
      return workbench;
    },
    label,
    measure(groupId, body) {
      if (body) {
        bodies.set(groupId, body);
        observer.observe(body);
      } else {
        const old = bodies.get(groupId);
        if (old) observer.unobserve(old);
        bodies.delete(groupId);
      }
      measureAll();
    },
    dragOver(placement) {
      // A group's only tab cannot split its own group.
      const source = dragging.tab ? layout.groupOf(dragging.tab) : undefined;
      const pointless = placement && source?.id === placement.group && source.tabs.length === 1;
      target = pointless ? null : placement;
    },
    drop() {
      if (target && dragging.tab) workbench.drop(dragging.tab, target);
      target = null;
      endDrag();
    },
    target: () => target,
    accepts: () => !narrow && dragging.tab !== null && dragging.workerId === worker.id,
    setResizing(value) {
      resizing = value;
    },
    get narrow() {
      return narrow;
    },
    empty
  };

  /** Where the dragged tab would land, over its group's body. */
  const highlight = $derived.by((): Rect | null => {
    if (!target || target.index !== undefined) return null;
    const rect = rects[target.group];
    if (!rect) return null;
    switch (target.side) {
      case 'left':
        return { ...rect, width: rect.width / 2 };
      case 'right':
        return { ...rect, x: rect.x + rect.width / 2, width: rect.width / 2 };
      case 'top':
        return { ...rect, height: rect.height / 2 };
      case 'bottom':
        return { ...rect, y: rect.y + rect.height / 2, height: rect.height / 2 };
      default:
        return rect;
    }
  });

  const shown = $derived(narrow ? layout.group(layout.focused) : undefined);
  const style = (rect: Rect) => `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
</script>

{#snippet empty()}
  <WorkerOverview {worker} {agent} {elsewhere} />
{/snippet}

<!-- A drag that leaves the window, or ends on no group, lands nowhere. -->
<svelte:window ondragend={() => (target = null)} ondrop={() => ((target = null), endDrag())} />

<div
  bind:this={container}
  bind:clientWidth={width}
  role="presentation"
  class="relative h-full min-h-0"
  class:select-none={resizing}
  ondragleave={(event) => {
    if (!container?.contains(event.relatedTarget as Node | null)) target = null;
  }}
>
  <GridNode node={shown ?? layout.root} {grid} />

  <!-- What the tabs show, each over its group's body; the hidden ones stay loaded. -->
  <div class="pointer-events-none absolute inset-0">
    {#each layout.tabs() as tab (tab)}
      {@const group = layout.groupOf(tab)}
      {@const rect = group ? rects[group.id] : undefined}
      {@const visible = !!rect && group?.active === tab}
      <div
        class="absolute overflow-hidden bg-paper"
        class:invisible={!visible}
        class:hidden={!rect}
        class:pointer-events-auto={visible && !dragged && !resizing}
        style={rect ? style(rect) : ''}
        role="presentation"
        onpointerdowncapture={() => group && workbench.focus(group.id)}
      >
        {@render content(tab)}
      </div>
    {/each}
  </div>

  {#if highlight}
    <div
      class="pointer-events-none absolute rounded-md border-2 border-indigo/60 bg-indigo/15 transition-all duration-100"
      style={style(highlight)}
    ></div>
  {/if}
</div>

{#snippet content(tab: string)}
  {@const key = chatKeyOf(tab)}
  {#if key}
    {@const chat = agent.chats[key]}
    {#if chat}
      {#key chat}
        <App host={chat.host} />
      {/key}
    {:else}
      <div class="mx-auto w-full max-w-3xl p-4"><Skeleton lines={['40%', '90%', '75%']} /></div>
    {/if}
  {:else if tab === FILES}
    <FileTree workerId={worker.id} />
  {:else if tab === OVERVIEW}
    <WorkerOverview {worker} {agent} {elsewhere} />
  {:else}
    {@const preview = app.previews.find(worker.id, tab)}
    {#if preview && tab.endsWith(INTERACTIVE)}
      <ReportFrame
        html={preview.html}
        title="{preview.title} (interactive)"
        onMessage={(message) => (message.type === 'send' ? preview.draft(message.text) : message.type === 'comments' && preview.saveComments(message.json))}
      />
    {:else if preview}
      <PreviewView host={preview.host} />
    {/if}
  {/if}
{/snippet}
