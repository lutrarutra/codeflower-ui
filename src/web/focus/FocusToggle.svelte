<script lang="ts">
  // Focus on a phone: one button in the page's top bar turns between the chat and
  // what its agent showed (or its browser), which the view shows one at a time.
  import { app } from '../lib/app.svelte.ts';

  const selected = $derived(app.focus.selected);
  const agent = $derived(selected ? app.agent(selected.workerId) : undefined);
  const chat = $derived(selected && agent ? agent.chats[selected.key] : undefined);
  const browser = $derived(selected && agent ? agent.browsers[selected.key] : undefined);
  const paneBrowser = $derived(Boolean(browser?.running && (browser.handoff || browser.yours)));
  const pane = $derived(app.focus.front === 'pane');
  const label = $derived(pane ? 'Show the chat' : paneBrowser ? 'Show the browser' : 'Show what the agent showed you');
</script>

<button
  class="chip ml-auto h-9 shrink-0"
  aria-label={label}
  aria-pressed={pane}
  title={label}
  onclick={() => (app.focus.front = pane ? 'chat' : 'pane')}
>
  {#if pane}
    <span class="codicon codicon-comment-discussion"></span>Chat
  {:else if paneBrowser}
    <span class="codicon codicon-globe"></span>Browser
  {:else}
    <span class="codicon codicon-preview"></span>Shown{#if chat?.shown.length}<span class="text-muted">{chat.shown.length}</span>{/if}
  {/if}
</button>
