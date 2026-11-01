<script lang="ts">
  // Starting sandboxes through the tunnel, while the computer's app does not allow it: locked, with
  // the setting that allows it and what it lets every paired browser do.
  import type { Machine } from '../lib/machines.svelte.ts';

  let { machine }: { machine: Machine } = $props();
  const computer = $derived(machine.name || 'this computer');
  const config = $derived(machine.system?.configDirectory ? `${machine.system.configDirectory}/config.yaml` : 'config.yaml');
</script>

<section class="card flex flex-col gap-3 p-4 opacity-90" aria-label="Starting sandboxes is locked">
  <h3 class="m-0 flex items-center gap-2 text-[1.05rem] font-semibold">
    <span class="codicon codicon-lock text-muted"></span>Locked through the tunnel
  </h3>
  <p class="m-0 text-[0.9em] text-muted">
    Browsers that reach {computer} through the tunnel can use and stop its sandboxes, but not start new ones. To allow it, add this to
    <code>{config}</code> on {computer} and restart <code>codeflower client</code> there:
  </p>
  <pre class="m-0 rounded-lg bg-code p-2.5 font-mono text-[0.85em]">tunnel:
  manage: true</pre>
  <p class="m-0 flex items-start gap-2 rounded-lg border-[1.5px] border-orange p-2.5 text-[0.9em]">
    <span class="codicon codicon-warning shrink-0 pt-0.5 text-orange"></span>
    <span>
      Every browser paired with {computer} can then browse its folders and start sandboxes with any of them mounted. Turn it on only if you trust every paired
      device, and revoke the ones you no longer use.
    </span>
  </p>
</section>
