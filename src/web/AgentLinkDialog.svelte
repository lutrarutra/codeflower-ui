<script lang="ts">
  // A page an agent asks the user to open, e.g. to sign in or to approve a
  // connection. The link opens only when the user follows it, and only a web
  // page: the agent is not trusted with other schemes.
  import { untrack } from 'svelte';
  import { externalUrl } from '../client/links.ts';
  import { app } from './lib/app.svelte.ts';

  let dialog: HTMLDialogElement | undefined = $state();
  const link = $derived(app.signIn.links[0]);
  const agent = $derived(link ? app.agent(link.workerId).status?.agentLabel : undefined);
  const page = $derived(link ? externalUrl(link.request.url) : undefined);

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
      {#if page}
        <p class="m-0">On <strong>{page.host}</strong>:</p>
        <p class="m-0 rounded-lg bg-code px-2 py-1 font-mono text-[0.85em] break-all">{page.href}</p>
      {:else}
        <p class="m-0 text-red">This is not a web page, so it cannot be opened from here:</p>
        <p class="m-0 rounded-lg bg-code px-2 py-1 font-mono text-[0.85em] break-all">{link.request.url}</p>
      {/if}
      <footer class="flex justify-end gap-2">
        <button class="pill" onclick={() => link.answer('decline')}>Cancel</button>
        {#if page}
          <a class="pill pill-primary no-underline" href={page.href} target="_blank" rel="noopener noreferrer" onclick={() => link.answer('accept')}>
            Open the page
          </a>
        {/if}
      </footer>
    </div>
  {/if}
</dialog>
