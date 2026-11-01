<script lang="ts">
  // The Focus view's sidebar: the chats of every sandbox, those that need the user first.
  import ChatTitle from '../../chat/lib/ChatTitle.svelte';
  import { app } from '../lib/app.svelte.ts';
  import { chatty } from '../lib/focus.svelte.ts';
  import { WAITING_FOR, workerTitle } from '../lib/format.ts';
  import StatusDot from '../lib/StatusDot.svelte';
  import { age, PHASE_DOT } from './phase.ts';

  let { onNavigate }: { onNavigate: () => void } = $props();

  // The ages count up while the list shows.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 5000);
    return () => clearInterval(timer);
  });

  const ready = $derived(app.workers.filter((worker) => chatty(worker) && worker.status === 'ready'));
  let choosing = $state(false);
  let creating = $state(false);
  let error = $state('');

  async function newChat(workerId: string): Promise<void> {
    choosing = false;
    creating = true;
    error = '';
    try {
      const key = await app.agent(workerId).newChat();
      if (key) app.go({ view: 'focus', worker: workerId, session: key });
      onNavigate();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      creating = false;
    }
  }

  const HINT: Record<string, string> = {
    waiting: 'Agents waiting for an answer, longest first',
    working: 'Agents working on a turn',
    done: 'Agents that finished while you were elsewhere',
    idle: 'Chats changed in the last hours, and the ones you pinned'
  };
</script>

<div class="flex min-h-0 flex-1 flex-col border-t-[1.5px] border-soft-line">
  <div class="relative px-2 pt-2 pb-1">
    <button
      class="pill pill-small pill-primary w-full justify-center"
      disabled={creating || !ready.length}
      title={ready.length ? 'Start a chat in a sandbox of your choice' : 'No sandbox is ready'}
      aria-haspopup="menu"
      aria-expanded={choosing}
      onclick={() => (choosing = !choosing)}
    >
      <span class="codicon codicon-add"></span>{creating ? 'Starting…' : 'New chat'}
      <span class="codicon codicon-chevron-down text-[12px]!"></span>
    </button>
    {#if choosing}
      <button class="fixed inset-0 z-40 cursor-default" aria-label="Close the menu" onclick={() => (choosing = false)}></button>
      <div role="menu" aria-label="Sandbox" class="card absolute inset-x-2 top-full z-50 flex flex-col p-1 text-[0.9em]">
        <div class="eyebrow px-2 pt-1 pb-0.5 text-muted">Start the chat in</div>
        {#each ready as worker (worker.id)}
          {@const [name, where] = workerTitle(worker)}
          {@const busy = (worker.activity?.working ?? 0) + (worker.activity?.waiting ?? 0)}
          <button role="menuitem" class="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-soft-line" onclick={() => void newChat(worker.id)}>
            <span class="flex items-center gap-2">
              <StatusDot {worker} />
              <span class="min-w-0 flex-1 truncate font-semibold">{name}</span>
              {#if busy}<span class="shrink-0 text-[0.85em] text-muted">{busy} at work</span>{/if}
            </span>
            <span class="truncate pl-[1.1rem] text-[0.85em] text-muted">{where}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if error}<p class="m-0 px-1 pt-1 text-[0.85em] text-red">{error}</p>{/if}
  </div>

  <div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
    {#each app.focus.groups as group (group.id)}
      <div class="eyebrow flex items-center gap-1.5 px-2 pt-3 pb-1 text-muted" title={HINT[group.id]}>
        {group.label}<span class="font-normal">· {group.chats.length}</span>
      </div>
      <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
        {#each group.chats as chat (chat.workerId + '/' + chat.key)}
          {@const selected = app.focus.selected?.workerId === chat.workerId && app.focus.selected.key === chat.key}
          <li class="group relative">
            <button
              class="flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left text-[0.9em] pointer-coarse:py-2.5 {selected
                ? 'bg-card shadow-[0_0_0_1px_var(--cf-line)]'
                : 'hover:bg-card'}"
              aria-current={selected ? 'page' : undefined}
              onclick={() => {
                app.focus.select(chat);
                onNavigate();
              }}
            >
              <span class="flex w-full min-w-0 items-center gap-2 pr-5">
                <span class="size-2 shrink-0 rounded-full {PHASE_DOT[group.id === 'done' ? 'done' : chat.phase]}" class:animate-pulse={chat.phase === 'working'}></span>
                <span class="flex min-w-0 flex-1" class:font-semibold={group.id === 'waiting' || group.id === 'done'}><ChatTitle title={chat.title} /></span>
                {#if group.id !== 'idle'}
                  <span class="shrink-0 text-[0.8em] text-muted tabular-nums" title="For {age(now - chat.since)}">{age(now - chat.since)}</span>
                {/if}
              </span>
              <span class="truncate pl-4 text-[0.85em] text-muted">
                {chat.sandbox}{#if chat.waitingFor}{' · '}<span class="text-orange">{WAITING_FOR[chat.waitingFor]}</span>{/if}
              </span>
            </button>
            <button
              class="absolute top-1.5 right-1 grid size-6 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100 {chat.pinned
                ? ''
                : 'opacity-0 group-hover:opacity-100'}"
              title={chat.pinned ? 'Unpin: it leaves the list once idle for a while' : 'Pin: keep it in the list while idle'}
              aria-label={chat.pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
              aria-pressed={chat.pinned}
              onclick={() => app.focus.togglePin(chat)}
            >
              <span class="codicon {chat.pinned ? 'codicon-pinned' : 'codicon-pin'} text-[13px]!"></span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="m-0 px-2 py-3 text-[0.9em] text-muted">
        {ready.length ? 'No agent at work. Start a chat, and it shows here while it works or waits for you.' : 'No sandbox is ready. Start one under Server.'}
      </p>
    {/each}
  </div>
</div>
