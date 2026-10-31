<script lang="ts">
  import {
    sessionStatus,
    type ChatState,
    type HostMessage,
    type PendingPermission,
    type PendingQuestion,
    type QueuedPromptSummary,
    type SessionStatus,
    type TranscriptEntry
  } from '../protocol/messages.ts';
  import type { ChatUsage } from '../protocol/usage.ts';
  import type { AvailableCommand, SessionConfigOption } from '@agentclientprotocol/sdk';
  import CommandMenu from './lib/CommandMenu.svelte';
  import ActionsMenu from './lib/ActionsMenu.svelte';
  import { provideChatHost, type ChatHost } from './lib/host.ts';
  import { provideSandboxFiles, SandboxFiles } from './lib/sandboxFiles.svelte.ts';
  import PermissionPrompt from './lib/PermissionPrompt.svelte';
  import QuestionCard from './lib/QuestionCard.svelte';
  import SettingsBar from './lib/SettingsBar.svelte';
  import Transcript from './lib/Transcript.svelte';
  import ChatTitle from './lib/ChatTitle.svelte';
  import Tulip from './lib/Tulip.svelte';
  import UsageMeter from './lib/UsageMeter.svelte';

  let { host }: { host: ChatHost } = $props();
  // svelte-ignore state_referenced_locally
  provideChatHost(host);
  // svelte-ignore state_referenced_locally
  const files = new SandboxFiles(host);
  provideSandboxFiles(files);
  const send = (message: Parameters<ChatHost['send']>[0]) => host.send(message);

  let chat = $state<ChatState>({ title: '', subtitle: '', live: false, busy: false });
  let entries = $state<TranscriptEntry[]>([]);
  /** The host sent the transcript; until then it is loading, not empty. */
  let transcriptLoaded = $state(false);
  let permission = $state<PendingPermission | null>(null);
  let question = $state<PendingQuestion | null>(null);
  let notice = $state<Extract<HostMessage, { type: 'notice' }> | null>(null);
  let draft = $state('');
  let config = $state<SessionConfigOption[]>([]);
  let usage = $state<ChatUsage>({ session: null, account: null });
  let queued = $state<QueuedPromptSummary[]>([]);
  let settings: SettingsBar | undefined = $state();

  /** Shows the choice at once; the agent's reply confirms or corrects it. */
  function setConfig(configId: string, value: string | boolean): void {
    config = config.map((option) =>
      option.id === configId ? ({ ...option, currentValue: value } as SessionConfigOption) : option
    );
    send({ type: 'setConfig', configId, value });
  }

  function receive(message: HostMessage): void {
    switch (message.type) {
      case 'state':
        chat = message.state;
        break;
      case 'transcript':
        entries = message.entries;
        transcriptLoaded = true;
        break;
      case 'entry':
        entries.push(message.entry);
        break;
      case 'permission':
        permission = message.request;
        break;
      case 'question':
        question = message.request;
        break;
      case 'notice':
        notice = message;
        break;
      case 'clearNotice':
        notice = null;
        break;
      case 'config':
        config = message.options;
        break;
      case 'usage':
        usage = message.usage;
        break;
      case 'queue':
        queued = message.items;
        break;
      case 'draft':
        // Next to what the user is writing, never over it.
        draft = draft.trim() ? `${draft.trimEnd()}\n\n${message.text}` : message.text;
        queueMicrotask(fitInput);
        input?.focus();
        break;
      case 'fileData':
        files.received(message.key, message.dataUrl);
        break;
    }
  }

  $effect(() => {
    const stop = host.listen(receive);
    send({ type: 'ready' });
    return stop;
  });

  // `!command` runs in the sandbox instead of going to the agent, as in Claude Code.
  const shellMode = $derived(draft.trimStart().startsWith('!'));

  // The agent's slash commands, as it last listed them for this session.
  const commands = $derived.by(() => {
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry.kind === 'update' && entry.update.sessionUpdate === 'available_commands_update') {
        return entry.update.availableCommands;
      }
    }
    return [] as AvailableCommand[];
  });

  // While the user types a command's name, the menu offers the matching ones.
  const commandQuery = $derived(/^\/(\S*)$/.exec(draft)?.[1]?.toLowerCase());
  const commandMatches = $derived.by(() => {
    if (commandQuery === undefined) return [];
    const starts = commands.filter((command) => command.name.toLowerCase().startsWith(commandQuery));
    const contains = commands.filter(
      (command) => !starts.includes(command) && command.name.toLowerCase().includes(commandQuery)
    );
    return [...starts, ...contains];
  });
  let commandIndex = $state(0);
  let commandMenuClosed = $state(false);
  const commandMenuOpen = $derived(chat.live && !commandMenuClosed && commandMatches.length > 0);
  $effect(() => {
    void commandQuery;
    commandIndex = 0;
    commandMenuClosed = false;
  });
  // A known command typed out in full: its argument hint shows under the composer.
  const typedCommand = $derived(commands.find((command) => draft.trimStart().split(/\s/, 1)[0] === `/${command.name}`));

  /** Enter or a click runs the command as is, as in Claude Code; Tab completes it to add arguments. */
  function chooseCommand(command: AvailableCommand, run: boolean): void {
    if (run) {
      draft = `/${command.name}`;
      submit();
      return;
    }
    draft = `/${command.name} `;
    input?.focus();
  }

  /** While the agent works a message waits for its turn to end, unless sent `now`. */
  function submit(now = false): void {
    const text = draft.trim();
    if (!text || !chat.live) return;
    if (shellMode) {
      const command = text.slice(1).trim();
      if (!command) return;
      notice = null;
      send({ type: 'shell', command });
      draft = '';
      if (input) input.style.height = '';
      return;
    }
    notice = null;
    send({ type: 'prompt', text, ...(chat.busy && now ? { now: true } : {}) });
    draft = '';
    if (input) input.style.height = '';
  }

  let input: HTMLTextAreaElement | undefined = $state();

  function fitInput(): void {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  // On a touch screen Enter types a new line, as phone keyboards expect; the Send button sends.
  let touch = $state(false);
  $effect(() => {
    const query = matchMedia('(pointer: coarse)');
    touch = query.matches;
    const changed = () => (touch = query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  });
  // Agents that take a message mid-turn read it at once; others stop first.
  const sendNowHint = $derived(
    chat.steer
      ? `${modKey}+Enter: the agent reads it right away, without stopping`
      : `${modKey}+Enter: stops the agent's turn and sends this next`
  );

  function suggest(text: string): void {
    draft = text;
    input?.focus();
  }

  const status = $derived(sessionStatus(chat, permission !== null || question !== null));
  // Dot, label color, tooltip, label; the tab icon uses the same colors.
  const statusLook: Record<SessionStatus, [string, string, string, string]> = {
    ready: ['bg-[#3fbf57]', 'text-green', 'The agent is ready for your next message', 'ready'],
    waiting: ['bg-[#ff9f1c]', 'text-orange', 'The agent is waiting for your answer', 'needs you'],
    working: ['bg-[#1ec8f0]', 'text-cyan', 'The agent is working', 'working'],
    offline: ['bg-muted', 'text-muted', 'Read-only: the worker is not connected or runs elsewhere', 'read-only']
  };

  // "Claude Code · 127.0.0.1:7710": the agent, then where it runs.
  const [agentLabel, location] = $derived(chat.subtitle.split(' · '));
</script>

<main class="flex h-full flex-col">
  <!-- One line: the chat, its agent, the tools and the status; a narrow chat keeps only the status dot. -->
  <header class="@container flex items-center gap-2 border-b-[1.5px] border-soft-line bg-card/60 px-3 py-1.5">
    <span class="contents max-[640px]:hidden"><Tulip size={20} /></span>
    <h1 class="m-0 flex min-w-0 flex-1 font-display text-[1rem] leading-tight font-medium" title={chat.title || 'New session'}>
      <ChatTitle title={chat.title} fallback="New session" />
    </h1>
    {#if agentLabel}
      <span
        class="inline-flex shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-line bg-card px-2 py-px text-[0.8em] font-semibold"
        title={location ? `${agentLabel} on ${location}` : agentLabel}
      >
        <span class="size-2 rounded-full bg-violet" style:background-color={chat.agent?.color}></span>
        <span class="hidden @xs:inline">{agentLabel}</span>
      </span>
    {/if}
    {#if chat.actions?.length}
      <ActionsMenu
        actions={chat.actions}
        busy={chat.busy}
        live={chat.live}
        choose={(id) => send({ type: 'action', id })}
      />
    {/if}
    <span
      class="inline-flex shrink-0 items-center gap-1.5 text-[0.8em] font-semibold {statusLook[status][1]}"
      title={statusLook[status][2]}
      role="status"
      aria-label={statusLook[status][3]}
    >
      <span class="size-2 rounded-full {statusLook[status][0]} {status === 'working' ? 'animate-pulse' : ''}"></span>
      <span class="hidden @md:inline">{statusLook[status][3]}</span>
    </span>
  </header>

  {#if notice}
    <div
      class="mx-4 mt-3 flex items-start gap-2.5 rounded-xl border-[1.5px] border-line px-3 py-2 {notice.level === 'error'
        ? 'bg-pink-soft'
        : 'bg-indigo-soft'}"
    >
      <span class="codicon mt-[3px] {notice.level === 'error' ? 'codicon-warning text-pink' : 'codicon-info text-indigo'}"></span>
      <span class="flex-1">{notice.message}</span>
      {#if notice.action}
        <button class="pill pill-primary pill-small" onclick={() => send({ type: 'action', id: notice!.action!.id })}>
          {notice.action.label}
        </button>
      {/if}
      <button class="link" aria-label="Dismiss" onclick={() => (notice = null)}>
        <span class="codicon codicon-close"></span>
      </button>
    </div>
  {/if}

  <Transcript {entries} loading={!transcriptLoaded} busy={chat.busy} live={chat.live} {suggest} />

  {#if permission}
    <PermissionPrompt request={permission} />
  {/if}

  {#if question}
    {#key question.requestId}
      <QuestionCard request={question} />
    {/key}
  {/if}

  {#if queued.length}
    <section class="mx-4 mb-2 flex flex-col gap-1 rounded-xl bg-sunken p-1.5 text-[0.9em]" aria-label="Queued messages" aria-live="polite">
      <span class="px-1.5 text-[0.85em] text-muted">
        <span class="codicon codicon-history text-[12px]!"></span>
        {chat.busy ? 'Next, one per turn once the agent is done' : 'Next, once the session is back'}
      </span>
      {#each queued as item, index (item.id)}
        <div class="flex items-center gap-2 rounded-lg bg-card py-1 pr-1 pl-2.5 shadow-(--cf-elevation)">
          <span class="text-[0.85em] text-muted tabular-nums">{index + 1}</span>
          {#if item.editable}
            <button
              type="button"
              class="min-w-0 flex-1 cursor-text truncate text-left"
              title="Edit: back into the message box"
              onclick={() => send({ type: 'editQueued', id: item.id })}>{item.title}</button
            >
          {:else}
            <span class="min-w-0 flex-1 truncate">{item.title}</span>
          {/if}
          <button
            type="button"
            class="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-soft-line hover:text-ink"
            title={chat.steer && item.editable ? 'Send now: the agent reads it right away' : "Send now: stops the agent's turn"}
            aria-label="Send {item.title} now"
            onclick={() => send({ type: 'sendQueued', id: item.id })}
          >
            <span class="codicon codicon-arrow-up"></span>
          </button>
          <button
            type="button"
            class="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-soft-line hover:text-ink"
            title="Remove from the queue"
            aria-label="Remove {item.title} from the queue"
            onclick={() => send({ type: 'removeQueued', id: item.id })}
          >
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      {/each}
    </section>
  {/if}

  <form
    class="card relative mx-4 mb-4 flex max-[640px]:mx-2 max-[640px]:mb-2 flex-col gap-1 px-3 pt-2 pb-2 {shellMode ? 'border-teal!' : 'focus-within:border-indigo'}"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    {#if commandMenuOpen}
      <CommandMenu matches={commandMatches} selected={commandIndex} choose={(command) => chooseCommand(command, true)} />
    {/if}
    <textarea
      bind:this={input}
      rows="2"
      class="max-h-60 min-h-[2.8em] resize-none pointer-coarse:text-base border-none bg-transparent p-0.5 outline-none placeholder:text-muted disabled:cursor-not-allowed {shellMode
        ? 'font-mono'
        : ''}"
      placeholder={!chat.live
        ? 'This session is read-only here'
        : touch
          ? chat.busy
            ? 'Follow up…'
            : 'Ask the agent…'
          : chat.busy
            ? `Follow up… Enter sends it when the agent is done, ${modKey}+Enter now`
            : `Ask the agent…  (${commands.length ? '/ for commands, ' : ''}! runs a command in the sandbox)`}
      disabled={!chat.live}
      bind:value={draft}
      oninput={fitInput}
      onkeydown={(event) => {
        if (commandMenuOpen) {
          const count = commandMatches.length;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
            return;
          }
          if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Tab' && !event.shiftKey)) {
            event.preventDefault();
            chooseCommand(commandMatches[commandIndex], event.key === 'Enter');
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            commandMenuClosed = true;
            return;
          }
        }
        if (event.key === 'Enter' && !event.shiftKey && !(touch && !event.ctrlKey && !event.metaKey)) {
          event.preventDefault();
          submit(event.ctrlKey || event.metaKey);
        } else if (event.key === 'Tab' && event.shiftKey && config.length) {
          event.preventDefault();
          settings?.cycleMode();
        }
      }}
    ></textarea>
    <div class="flex items-center gap-2">
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {#if chat.live && shellMode}
          <span class="chip border-teal! text-teal" title="Runs in the sandbox's workspace; the agent sees it with your next message">
            <span class="codicon codicon-terminal"></span> Shell command
          </span>
        {:else if chat.live && typedCommand}
          <span class="chip min-w-0 border-indigo! text-indigo" title={typedCommand.description}>
            <span class="codicon codicon-symbol-event"></span>
            <span class="font-mono">/{typedCommand.name}</span>
            {#if typedCommand.input?.hint}<span class="truncate font-mono text-muted">{typedCommand.input.hint}</span>{/if}
          </span>
        {:else if chat.live}
          <SettingsBar
            bind:this={settings}
            options={config}
            set={setConfig}
            autoApprove={chat.agent?.id === 'dsh' ? (chat.autoApprove ?? true) : undefined}
            setAutoApprove={(enabled) => send({ type: 'setAutoApprove', enabled })}
          />
        {/if}
      </div>
      {#if chat.busy && !shellMode}
        <button
          type="button"
          class="pill pill-pink pill-small"
          title={queued.some((item) => item.editable) ? 'Stop the turn; your queued messages go back into the message box' : 'Stop the turn'}
          onclick={() => send({ type: 'cancel' })}
        >
          <span class="codicon codicon-debug-stop"></span> Stop
        </button>
        {#if draft.trim()}
          <button type="button" class="pill pill-small" title={sendNowHint} disabled={!chat.live} onclick={() => submit(true)}>
            Send now
          </button>
        {/if}
      {/if}
      <button
        type="submit"
        class="pill pill-small {shellMode ? 'pill-teal' : 'pill-primary'}"
        title={shellMode
          ? 'Run in the sandbox (Enter)'
          : chat.busy
            ? 'Enter: sent when the agent is done, one message per turn · Shift+Enter for a new line'
            : `Enter to send · Shift+Enter for a new line${config.length ? ' · Shift+Tab to change mode' : ''}`}
        disabled={!chat.live || !draft.trim()}
      >
        {#if shellMode}Run <span class="codicon codicon-play"></span>
        {:else if chat.busy}Queue <span class="codicon codicon-list-ordered"></span>
        {:else}Send <span class="codicon codicon-arrow-up"></span>{/if}
      </button>
    </div>
  </form>

  <UsageMeter {usage} />
</main>
