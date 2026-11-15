<script lang="ts">
  import { effortLevels, type SelectOption } from './picker.ts';

  // The agent's effort (thinking level) as a slider with a stop per level, at
  // the foot of the model menu: the two are chosen together. Each stop is
  // also a button, so a level is one click away. The choice that leaves it to
  // the agent or provider ("Default", "Provider default") is no point on the
  // scale, wherever the agent lists it: it is a switch beside the name, and
  // while it is on, no level is chosen.
  let { option, choose }: { option: SelectOption; choose: (value: string) => void } = $props();

  const { levels, byDefault } = $derived(effortLevels(option));
  /** The chosen level; -1 while the default (or a value the agent no longer lists) is. */
  const index = $derived(levels.findIndex((level) => level.value === option.currentValue));
  const onDefault = $derived(Boolean(byDefault && byDefault.value === option.currentValue));
  const last = $derived(Math.max(levels.length - 1, 1));

  // The thumb's center, where its stop and its name go.
  const at = (position: number) => `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${position / last})`;

  function set(position: number): void {
    const level = levels[position];
    if (level && level.value !== option.currentValue) choose(level.value);
  }
</script>

<div class="effort px-2 pt-2 pb-1">
  <div class="flex items-center justify-between gap-2">
    <span class="eyebrow text-indigo">{option.name}</span>
    {#if byDefault}
      <button
        type="button"
        class="chip px-2! py-0! text-[0.75em]! {onDefault ? 'border-indigo! bg-indigo! text-on-accent!' : 'text-muted'}"
        aria-pressed={onDefault}
        title={byDefault.description ?? `${byDefault.name}: the model decides`}
        onclick={() => !onDefault && choose(byDefault.value)}
      >
        {byDefault.name}
      </button>
    {:else}
      <span class="text-[0.8em] font-semibold">{levels[index]?.name ?? option.currentValue}</span>
    {/if}
  </div>
  {#if levels.length}
    <div class="track relative mt-2 {index < 0 ? 'unset' : ''}">
      <!-- The track and its stops are drawn here; the slider on top shows its thumb. -->
      <span class="bar bg-soft-line"></span>
      {#if index > 0}<span class="bar bg-orange" style:width="calc((100% - var(--thumb)) * {index / last})"></span>{/if}
      {#each levels as level, position (level.value)}
        <span class="tick {index >= 0 && position <= index ? 'bg-orange' : 'bg-line'}" style:left={at(position)}></span>
      {/each}
      <!-- On the default, the thumb is hidden: any stop picks a level, the first too. -->
      <input
        type="range"
        min="0"
        max={levels.length - 1}
        step="1"
        value={Math.max(index, 0)}
        aria-label={option.name}
        aria-valuetext={index < 0 ? (onDefault ? byDefault?.name : String(option.currentValue)) : levels[index].name}
        onchange={(event) => set(Number(event.currentTarget.value))}
        onclick={(event) => index < 0 && set(Number(event.currentTarget.value))}
      />
    </div>
    <div class="relative mt-1 h-4 text-[0.75em] text-muted">
      {#each levels as level, position (level.value)}
        <button
          type="button"
          tabindex="-1"
          class="absolute top-0 border-none bg-transparent p-0 leading-none whitespace-nowrap hover:text-ink {position === index
            ? 'font-semibold text-ink'
            : ''}"
          style:left={position === 0 ? '0' : position === levels.length - 1 ? 'auto' : at(position)}
          style:right={position === levels.length - 1 && position !== 0 ? '0' : 'auto'}
          style:transform={position === 0 || position === levels.length - 1 ? 'none' : 'translateX(-50%)'}
          data-value={level.value}
          title={level.description ?? level.name}
          onclick={() => set(position)}
        >
          {level.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* The thumb's size places the stops and their names, so all of them see it. */
  .effort {
    --thumb: 14px;
  }

  .track {
    height: var(--thumb);
  }

  .bar {
    position: absolute;
    top: 50%;
    left: calc(var(--thumb) / 2);
    right: calc(var(--thumb) / 2);
    height: 4px;
    border-radius: 999px;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .bar + .bar {
    right: auto;
  }

  .tick {
    position: absolute;
    top: 50%;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent;
    appearance: none;
    cursor: pointer;
  }

  input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: transparent;
  }

  input::-moz-range-track {
    height: 4px;
    border-radius: 999px;
    background: transparent;
  }

  input::-webkit-slider-thumb {
    appearance: none;
    width: var(--thumb);
    height: var(--thumb);
    margin-top: calc((4px - var(--thumb)) / 2);
    border: 2px solid var(--cf-orange);
    border-radius: 999px;
    background: var(--cf-card);
  }

  input::-moz-range-thumb {
    width: var(--thumb);
    height: var(--thumb);
    box-sizing: border-box;
    border: 2px solid var(--cf-orange);
    border-radius: 999px;
    background: var(--cf-card);
  }

  /* No level while on the default: the thumb waits out of sight. */
  .unset input::-webkit-slider-thumb {
    opacity: 0;
  }

  .unset input::-moz-range-thumb {
    opacity: 0;
  }

  input:focus-visible {
    outline: none;
  }

  input:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px var(--cf-soft-line);
  }
</style>
