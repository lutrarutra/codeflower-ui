<script lang="ts">
  // An image download's bar: its share when Docker reports sizes, else a stripe that moves along.
  import type { PullProgress } from '../lib/api.ts';
  import { pullText } from '../lib/format.ts';

  let { progress, label }: { progress?: PullProgress; label: string } = $props();
  const percent = $derived(progress && progress.total > 0 ? Math.min(100, (100 * progress.current) / progress.total) : undefined);
  const text = $derived(progress ? pullText(progress) : '');
</script>

<div class="flex flex-col gap-1">
  <div
    class="meter"
    style:flex="none"
    class:indeterminate={percent === undefined}
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={percent === undefined ? undefined : Math.round(percent)}
    aria-valuetext={text || undefined}
  >
    <span style:width={percent === undefined ? undefined : `${percent}%`} class:used={percent !== undefined}></span>
  </div>
  {#if text}<span class="text-[0.8em] text-muted tabular-nums">{percent === undefined ? '' : `${Math.round(percent)}% · `}{text}</span>{/if}
</div>
