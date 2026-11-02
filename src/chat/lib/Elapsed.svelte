<script lang="ts">
  import { duration } from './time.ts';

  // How long something has run, counting up each second while `running`:
  // e.g. a subagent, which may outlive its chat's turn.
  let { started, ended, running }: { started: number | null; ended: number | null; running: boolean } = $props();

  let now = $state(Date.now());
  $effect(() => {
    if (!running || ended !== null) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const shown = $derived(
    started === null ? null : ended !== null ? duration(ended - started) : running ? duration(now - started) : null
  );
</script>

{#if shown}
  <span class="shrink-0 font-mono text-[0.78em] text-muted tabular-nums" title={ended === null ? 'Running for' : 'Took'}>{shown}</span>
{/if}
