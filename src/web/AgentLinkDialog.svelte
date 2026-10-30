<script lang="ts">
  // A page an agent asks the user to open, e.g. to sign in or to approve a
  // connection. The link opens only when the user follows it.
  import { untrack } from 'svelte';
  import { app } from './lib/app.svelte.ts';

  let dialog: HTMLDialogElement | undefined = $state();
  const link = $derived(app.signIn.links[0]);
  const agent = $derived(link ? app.agent(link.workerId).status?.agentLabel : undefined);

  $effect(() => {
    const open = !!link;
    untrack(() => {
      if (open && dialog && !dialog.open) dialog.showModal();
      else if (!open && dialog?.open) dialog.close();
    });
  });
</script>

<!-- Closing it (Esc) declines the link. -->
<dialog bind:this={dialog} onclose={() => link?.answer('decline')} aria-labelledby="link-title">
  {#if link}
    <div class="card flex flex-col gap-3 p-5">
      <h2 id="link-title" class="m-0 font-display text-lg font-medium">{agent ?? 'The agent'} asks you to open a page</h2>
      <p class="m-0 whitespace-pre-wrap">{link.request.message}</p>
      <p class="m-0 rounded-lg bg-code px-2 py-1 font-mono text-[0.85em] break-all">{link.request.url}</p>
      <footer class="flex justify-end gap-2">
        <button class="pill" onclick={() => link.answer('decline')}>Cancel</button>
        <a class="pill pill-primary no-underline" href={link.request.url} target="_blank" rel="noopener noreferrer" onclick={() => link.answer('accept')}>
          Open the page
        </a>
      </footer>
    </div>
  {/if}
</dialog>
