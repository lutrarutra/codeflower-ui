<script lang="ts">
  // An agent's logo, in its brand colors as an <img> (where an SVG runs no
  // script), or a mono one as a mask in the text's color; without a logo, a
  // dot in the agent's color. Its name is the surrounding text's, or the title.
  import type { AgentPresentation } from '../../protocol/messages.ts';

  let { agent, size = '1em', title }: { agent: AgentPresentation | undefined; size?: string; title?: string } = $props();
</script>

{#if agent?.icon && agent.iconMono}
  <span
    class="inline-block shrink-0 bg-current"
    style:width={size}
    style:height={size}
    style:mask="url({agent.icon}) center / contain no-repeat"
    style:-webkit-mask="url({agent.icon}) center / contain no-repeat"
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : 'true'}
    {title}
  ></span>
{:else if agent?.icon}
  <img class="inline-block shrink-0" src={agent.icon} width="16" height="16" style:width={size} style:height={size} alt={title ?? ''} {title} />
{:else}
  <span
    class="inline-block shrink-0 rounded-full"
    style:width="calc({size} * 0.6)"
    style:height="calc({size} * 0.6)"
    style:background={agent?.color ?? 'var(--cf-muted, currentColor)'}
    aria-hidden="true"
    {title}
  ></span>
{/if}
