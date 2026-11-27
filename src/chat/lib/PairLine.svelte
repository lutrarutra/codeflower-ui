<script lang="ts">
  import type { Snippet } from 'svelte';
  import { chatHost } from './host.ts';

  // The line under the header of a chat that is one half of an orchestrated
  // pair: which half, the other chat (a link that opens it), what this one is,
  // and, unfolded, the details (`children`).
  let {
    label,
    other,
    otherTitle,
    openTitle,
    note,
    more,
    tone = 'orchestrator',
    children
  }: {
    /** Which half this chat is: its compass's colour, as in the chat list. */
    tone?: 'orchestrator' | 'executor';
    /** "Orchestrator of", "Executor of". */
    label: string;
    /** The other chat's key and title. */
    other: string;
    otherTitle: string;
    openTitle: string;
    /** What this chat is, after a dot. */
    note: string;
    /** The fold's label: "What it may do". */
    more: string;
    children: Snippet;
  } = $props();
  const host = chatHost();
</script>

<details class="group border-b-[1.5px] border-soft-line {tone === 'orchestrator' ? 'bg-violet-soft/40' : 'bg-teal-soft/40'} px-3 py-1.5 text-[0.85em]">
  <summary class="flex min-w-0 cursor-pointer list-none items-center gap-1.5 select-none">
    <span class="codicon codicon-compass shrink-0 {tone === 'orchestrator' ? 'text-violet' : 'text-teal'}"></span>
    <span class="shrink-0 font-semibold">{label}</span>
    <button
      type="button"
      class="link min-w-0 truncate"
      title={openTitle}
      onclick={(event) => {
        event.preventDefault();
        host.send({ type: 'openChat', key: other });
      }}>{otherTitle}</button
    >
    <span class="min-w-0 truncate text-muted max-[640px]:hidden">· {note}</span>
    <span class="ml-auto flex shrink-0 items-center gap-1 text-muted">
      {more} <span class="codicon codicon-chevron-right transition-transform group-open:rotate-90"></span>
    </span>
  </summary>
  <div class="mt-2 pb-1">{@render children()}</div>
</details>
