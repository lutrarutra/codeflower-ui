<script lang="ts">
  // Shapes in place of content that is loading, so the page does not flash an
  // empty state first. `lines` gives each line's width.
  let { lines = ['70%'], height = '0.85rem', class: extra = '' }: { lines?: string[]; height?: string; class?: string } = $props();
</script>

<div class="flex flex-col gap-2 {extra}" aria-hidden="true">
  {#each lines as width, index (index)}
    <div class="skeleton" style="width: {width}; height: {height}"></div>
  {/each}
</div>
