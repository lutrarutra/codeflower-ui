<script lang="ts">
  // Remote access through a code flower tunnel: sign this computer in, pair
  // browsers and phones, turn it off. Only on the computer itself (the app
  // refuses /api/tunnel through the tunnel), and hidden by apps without it.
  import { tunnelConnectorId } from '../../tunnel/connect.ts';
  import { api, copyText, type TunnelPairing, type TunnelStatus } from '../lib/api.ts';
  import { app } from '../lib/app.svelte.ts';
  import Status from './Status.svelte';

  const local = tunnelConnectorId() === undefined;
  let status = $state<TunnelStatus | null>(null);
  let error = $state('');
  let busy = $state(false);
  let pairing = $state<TunnelPairing | null>(null);
  let chosen = $state<string[]>([]);
  let copied = $state(false);

  const here = $derived(app.workers.filter((worker) => worker.source !== 'added'));

  $effect(() => {
    if (!local) return;
    let loading = false;
    const refresh = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        status = await api<TunnelStatus>('/api/tunnel');
      } catch {
        // An app without remote access from the page; the card stays hidden.
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (pairing && status && !status.signedIn) pairing = null;
  });

  async function act(path: string, method: string, body: unknown = {}): Promise<void> {
    busy = true;
    error = '';
    try {
      const answer = await api<TunnelStatus & { warning?: string }>(path, { method, body });
      status = answer;
      if (answer.warning) error = answer.warning;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  const signIn = (euOnly?: boolean) => act('/api/tunnel/login', 'POST', euOnly === undefined ? {} : { euOnly });

  async function pair(): Promise<void> {
    busy = true;
    error = '';
    copied = false;
    try {
      pairing = await api<TunnelPairing>('/api/tunnel/pair', { body: status?.hardened ? { workers: chosen } : {} });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function copy(text: string): Promise<void> {
    await copyText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function signOut(): void {
    if (confirm('Sign this computer out of the tunnel? Every paired browser must pair again after signing in.')) {
      pairing = null;
      void act('/api/tunnel', 'DELETE');
    }
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
</script>

{#if local && status?.available}
  <section class="card p-5" aria-labelledby="tunnel-title">
    <h2 id="tunnel-title" class="m-0 mb-3 font-display text-lg font-medium">Remote access</h2>

    {#if status.login}
      {@const login = status.login}
      <Status kind="warn" title="Approve this computer on the tunnel" detail="Sign in on the page that opened and approve the code. This card updates once it is approved." />
      <dl class="my-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.9em]">
        <dt class="text-muted">Code</dt>
        <dd class="m-0 font-mono text-lg font-bold">{login.userCode}</dd>
        <dt class="text-muted">Name</dt>
        <dd class="m-0">{login.name}</dd>
        <dt class="text-muted">Key fingerprint</dt>
        <dd class="m-0 font-mono">{login.fingerprint}</dd>
        <dt class="text-muted">Expires</dt>
        <dd class="m-0">{time(login.expiresAt)}</dd>
      </dl>
      <div class="flex flex-wrap gap-2">
        <a class="pill pill-primary" href={login.verificationUrl} target="_blank" rel="noreferrer">Open the approval page ↗</a>
        <button class="pill" disabled={busy} onclick={() => act('/api/tunnel/login', 'DELETE')}>Cancel</button>
      </div>
    {:else if !status.signedIn}
      <p class="m-0 text-muted">
        Use code flower on this computer from any browser or phone, through the tunnel at {host(status.url)}. Everything between a paired browser and this
        computer is end-to-end encrypted; the tunnel cannot read it.
      </p>
      {#if status.loginError}
        <div class="mt-3"><Status kind="bad" title="Signing in did not finish" detail={status.loginError} /></div>
      {/if}
      {#if status.euOnly === null}
        <p class="mb-2 mt-3">Route the tunnel only through EU datacenters? It is slower from outside Europe. The answer is saved in config.yaml.</p>
        <div class="flex flex-wrap gap-2">
          <button class="pill pill-primary" disabled={busy} onclick={() => signIn(false)}>Sign in, nearest datacenter</button>
          <button class="pill" disabled={busy} onclick={() => signIn(true)}>Sign in, EU only</button>
        </div>
      {:else}
        <button class="pill pill-primary mt-3" disabled={busy} onclick={() => signIn()}>{busy ? 'Signing in…' : 'Connect to the tunnel'}</button>
      {/if}
    {:else}
      {#if status.off}
        <Status kind="warn" title="Remote access is off" detail="Paired browsers are kept but cannot reach this computer." />
      {:else if status.pageUrl}
        <Status kind="ok" title="Connected to the tunnel" detail="Paired browsers open code flower at {status.pageUrl}" />
      {:else}
        <p class="m-0 text-muted"><span class="spinner"></span> Connecting to {host(status.url)}…</p>
      {/if}
      <p class="mb-0 mt-2 text-[0.85em] text-muted">
        {status.region === 'eu' ? 'EU datacenters only' : 'Nearest datacenter'} · key fingerprint <span class="font-mono">{status.fingerprint}</span>
      </p>

      {#if !status.off}
        <h3 class="mb-2 mt-4 text-base font-medium">Pair a browser or phone</h3>
        {#if status.hardened}
          <p class="m-0 text-[0.9em] text-muted">Choose the sandboxes it may use; it sees no others.</p>
          <div class="my-2 flex flex-col gap-1">
            {#each here as worker (worker.id)}
              <label class="flex items-center gap-2 text-[0.9em]"><input type="checkbox" value={worker.id} bind:group={chosen} /> {worker.name || worker.label}</label>
            {:else}
              <p class="m-0 text-[0.9em] text-muted">No sandboxes on this computer yet.</p>
            {/each}
          </div>
        {/if}
        {#if pairing}
          <p class="m-0 text-[0.9em]">Open this link there, once, before {time(pairing.expiresAt)}. Check that the page shows the fingerprint {pairing.fingerprint}.</p>
          <div class="mt-1 flex items-start gap-2">
            <pre class="m-0 min-w-0 flex-1 overflow-x-auto rounded-lg bg-code px-2.5 py-1.5 font-mono text-[0.85em]">{pairing.link}</pre>
            <button type="button" class="pill pill-small" onclick={() => copy(pairing!.link)}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        {/if}
        <button class="pill mt-2" disabled={busy || (status.hardened && !chosen.length)} onclick={pair}>{pairing ? 'New pairing link' : 'Make a pairing link'}</button>
      {/if}

      {#if status.devices.length}
        <h3 class="mb-2 mt-4 text-base font-medium">Paired browsers</h3>
        <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
          {#each status.devices as device (device.key)}
            <li class="flex flex-wrap items-center gap-2 text-[0.9em]">
              <span class="min-w-0 flex-1">{device.label} <span class="font-mono text-muted">{device.fingerprint}</span></span>
              <button class="pill pill-small" disabled={busy} onclick={() => act('/api/tunnel/revoke', 'POST', { key: device.key })}>Unpair</button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="mt-4 flex flex-wrap gap-2">
        <button class="pill" disabled={busy} onclick={() => act('/api/tunnel', 'PATCH', { off: !status!.off })}>{status.off ? 'Turn remote access on' : 'Turn remote access off'}</button>
        <button class="pill" disabled={busy} onclick={signOut}>Sign out</button>
      </div>
    {/if}

    {#if error}
      <div class="mt-3"><Status kind="bad" title="The tunnel answered with an error" detail={error} /></div>
    {/if}
  </section>
{/if}
