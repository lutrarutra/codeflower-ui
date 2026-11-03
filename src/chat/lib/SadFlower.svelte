<script lang="ts">
  // The wilted code flower, always with its ink outline; dark themes show it
  // on a clay tile, as the tulip.
  import { SAD_FLOWER_PATHS, SAD_FLOWER_VIEWBOX } from './sadFlower.ts';

  let { size = 72 }: { size?: number } = $props();
</script>

<span class="sad-flower grid shrink-0 place-items-center" style="--size: {size}px">
  <svg viewBox={SAD_FLOWER_VIEWBOX} aria-hidden="true" class="overflow-visible">
    {@html SAD_FLOWER_PATHS}
  </svg>
</span>

<style>
  .sad-flower {
    width: var(--size);
    height: var(--size);
  }

  svg {
    width: 100%;
    height: 100%;
  }

  :global(.cf-dark) .sad-flower {
    background: #f6efd9;
    border-radius: 28%;
  }

  :global(.cf-dark) svg {
    width: 82%;
    height: 82%;
  }
</style>
