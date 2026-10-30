<script lang="ts">
  // Signs a sandbox's agent in with one of the methods it offers: by itself,
  // with a key, or with its sign-in command in a terminal. The login stays in
  // the sandbox's project.
  import { untrack } from 'svelte';
  import { app } from './lib/app.svelte.ts';

  const signIn = app.signIn;
  let dialog: HTMLDialogElement | undefined = $state();
  let apiKey = $state('');
  /** Which keys code flower keeps for the agent. */
  let provider = $state<'deepseek' | 'compatible'>('deepseek');
  let baseURL = $state('');
  let models = $state('');
  let reasoningEfforts = $state('low, medium, high');
  /** The sign-in terminal ended without signing in. */
  let failed = $state(false);

  const step = $derived(signIn.step);
  const modelList = $derived(models.split(',').map((model) => model.trim()).filter(Boolean));
  const effortList = $derived(reasoningEfforts.split(',').map((effort) => effort.trim()).filter(Boolean));
  const keysReady = $derived(
    !!apiKey.trim() && (provider === 'deepseek' || (/^https?:\/\/\S+$/.test(baseURL.trim()) && modelList.length > 0))
  );

  $effect(() => {
    const open = !!signIn.worker;
    untrack(() => {
      if (open && dialog && !dialog.open) dialog.showModal();
      else if (!open && dialog?.open) dialog.close();
    });
  });

  // Keys are not kept once used, nor between steps.
  $effect(() => {
    void step.kind;
    untrack(() => {
      apiKey = '';
      failed = false;
    });
  });

  function submitKey(event: SubmitEvent): void {
    event.preventDefault();
    if (step.kind === 'key' && apiKey.trim()) void signIn.authenticate(step.method, apiKey.trim());
  }

  function submitKeys(event: SubmitEvent): void {
    event.preventDefault();
    if (!keysReady) return;
    void signIn.saveKeys(
      provider === 'deepseek'
        ? { deepseekApiKey: apiKey.trim() }
        : {
            openaiCompatible: {
              baseURL: baseURL.trim(),
              models: modelList,
              reasoningEfforts: effortList,
              apiKey: apiKey.trim()
            }
          }
    );
  }
</script>

<dialog
  bind:this={dialog}
  class={step.kind === 'terminal' ? 'max-w-[min(56rem,calc(100vw-2rem))]!' : ''}
  onclose={() => signIn.close()}
  aria-labelledby="sign-in-title"
>
  <div class="card flex flex-col gap-3 p-5">
    <h2 id="sign-in-title" class="m-0 font-display text-lg font-medium">Sign in to {signIn.label}</h2>

    {#if step.kind === 'pick'}
      {#if step.methods.length}
        <p class="m-0 text-muted">The sign-in runs inside the sandbox, and the login stays in its project. How do you want to sign in?</p>
        <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
          {#each step.methods as method (method.id)}
            <li>
              <button class="flex w-full flex-col items-start gap-0.5 rounded-lg border-[1.5px] border-soft-line px-3 py-2 text-left hover:border-indigo" onclick={() => signIn.choose(method)}>
                <span class="font-semibold">{method.name}</span>
                {#if method.description}<span class="text-[0.9em] text-muted">{method.description}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if step.kind === 'key'}
      <form class="flex flex-col gap-3" onsubmit={submitKey} autocomplete="off">
        <p class="m-0 text-muted">{step.method.description ?? `Paste the API key for ${signIn.label}.`}</p>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="field font-mono" type="password" bind:value={apiKey} placeholder="API key" aria-label="API key" spellcheck="false" autofocus />
        <footer class="flex justify-end gap-2">
          <button type="button" class="pill" onclick={() => signIn.back()}>Back</button>
          <button type="submit" class="pill pill-primary" disabled={!apiKey.trim()}>Sign in</button>
        </footer>
      </form>
    {:else if step.kind === 'keys'}
      <form class="flex flex-col gap-3" onsubmit={submitKeys} autocomplete="off">
        <p class="m-0 text-muted">code flower saves the keys in the sandbox's project and restarts the agent to use them.</p>
        <fieldset class="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend class="sr-only">Which service</legend>
          <label class="flex items-center gap-2"><input type="radio" bind:group={provider} value="deepseek" /> DeepSeek API key</label>
          <label class="flex items-center gap-2">
            <input type="radio" bind:group={provider} value="compatible" /> OpenAI-compatible endpoint
            <span class="text-[0.9em] text-muted">OpenRouter, vLLM on the cluster, …</span>
          </label>
        </fieldset>
        {#if provider === 'compatible'}
          <input class="field font-mono" bind:value={baseURL} placeholder="https://openrouter.ai/api/v1" aria-label="Base URL of the API" spellcheck="false" />
          <input class="field font-mono" bind:value={models} placeholder="Model ids, separated by commas" aria-label="Model ids" spellcheck="false" />
          <label class="flex flex-col gap-1">
            <span class="text-[0.9em] text-muted">Reasoning effort values (comma-separated; leave blank to hide the picker)</span>
            <input
              class="field font-mono"
              bind:value={reasoningEfforts}
              placeholder="low, medium, high"
              aria-label="Reasoning effort values"
              spellcheck="false"
            />
          </label>
        {/if}
        <input class="field font-mono" type="password" bind:value={apiKey} placeholder="API key" aria-label="API key" spellcheck="false" />
        <footer class="flex justify-end gap-2">
          <button type="button" class="pill" onclick={() => dialog?.close()}>Cancel</button>
          <button type="submit" class="pill pill-primary" disabled={!keysReady}>Save and restart the agent</button>
        </footer>
      </form>
    {:else if step.kind === 'working'}
      <p class="m-0 text-muted" role="status"><span class="spinner"></span> {step.text}</p>
    {:else if step.kind === 'terminal' && signIn.worker}
      <p class="m-0 text-muted">
        {step.method.name}: follow the steps in the terminal. A link it prints opens in a new tab when you click it.
      </p>
      <!-- xterm.js loads only for a terminal sign-in. -->
      {#await import('./SignInTerminal.svelte')}
        <p class="m-0 text-muted"><span class="spinner"></span> Opening the terminal…</p>
      {:then { default: SignInTerminal }}
        <SignInTerminal
          worker={signIn.worker}
          method={step.method}
          onExit={(exitCode) => {
            failed = exitCode !== 0;
            void signIn.terminalDone(exitCode);
          }}
        />
      {/await}
    {:else if step.kind === 'done'}
      <p class="m-0" role="status"><span class="codicon codicon-pass text-green"></span> {step.text}</p>
    {/if}

    {#if signIn.error}<p class="m-0 text-red" role="alert">{signIn.error}</p>{/if}

    {#if step.kind !== 'key' && step.kind !== 'keys'}
      <footer class="flex justify-end gap-2">
        {#if step.kind === 'terminal' && failed}
          <button class="pill" onclick={() => signIn.back()}>Try again</button>
        {:else if step.kind === 'terminal'}
          <button class="pill" onclick={() => signIn.back()}>Back</button>
        {/if}
        <button class="pill {step.kind === 'done' ? 'pill-primary' : ''}" onclick={() => dialog?.close()}>{step.kind === 'done' ? 'Close' : 'Cancel'}</button>
      </footer>
    {/if}
  </div>
</dialog>
