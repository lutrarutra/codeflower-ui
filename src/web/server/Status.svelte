<script lang="ts">
  let { kind, title, detail }: { kind: 'ok' | 'warn' | 'bad'; title: string; detail?: string } = $props();
</script>

<div class="flex items-start gap-2.5">
  <span
    class="grid size-6 shrink-0 place-items-center rounded-full text-[0.85em] font-bold text-on-accent"
    class:bg-green={kind === 'ok'}
    class:bg-orange={kind === 'warn'}
    class:bg-red={kind === 'bad'}>{kind === 'ok' ? '✓' : kind === 'warn' ? '!' : '×'}</span
  >
  <div class="min-w-0">
    <strong>{title}</strong>
    {#if detail}<p class="m-0 text-[0.9em] text-muted">{detail}</p>{/if}
  </div>
</div>
