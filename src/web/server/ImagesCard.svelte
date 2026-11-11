<script lang="ts">
  // The sandbox images on this computer for the engine sandboxes use: which are there, downloading one
  // with its progress, updating and removing them. An older app has no /api/images: the card stays away.
  import { untrack } from 'svelte';
  import type { ImagePull, ImagesInfo, LocalImage } from '../lib/api.ts';
  import { ago, duration, fileSize, QUIET_SECONDS } from '../lib/format.ts';
  import type { Machine } from '../lib/machines.svelte.ts';
  import PullBar from './PullBar.svelte';

  let { machine }: { machine: Machine } = $props();

  const PULLING_MS = 1500;
  const IDLE_MS = 15_000;

  const system = $derived(machine.system);
  const engine = $derived(system?.engine ?? '');
  // Through the tunnel without `manage`, the computer only lets remote browsers look.
  const manage = $derived(!!system?.capabilities.start);
  let info = $state<ImagesInfo | null>(null);
  let missing = $state(false);
  let error = $state('');
  let tag = $state('');
  let busy = $state<string | null>(null);
  let now = $state(Date.now());

  const pulling = $derived(info?.pulls.some((pull) => pull.status === 'pulling') ?? false);
  const hasDefault = $derived(info?.images.some((image) => image.default) ?? false);
  const pullingDefault = $derived(info?.pulls.some((pull) => pull.status === 'pulling' && pull.tag === info?.defaultTag) ?? false);

  async function load(): Promise<void> {
    if (!engine) return;
    try {
      const next = await machine.api<ImagesInfo>(`/api/images?${new URLSearchParams({ engine })}`);
      const finished = info?.pulls.some((pull) => pull.status === 'pulling' && next.pulls.find((other) => other.id === pull.id)?.status === 'done');
      info = next;
      missing = false;
      // The engine check and the start form say whether the image is here.
      if (finished) void machine.loadSystem();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (/ 404$/.test(message)) missing = true;
      else error = message;
    }
  }

  $effect(() => {
    void engine;
    untrack(() => void load());
  });

  $effect(() => {
    const every = pulling ? PULLING_MS : IDLE_MS;
    const timer = setInterval(() => {
      now = Date.now();
      if (!document.hidden) untrack(() => void load());
    }, every);
    return () => clearInterval(timer);
  });

  async function act(key: string, run: () => Promise<unknown>): Promise<void> {
    busy = key;
    error = '';
    try {
      await run();
      await load();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = null;
    }
  }

  const pull = (imageTag: string) => act(`pull:${imageTag}`, () => machine.api<ImagePull>('/api/images/pull', { body: { engine, imageTag } }));
  const dismiss = (item: ImagePull) => act(`dismiss:${item.id}`, () => machine.api(`/api/images/pull/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: {} }));

  function remove(image: LocalImage): void {
    const what = image.tag ? `the sandbox image ${image.tag}` : 'this older sandbox image';
    if (!confirm(`Remove ${what} (${fileSize(image.size)}) from this computer? Starting a sandbox with it downloads it again.`)) return;
    void act(`remove:${image.ref}`, () => machine.api('/api/images', { method: 'DELETE', body: { engine, ref: image.ref } }));
  }

  function download(event: SubmitEvent): void {
    event.preventDefault();
    void pull(tag.trim());
  }

  function title(image: LocalImage): string {
    if (image.untagged) return 'older download';
    return image.tag;
  }

  function built(image: LocalImage): string {
    const parts = [];
    if (image.version && image.version !== image.tag) parts.push(`release ${image.version.replace(/^v/, '')}`);
    if (image.revision) parts.push(`commit ${image.revision}`);
    parts.push(fileSize(image.size));
    if (image.created) parts.push(`built ${ago(Date.parse(image.created))}`);
    return parts.join(' · ');
  }
</script>

{#if engine && !missing}
  <section class="card flex flex-col gap-4 p-5" aria-labelledby="images-title">
    <h2 id="images-title" class="m-0 flex flex-wrap items-baseline gap-2 font-display text-lg font-medium">
      Sandbox images
      {#if info}<span class="font-sans text-[0.8rem] font-normal text-muted">for {info.label}</span>{/if}
    </h2>

    {#if !info}
      <p class="m-0 text-muted"><span class="spinner"></span> Looking for the images…</p>
    {:else}
      {#if info.error}<p class="m-0 text-red">{info.error}</p>{/if}
      {#if info.directory}<p class="m-0 text-[0.85em] text-muted">Kept in <code>{info.directory}</code>.</p>{/if}

      {#if !hasDefault && !pullingDefault}
        <div class="flex flex-wrap items-center gap-3">
          <p class="m-0 flex-1 text-[0.9em]">
            The image this app runs, <strong>{info.defaultTag}</strong>, is not here yet. Starting a sandbox downloads it (a few GB, once); or download it now.
          </p>
          {#if manage}
            <button class="pill pill-primary" disabled={busy !== null} onclick={() => void pull('')}>Download {info.defaultTag}</button>
          {/if}
        </div>
      {/if}

      {#each info.pulls as item (item.id)}
        {@const quiet = item.status === 'pulling' && item.lastOutput ? (now - Date.parse(item.lastOutput)) / 1000 : 0}
        {@const last = item.log.findLast((line) => line.trim() !== '')?.trim() ?? ''}
        <div class="flex flex-col gap-2 rounded-lg border border-soft-line p-3" role="status" aria-live="polite">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <strong class="text-[0.95em]">{item.tag}</strong>
            <span class="text-[0.85em] font-semibold text-muted">
              {item.status === 'pulling'
                ? `downloading · ${duration((now - Date.parse(item.started)) / 1000)}`
                : item.status === 'done'
                  ? 'downloaded'
                  : item.status === 'cancelled'
                    ? 'cancelled'
                    : 'failed'}
            </span>
            {#if quiet >= QUIET_SECONDS}<span class="text-[0.85em] text-orange">no output for {duration(quiet)}</span>{/if}
            <span class="flex-1"></span>
            {#if manage}
              <button class="pill pill-small" disabled={busy === `dismiss:${item.id}`} onclick={() => void dismiss(item)}
                >{item.status === 'pulling' ? 'Cancel' : 'Dismiss'}</button
              >
            {/if}
          </div>
          {#if item.status === 'pulling'}<PullBar progress={item.progress} label="Downloading {item.tag}" />{/if}
          {#if item.error}<p class="m-0 text-[0.9em] text-red">{item.error}</p>{/if}
          {#if last && item.status === 'pulling' && !item.progress}<code class="truncate font-mono text-[0.78em] text-muted" title={last}>{last}</code>{/if}
          {#if item.log.length}
            <details open={item.status === 'failed'}>
              <summary class="cursor-pointer text-[0.85em] font-semibold text-muted">Log</summary>
              <pre class="mt-2 max-h-48 overflow-auto rounded-lg bg-code p-2.5 font-mono text-[0.78em] whitespace-pre-wrap">{item.log.join('\n')}</pre>
            </details>
          {/if}
        </div>
      {/each}

      {#if info.images.length}
        <ul class="m-0 flex list-none flex-col divide-y divide-soft-line p-0">
          {#each info.images as image (image.ref)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div class="min-w-0 flex-1">
                <p class="m-0 flex flex-wrap items-baseline gap-x-2">
                  <strong class="text-[0.95em]" class:text-muted={image.untagged}>{title(image)}</strong>
                  {#if image.default}<span class="tag bg-teal-soft" title="The release this app runs when no version is chosen">this app's</span>{/if}
                  {#if image.inUse}<span class="tag bg-indigo-soft" title="A sandbox started here runs it">in use</span>{/if}
                </p>
                <p class="m-0 text-[0.8em] text-muted" title={image.ref}>{built(image)}</p>
              </div>
              {#if manage}
                {#if image.tag && !image.untagged}
                  <button
                    class="pill pill-small"
                    title="Download it again if a newer build has this tag"
                    disabled={busy !== null || info.pulls.some((other) => other.status === 'pulling' && other.tag === image.tag)}
                    onclick={() => void pull(image.tag)}>Update</button
                  >
                {/if}
                <button
                  class="pill pill-small"
                  title={image.inUse ? 'Stop the sandboxes that run it first' : 'Remove it from this computer'}
                  disabled={busy !== null || image.inUse}
                  onclick={() => remove(image)}>Remove</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {:else if !info.error}
        <p class="m-0 text-[0.9em] text-muted">No sandbox image on this computer yet.</p>
      {/if}

      {#if manage}
        <form class="flex flex-wrap items-end gap-2" onsubmit={download}>
          <label class="flex min-w-48 flex-1 flex-col gap-1 text-[0.9em] font-semibold"
            >Download another version
            <input class="field font-normal" bind:value={tag} placeholder="{info.defaultTag}, latest, 0.20 or sha-abc1234" />
          </label>
          <button class="pill" type="submit" disabled={busy !== null}>Download</button>
        </form>
      {/if}
    {/if}
    {#if error}<p class="m-0 text-red">{error}</p>{/if}
  </section>
{/if}
