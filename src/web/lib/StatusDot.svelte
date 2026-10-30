<script lang="ts">
  import type { Worker } from './api.ts';
  import { statusText, statusTone } from './format.ts';

  let { worker }: { worker: Worker } = $props();
  const tone = $derived(statusTone(worker));
</script>

<span
  class="inline-block size-2.5 shrink-0 rounded-full"
  class:bg-green={tone === 'good'}
  class:bg-cyan={tone === 'busy'}
  class:bg-red={tone === 'bad'}
  class:bg-muted={tone === 'idle'}
  class:animate-pulse={tone === 'busy'}
  title={statusText(worker)}
></span>
