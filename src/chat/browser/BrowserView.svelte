<script lang="ts">
  // A chat's browser (codeflower-browser): the Chromium in the sandbox that
  // the agent drives, shown live as frames on a canvas. The user watches, or
  // takes it over (to log in, say) and hands it back; while they have it, the
  // agent waits, and what they type goes to the page, never to the agent.
  // Host-agnostic: the page's tab and the extension's panel give it `host`.
  import type { BrowserFrame, BrowserFrameMetadata, BrowserHost, BrowserInputEvent, BrowserMouseButton, BrowserState } from '../../protocol/browser.ts';
  import { buttonOf, coalesce, isClipboardKey, keyEvent, modifiersOf, pagePoint, wheelDelta } from './input.ts';

  let {
    browser,
    host,
    visible = true,
    connected = true
  }: {
    browser: BrowserState;
    host: BrowserHost;
    /** The view is in front: frames come only then. */
    visible?: boolean;
    connected?: boolean;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let keys: HTMLTextAreaElement | undefined = $state();
  let metadata: BrowserFrameMetadata | undefined;
  let image = { width: 0, height: 0 };
  let shown = $state(false);
  let error = $state('');
  let address = $state('');
  let editingAddress = $state(false);
  let note = $state('');
  let promptText = $state('');
  let pageVisible = $state(typeof document === 'undefined' || document.visibilityState === 'visible');

  const running = $derived(browser.running);
  const yours = $derived(browser.yours === true);
  const handoff = $derived(browser.handoff);
  const othersHaveIt = $derived(browser.controlled && !yours);

  // The address bar follows the page unless the user is typing in it.
  $effect(() => {
    const url = browser.url;
    if (!editingAddress) address = url === 'about:blank' ? '' : url;
  });

  // Frames come while the view is in front and the sandbox connected.
  $effect(() => {
    if (!visible || !pageVisible || !connected || !running) return;
    const unsubscribe = host.frames((frame) => void draw(frame));
    error = '';
    host.watch({ maxWidth: 1600, maxHeight: 1000, quality: 60 }).catch((cause: unknown) => (error = describe(cause)));
    return () => {
      unsubscribe();
      void host.unwatch().catch(() => undefined);
    };
  });

  // A frame is drawn, then answered: the next comes after the answer.
  async function draw(frame: BrowserFrame): Promise<void> {
    try {
      const binary = atob(frame.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      if (canvas) {
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        image = { width: bitmap.width, height: bitmap.height };
        metadata = frame.metadata;
        shown = true;
      }
      bitmap.close();
    } catch {
      // A frame that does not decode is skipped.
    } finally {
      void host.ack(frame.frameId).catch(() => undefined);
    }
  }

  function describe(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  function act(promise: Promise<unknown>): void {
    promise.then(
      () => (error = ''),
      (cause: unknown) => (error = describe(cause))
    );
  }

  // ---- the user's input, while they control the browser ----

  let queue: BrowserInputEvent[] = [];
  let flushing = 0;
  function send(event: BrowserInputEvent): void {
    if (!yours) return;
    queue.push(event);
    flushing ||= requestAnimationFrame(flush);
  }
  function flush(): void {
    flushing = 0;
    const events = coalesce(queue);
    queue = [];
    if (events.length) act(host.input(events));
  }

  function point(event: MouseEvent): { x: number; y: number } | undefined {
    if (!canvas || !metadata) return undefined;
    return pagePoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), image, metadata);
  }

  const held = (buttons: number): BrowserMouseButton => (buttons & 1 ? 'left' : buttons & 2 ? 'right' : buttons & 4 ? 'middle' : 'none');

  function pointer(action: 'down' | 'move' | 'up', event: PointerEvent): void {
    if (!yours) return;
    const at = point(event);
    if (!at) return;
    if (action === 'down') {
      event.preventDefault();
      canvas?.setPointerCapture(event.pointerId);
      // Keys go to the page from here on, and a phone shows its keyboard.
      keys?.focus({ preventScroll: true });
    }
    send({
      type: 'mouse',
      action,
      ...at,
      button: action === 'move' ? held(event.buttons) : buttonOf(event.button),
      buttons: event.buttons,
      clickCount: action === 'move' ? 0 : Math.max(1, event.detail || 1),
      modifiers: modifiersOf(event)
    });
  }

  function wheel(event: WheelEvent): void {
    if (!yours) return;
    const at = point(event);
    if (!at) return;
    event.preventDefault();
    send({ type: 'wheel', ...at, ...wheelDelta(event, metadata?.deviceHeight ?? 800), modifiers: modifiersOf(event) });
  }

  function key(action: 'down' | 'up', event: KeyboardEvent): void {
    // While composing (an IME, a phone's keyboard), the text comes with the input or composition's end.
    if (!yours || event.isComposing || event.keyCode === 229 || isClipboardKey(event)) return;
    event.preventDefault();
    send(keyEvent(action, event));
  }

  function typed(input: Event): void {
    const event = input as InputEvent;
    if (!yours || !keys || event.isComposing) return;
    if (event.inputType === 'insertText' && event.data) send({ type: 'text', text: event.data });
    else if (event.inputType === 'deleteContentBackward') {
      const backspace = { key: 'Backspace', code: 'Backspace', keyCode: 8, location: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
      send(keyEvent('down', backspace));
      send(keyEvent('up', backspace));
    }
    keys.value = '';
  }

  function composed(event: CompositionEvent): void {
    if (event.data) send({ type: 'text', text: event.data });
    if (keys) keys.value = '';
  }

  function pasted(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain');
    if (!yours || !text) return;
    event.preventDefault();
    send({ type: 'text', text });
  }

  function go(event: SubmitEvent): void {
    event.preventDefault();
    if (!yours || !address.trim()) return;
    editingAddress = false;
    act(host.navigate('goto', address.trim()));
  }

  function handBack(): void {
    const text = note.trim();
    note = '';
    act(host.handBack(text || undefined));
  }

  const tabTitle = (tab: { title: string; url: string }) => tab.title || tab.url || 'New tab';
</script>

<svelte:document onvisibilitychange={() => (pageVisible = document.visibilityState === 'visible')} />

<div class="flex h-full min-h-0 flex-col bg-paper">
  <header class="flex items-center gap-1.5 border-b-[1.5px] border-soft-line px-2 py-1.5 text-[0.9em]">
    <button class="chip" title="Back" aria-label="Back" disabled={!yours} onclick={() => act(host.navigate('back'))}>
      <span class="codicon codicon-arrow-left"></span>
    </button>
    <button class="chip" title="Forward" aria-label="Forward" disabled={!yours} onclick={() => act(host.navigate('forward'))}>
      <span class="codicon codicon-arrow-right"></span>
    </button>
    <button class="chip" title="Reload" aria-label="Reload" disabled={!yours} onclick={() => act(host.navigate('reload'))}>
      <span class="codicon codicon-refresh"></span>
    </button>
    <form class="min-w-0 flex-1" onsubmit={go}>
      <input
        class="w-full rounded-md border-[1.5px] border-soft-line bg-code px-2 py-1 font-mono text-[0.9em] text-ink disabled:text-muted"
        aria-label="Address"
        placeholder={running ? 'about:blank' : 'The browser is not running'}
        bind:value={address}
        readonly={!yours}
        disabled={!running}
        title={yours ? 'Type an address and press Enter' : 'Take control to go elsewhere'}
        onfocus={() => (editingAddress = yours)}
        onblur={() => (editingAddress = false)}
      />
    </form>
    {#if browser.tabs.length > 1}
      <select
        class="max-w-[12rem] truncate rounded-md border-[1.5px] border-soft-line bg-code px-1.5 py-1 text-[0.9em]"
        aria-label="Tab shown"
        value={browser.selected}
        onchange={(event) => act(host.selectTab(event.currentTarget.value))}
      >
        {#each browser.tabs as tab, index (tab.targetId)}
          <option value={tab.targetId}>{index + 1}. {tabTitle(tab)}</option>
        {/each}
      </select>
    {/if}
    {#if running && !yours}
      <button
        class={handoff ? 'pill pill-primary pill-small shrink-0' : 'chip shrink-0'}
        title="Use the browser yourself; the agent waits until you hand it back"
        disabled={!connected}
        onclick={() => act(host.control(true))}
      >
        <span class="codicon codicon-hand"></span> Take control
      </button>
    {/if}
  </header>

  {#if yours}
    <form
      class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b-[1.5px] border-indigo/40 bg-indigo-soft px-3 py-1.5 text-[0.85em]"
      onsubmit={(event) => (event.preventDefault(), handBack())}
    >
      <span class="codicon codicon-lock shrink-0 text-indigo"></span>
      <span class="min-w-0 basis-[calc(100%-2rem)]">You control the browser; the agent waits. What you type goes to the page, not to the agent.</span>
      <input
        class="min-w-[10rem] flex-1 rounded-md border-[1.5px] border-soft-line bg-card px-2 py-0.5"
        placeholder="Note for the agent (optional), e.g. Logged in"
        aria-label="Note for the agent"
        bind:value={note}
      />
      <button class="pill pill-primary pill-small shrink-0" type="submit">
        <span class="codicon codicon-check"></span> Hand back
      </button>
    </form>
  {:else if handoff}
    <p class="m-0 flex items-center gap-2 border-b-[1.5px] border-soft-line bg-yellow-soft px-3 py-1.5 text-[0.85em]" role="status">
      <span class="codicon codicon-bell shrink-0 text-orange"></span>
      <span><strong>The agent needs you:</strong> {handoff.reason}</span>
    </p>
  {:else if othersHaveIt}
    <p class="m-0 border-b-[1.5px] border-soft-line px-3 py-1.5 text-[0.85em] text-muted" role="status">
      Another window controls the browser.
    </p>
  {/if}
  {#if error}
    <p class="m-0 border-b-[1.5px] border-soft-line px-3 py-1.5 text-[0.85em] text-red" role="alert">{error}</p>
  {/if}

  <div class="relative min-h-0 flex-1 overflow-hidden bg-sunken" class:ring-2={yours} class:ring-indigo={yours} class:ring-inset={yours}>
    <canvas
      bind:this={canvas}
      class="block h-full w-full object-contain"
      class:invisible={!shown || !running}
      class:cursor-default={yours}
      style:touch-action={yours ? 'none' : 'auto'}
      aria-label="The chat's browser{browser.title ? `: ${browser.title}` : ''}"
      onpointerdown={(event) => pointer('down', event)}
      onpointermove={(event) => pointer('move', event)}
      onpointerup={(event) => pointer('up', event)}
      onwheel={wheel}
      oncontextmenu={(event) => yours && event.preventDefault()}
    ></canvas>
    <!-- Where keys go while the user controls the browser: hidden, but focused, so IMEs, paste and phone keyboards work. -->
    <textarea
      bind:this={keys}
      class="pointer-events-none absolute top-0 left-0 size-px opacity-0"
      aria-label="Keyboard input for the browser"
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      tabindex={yours ? 0 : -1}
      onkeydown={(event) => key('down', event)}
      onkeyup={(event) => key('up', event)}
      oninput={typed}
      oncompositionend={composed}
      onpaste={pasted}
    ></textarea>

    {#if !connected}
      <p class="absolute inset-0 m-0 grid place-items-center p-6 text-center text-muted">Not connected to the sandbox: the browser runs on there.</p>
    {:else if !running}
      <p class="absolute inset-0 m-0 grid place-items-center p-6 text-center text-muted">
        This chat's browser is not running. It starts when the agent uses it (codeflower-browser).
      </p>
    {:else if !shown}
      <p class="absolute inset-0 m-0 grid place-items-center p-6 text-center text-muted">Waiting for the page…</p>
    {/if}

    {#if browser.dialog}
      <div class="absolute inset-0 grid place-items-center bg-black/30 p-4">
        <div class="card w-full max-w-sm p-4" role="alertdialog" aria-label="The page asks">
          <p class="eyebrow m-0">The page asks ({browser.dialog.type})</p>
          <p class="mt-2 mb-3 whitespace-pre-wrap">{browser.dialog.message}</p>
          {#if yours}
            {#if browser.dialog.type === 'prompt'}
              <input class="mb-3 w-full rounded-md border-[1.5px] border-soft-line bg-code px-2 py-1" bind:value={promptText} aria-label="Answer" />
            {/if}
            <div class="flex justify-end gap-2">
              {#if browser.dialog.type !== 'alert'}
                <button class="pill pill-small" onclick={() => act(host.dialog(false))}>Cancel</button>
              {/if}
              <button class="pill pill-primary pill-small" onclick={() => act(host.dialog(true, browser.dialog?.type === 'prompt' ? promptText : undefined))}>OK</button>
            </div>
          {:else}
            <p class="m-0 text-[0.85em] text-muted">Take control to answer it.</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
