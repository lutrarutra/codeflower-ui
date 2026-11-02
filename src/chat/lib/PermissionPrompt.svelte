<script lang="ts">
  import { WORKSPACE } from '../../client/codeflower.ts';
  import type { PendingPermission } from '../../protocol/messages.ts';
  import { chatHost, type ChatHost } from './host.ts';
  import Markdown from './Markdown.svelte';

  const host = chatHost();
  const send: ChatHost['send'] = (message) => host.send(message);

  let { request }: { request: PendingPermission } = $props();

  function answer(optionId: string | null): void {
    send({ type: 'permissionResponse', requestId: request.requestId, optionId });
  }

  const style: Record<string, string> = {
    allow_once: 'pill-primary',
    allow_always: 'pill-teal'
  };

  // A plan to approve (Claude Code's ExitPlanMode is kind switch_mode): its
  // text, and the file the agent wrote it to, which the bridge shows like a
  // file from codeflower-show; the user may edit it before answering.
  const plan = $derived(
    request.toolCall?.kind === 'switch_mode'
      ? (request.toolCall.content ?? [])
          .map((item) => (item.type === 'content' && item.content.type === 'text' ? item.content.text : ''))
          .join('\n\n')
          .trim()
      : ''
  );
  const planFile = $derived.by(() => {
    if (request.toolCall?.kind !== 'switch_mode') return undefined;
    const input = request.toolCall.rawInput as { planFilePath?: unknown } | undefined;
    // Older sandboxes leave plans next to Claude Code's login, which the user cannot open.
    return typeof input?.planFilePath === 'string' && input.planFilePath.startsWith(`${WORKSPACE}/`)
      ? input.planFilePath
      : undefined;
  });
  const openFile = (path: string) => send({ type: 'openFile', path });
</script>

<div class="card mx-4 mb-3 flex flex-col gap-2.5 bg-yellow-soft! px-4 py-3">
  <div class="flex items-center gap-2">
    <span class="codicon codicon-shield text-orange"></span>
    <span class="eyebrow text-muted">May I?</span>
    {#if request.subagent}
      <button type="button" class="link text-[0.85em]" title="Open the subagent's chat" onclick={() => send({ type: 'openSubagent', key: request.subagent!.key })}>
        <span class="codicon codicon-organization"></span> {request.subagent.title ?? 'A subagent'} asks
      </button>
    {/if}
  </div>
  {#if planFile}
    <!-- The plan opens beside the chat, where the user reads and edits it. -->
    <p class="m-0">The agent wants to go ahead with its plan</p>
    <button
      class="flex items-center gap-2 self-start rounded-xl border-[1.5px] border-soft-line bg-card px-3 py-2 text-left hover:border-indigo"
      title="Show {planFile}"
      onclick={() => openFile(planFile)}
    >
      <span class="codicon codicon-go-to-file text-indigo"></span>
      <span class="font-mono text-[0.88em]">{planFile.split('/').pop()}</span>
      <span class="text-[0.85em] text-muted">Read and edit it before you answer</span>
    </button>
  {:else if plan}
    <!-- An older sandbox keeps the plan where the user cannot open it: then it is shown here. -->
    <p class="m-0">The agent wants to go ahead with this plan</p>
    <div class="max-h-[40vh] overflow-y-auto rounded-xl border-[1.5px] border-soft-line bg-card px-3 py-2">
      <Markdown text={plan} {openFile} />
    </div>
  {:else}
    <p class="m-0">The agent wants to run</p>
    <pre class="m-0 overflow-x-auto rounded-xl border-[1.5px] border-soft-line bg-card px-3 py-2 font-mono text-[0.88em] whitespace-pre-wrap">{request
        .toolCall?.title ?? 'a tool'}</pre>
  {/if}
  <div class="flex flex-wrap items-center gap-2 pt-1">
    {#each request.options as option (option.optionId)}
      <button class="pill {style[option.kind] ?? ''}" onclick={() => answer(option.optionId)}>
        {option.name}
      </button>
    {/each}
    <button class="link ml-auto" onclick={() => answer(null)}>Cancel</button>
  </div>
</div>
