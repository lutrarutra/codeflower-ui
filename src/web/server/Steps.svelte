<script lang="ts">
  // Install or fix steps: text, an optional link, and a command to copy.
  import { copyText, type Step } from '../lib/api.ts';

  let { steps }: { steps: Step[] } = $props();
  let copied = $state(-1);

  async function copy(index: number, command: string): Promise<void> {
    await copyText(command);
    copied = index;
    setTimeout(() => (copied = -1), 1500);
  }
</script>

<ol class="my-2 flex flex-col gap-2 pl-5">
  {#each steps as step, index (index)}
    <li>
      {step.text}
      {#if step.link}<a href={step.link} target="_blank" rel="noreferrer" class="text-indigo">Instructions ↗</a>{/if}
      {#if step.command}
        <div class="mt-1 flex items-start gap-2">
          <pre class="m-0 min-w-0 flex-1 overflow-x-auto rounded-lg bg-code px-2.5 py-1.5 font-mono text-[0.85em]">{step.command}</pre>
          <button type="button" class="pill pill-small" onclick={() => copy(index, step.command!)}>{copied === index ? 'Copied' : 'Copy'}</button>
        </div>
      {/if}
    </li>
  {/each}
</ol>
