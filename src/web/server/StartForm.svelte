<script lang="ts">
  import { api, type Worker } from '../lib/api.ts';
  import { app } from '../lib/app.svelte.ts';
  import { accent, FOLDER_KINDS, short, targets, type FolderKind } from '../lib/format.ts';
  import FolderBrowser from './FolderBrowser.svelte';

  let { recheck }: { recheck: (query: { engine: string; image: string; imageTag: string }) => void } = $props();

  // The choices start from the ones the app remembers from the last start.
  const settings = app.system!.settings;
  let agent = $state(settings.agent || app.system!.agents[0]?.id || '');
  let folders = $state<Record<FolderKind, string[]>>({
    inputs: [...(settings.inputs ?? [])],
    outputs: [...(settings.outputs ?? [])],
    code: [...(settings.code ?? [])],
    skills: [...(settings.skills ?? [])]
  });
  let project = $state(settings.project || 'default');
  let engine = $state(settings.engine || 'auto');
  let image = $state(settings.image || '');
  let imageTag = $state(settings.imageTag || '');
  let isolate = $state(Boolean(settings.isolateNetwork));
  let browsing = $state<FolderKind | null>(null);
  let error = $state('');
  let starting = $state(false);

  const system = $derived(app.system!);
  const canStart = $derived(!!(system.capabilities.start && system.image && (system.image.ready || system.image.download)));
  const chosenEngine = $derived(engine === 'auto' ? system.engine : engine);
  const isolationProblem = $derived(system.isolation[chosenEngine]);

  const KINDS: { kind: FolderKind; title: string; tag: string; tone: string; help: string }[] = [
    { kind: 'inputs', title: 'Input data', tag: 'read-only', tone: 'bg-teal-soft', help: 'Each folder appears in /data/input under its name. The agent cannot change them.' },
    { kind: 'outputs', title: 'Output folders', tag: 'read-write', tone: 'bg-pink-soft', help: 'Reports, figures and tables the agent makes go here, in /data/output.' },
    { kind: 'code', title: 'Code', tag: 'read-write', tone: 'bg-indigo-soft', help: 'Repositories and packages the agent develops and runs, in /data/code. It changes these files.' },
    { kind: 'skills', title: 'Skills', tag: 'read-only', tone: 'bg-teal-soft', help: 'A skill (a folder with a SKILL.md) or a folder of skills, in /data/skills. The agent loads them as its own skills.' }
  ];

  function reload(): void {
    recheck({ engine, image: image.trim(), imageTag: imageTag.trim() });
  }

  function browseStart(kind: FolderKind): string {
    // Start next to the last folder chosen, where the next one often is.
    const last = folders[kind].at(-1);
    return last ? last.replace(/[\\/][^\\/]+[\\/]?$/, '') || last : system.home || '';
  }

  async function start(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = '';
    if (!folders.inputs.length && !folders.code.length && !confirm('No input or code folder is chosen, so the agent will not see any of your data. Start anyway?')) return;
    starting = true;
    try {
      const worker = await api<Worker>('/api/workers', {
        body: { agent, ...folders, isolateNetwork: isolate, project: project.trim(), engine, image: image.trim(), imageTag: imageTag.trim() }
      });
      await app.refreshWorkers();
      document.getElementById(`sandbox-${worker.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      starting = false;
    }
  }
</script>

<form class="card flex flex-col gap-5 p-5" onsubmit={start} autocomplete="off">
  <section>
    <h2 class="m-0 mb-3 flex items-center gap-2 font-display text-lg font-medium">
      <span class="grid size-6 place-items-center rounded-full bg-indigo text-[0.8em] text-on-accent">2</span> Agent
    </h2>
    <div class="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2.5" role="radiogroup" aria-label="Agent">
      {#each system.agents as choice (choice.id)}
        {@const checked = choice.id === agent}
        <button
          type="button"
          role="radio"
          aria-checked={checked}
          class="flex flex-col gap-1 rounded-2xl border-[1.5px] p-3 text-left {checked ? 'border-line bg-indigo-soft' : 'border-soft-line bg-card hover:border-line'}"
          onclick={() => (agent = choice.id)}
        >
          <strong class="flex items-center gap-2">
            <span class="size-2.5 rounded-full bg-violet" style:background-color={accent(choice.color)}></span>{choice.label}
            {#if checked}<span class="codicon codicon-check ml-auto"></span>{/if}
          </strong>
          {#if choice.description}<span class="text-[0.85em] text-muted">{choice.description}</span>{/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-4">
    <h2 class="m-0 flex items-center gap-2 font-display text-lg font-medium">
      <span class="grid size-6 place-items-center rounded-full bg-indigo text-[0.8em] text-on-accent">3</span> Folders
    </h2>
    {#each KINDS as { kind, title, tag, tone, help } (kind)}
      {@const where = targets(kind, folders[kind])}
      <div class="grid gap-x-4 gap-y-1 border-t-[1.5px] border-soft-line pt-3 min-[700px]:grid-cols-[14rem_1fr]">
        <div>
          <strong>{title}</strong> <span class="tag {tone}">{tag}</span>
          <p class="m-0 text-[0.85em] text-muted">{help}</p>
        </div>
        <div class="flex min-w-0 flex-col items-start gap-1.5">
          {#each folders[kind] as path, index (path)}
            <div class="flex w-full min-w-0 items-center gap-2 text-[0.9em]">
              <span class="min-w-0 truncate font-mono" title={path}>{short(path, system.home)}</span>
              <span class="shrink-0 text-muted">→ {where[index]}</span>
              <button
                type="button"
                class="ml-auto text-muted hover:text-red"
                title="Don't mount this {FOLDER_KINDS[kind].noun} folder"
                aria-label="Remove {path}"
                onclick={() => folders[kind].splice(index, 1)}><span class="codicon codicon-close"></span></button
              >
            </div>
          {:else}
            <span class="text-[0.9em] text-muted">No folders chosen</span>
          {/each}
          {#if kind === 'skills' && system.configSkills.length}
            <span class="text-[0.85em] text-muted">Always mounted from {system.configDirectory}: {system.configSkills.map((path) => short(path, system.home)).join(', ')}</span>
          {/if}
          <button type="button" class="pill pill-small" onclick={() => (browsing = kind)}>Add folder…</button>
        </div>
      </div>
    {/each}
    <div class="grid gap-x-4 gap-y-1 border-t-[1.5px] border-soft-line pt-3 min-[700px]:grid-cols-[14rem_1fr]">
      <div>
        <strong>Network</strong>
        <p class="m-0 text-[0.85em] text-muted">
          Isolated, the sandbox reaches only its agent's service and the hosts you allow, so your data stays in it. The agent asks you when it needs a host, for
          example to install packages.
        </p>
      </div>
      <div class="flex flex-col items-start gap-1">
        <label class="flex items-center gap-2 font-semibold"><input type="checkbox" bind:checked={isolate} /> Isolate the network</label>
        {#if isolate}
          <p class="m-0 text-[0.85em] {isolationProblem ? 'text-red' : 'text-muted'}">
            {isolationProblem
              ? `${isolationProblem[0].toUpperCase()}${isolationProblem.slice(1)}. Run without isolation here, or on a Linux machine or cluster.`
              : `Allowed hosts go in ${system.projects}/${project.trim() || 'default'}.allowed-hosts.txt, one per line.`}
          </p>
        {/if}
      </div>
    </div>
  </section>

  <details class="rounded-xl border-[1.5px] border-soft-line px-4 py-2">
    <summary class="cursor-pointer font-semibold">Advanced</summary>
    <div class="flex flex-col gap-3 py-3">
      <label class="flex flex-col gap-1"
        >Project name
        <input class="field" bind:value={project} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" maxlength="100" />
        <span class="text-[0.85em] text-muted">Sessions, sign-ins and the agent's working files are kept per project in <code>{system.projects}</code>.</span>
      </label>
      <label class="flex flex-col gap-1"
        >Engine
        <select class="field" bind:value={engine} onchange={reload}>
          <option value="auto">Automatic</option>
          <option value="docker">Docker</option>
          <option value="podman">Podman</option>
          <option value="apptainer">Apptainer</option>
        </select>
      </label>
      <label class="flex flex-col gap-1"
        >Sandbox version
        <input class="field" bind:value={imageTag} placeholder={system.imageTag || 'latest'} onchange={reload} />
        <span class="text-[0.85em] text-muted"
          >Empty runs the release this app is made for; or <code>latest</code>, another release (<code>0.2.1</code>, or <code>0.2</code> for its newest fix) or a commit's build (<code>sha-abc1234</code>), downloaded
          on first use.</span
        >
      </label>
      <label class="flex flex-col gap-1"
        >Sandbox image
        <input class="field" bind:value={image} placeholder="the published image, downloaded on first use" onchange={reload} />
        <span class="text-[0.85em] text-muted">Instead of a version: a Docker or Podman image name, or an Apptainer <code>.sif</code> file.</span>
      </label>
    </div>
  </details>

  <div class="flex flex-wrap items-center justify-end gap-3">
    {#if error}<p class="m-0 flex-1 text-red" role="alert">{error}</p>{/if}
    <button type="submit" class="pill pill-primary px-6 py-2 text-[1.05em]" disabled={!canStart || starting}>{starting ? 'Starting…' : 'Start sandbox'}</button>
  </div>
</form>

{#if browsing}
  {@const kind = browsing}
  <FolderBrowser
    title={FOLDER_KINDS[kind].title}
    canCreate={kind !== 'inputs'}
    start={browseStart(kind)}
    onchoose={(path) => {
      if (!folders[kind].includes(path)) folders[kind].push(path);
    }}
    onclose={() => (browsing = null)}
  />
{/if}
