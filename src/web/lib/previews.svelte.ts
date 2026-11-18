// Tabs that show files from a sandbox: the figures, reports and tables the
// agent shows with `codeflower-show`, or paths clicked in the chat. Each tab
// follows its file and sends the user's feedback to the chat it came from; an
// HTML report can also show with its scripts running. Where the tabs are is the
// sandbox's workbench's business (see workbench.svelte.ts).
import { untrack } from 'svelte';
import type { PreviewHost } from '../../chat/lib/host.ts';
import { decodeText } from '../../chat/lib/files.ts';
import { isFileConflict } from '../../client/codeflower.ts';
import type { ShowRequest } from '../../client/workerConnection.ts';
import type { PreviewHostMessage, PreviewState, PreviewWebviewMessage, SandboxFile } from '../../protocol/messages.ts';
import { feedbackAnnotations, feedbackFigure, feedbackText } from '../../chat/lib/feedback.ts';
import { isBesideReport, isStorytellerReport } from '../../chat/lib/report.ts';
import { basename, displayPath, resolvePath } from './report.ts';
import type { WebWorker } from './worker.svelte.ts';

const POLL_MS = 2_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the previews need from the page. */
export interface PreviewOwner {
  /** The sandbox's agent, if the page reaches it. */
  agent(workerId: string): WebWorker | undefined;
  /** The tab is in front of its group, on the page in front. */
  visible(workerId: string, tab: string): boolean;
  /**
   * Opens a file's tab, or brings it to the front. `reveal`: the user asked to
   * see it (a click), so it comes in front where they look, e.g. in a narrow
   * window or in Focus's pane beside its chat (`chatKey`).
   */
  open(workerId: string, tab: string, options?: { reveal?: boolean; chatKey?: string }): void;
  showChat(workerId: string, key: string): void;
  /**
   * The sandbox's network is isolated: its reports' scripts do not run unless
   * the user asks, since a script can send the report out of the browser.
   */
  isolated(workerId: string): boolean;
}

export class Preview {
  readonly workerId: string;
  file = $state<SandboxFile>() as SandboxFile;
  title = $state('');
  chatKey = $state<string | undefined>();
  data = $state<string | null>(null);
  error = $state<string | null>(null);
  /** The HTML file shows with its scripts running. */
  interactive = $state(false);
  /** The user's edits in the tab are not saved. */
  dirty = $state(false);
  private message = $state<string | null>(null);
  /** The agent's note describes the file as shown; it goes once the file changes. */
  private messageFor = $state<number | undefined>();
  private noteShown = false;
  private ready = $state(false);
  private loading: Promise<void> | undefined;
  /** Shown or opened again: a storyteller report opens interactive once it has loaded. */
  private wantsInteractive = false;
  private commentsSaved: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(message: PreviewHostMessage) => void>();
  private readonly owner: Previews;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly stop: () => void;

  constructor(owner: Previews, workerId: string, file: SandboxFile) {
    this.owner = owner;
    this.workerId = workerId;
    this.file = file;
    this.title = basename(file.path);
    // The agent often rewrites a figure under the same name: follow the file.
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    // The tab says where feedback goes and whether the agent is busy.
    this.stop = $effect.root(() => {
      $effect(() => {
        const state = $state.snapshot(this.state) as PreviewState;
        // The views' listeners read and write their own state.
        if (this.ready) untrack(() => this.post({ type: 'preview', state }));
      });
    });
  }

  get id(): string {
    return this.file.path;
  }

  /** The file's HTML, when it is an HTML file. */
  readonly html = $derived(this.data && this.file.mimeType === 'text/html' ? decodeText(this.data) : '');

  private readonly state = $derived.by((): PreviewState => {
    const agent = this.owner.page.agent(this.workerId);
    const chat = this.chatKey ? agent?.chats[this.chatKey] : undefined;
    return {
      file: this.file,
      data: this.data,
      error: this.error,
      title: this.title,
      message: this.messageFor === this.file.mtimeMs ? this.message : null,
      chat: chat ? { title: chat.state.title, busy: chat.state.busy } : this.chatKey ? { title: 'the chat', busy: false } : null,
      live: agent?.state === 'connected',
      interactive: this.interactive
    };
  });

  /** The host the preview view talks to. */
  readonly host: PreviewHost = {
    // A view may send from its effects: what this does is not theirs to track.
    send: (message) => untrack(() => void this.handle(message)),
    listen: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  };

  /** Shows the file again, e.g. when the agent shows it once more. */
  update(options: { title?: string; message?: string | null; chatKey?: string }): void {
    this.wantsInteractive = true;
    if (options.title) this.title = options.title;
    if (options.message !== undefined) {
      this.message = options.message;
      this.noteShown = true;
    }
    if (options.chatKey) this.chatKey = options.chatKey;
    void this.load();
  }

  close(): void {
    clearInterval(this.timer);
    this.stop();
  }

  private post(message: PreviewHostMessage): void {
    for (const listener of this.listeners) listener(message);
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const connection = this.owner.page.agent(this.workerId)?.connection;
        if (!connection) throw new Error('The sandbox is not connected');
        const { data, ...file } = await connection.readPreview(this.file.path);
        this.file = file;
        this.data = data;
        this.error = null;
        if (this.wantsInteractive) {
          this.wantsInteractive = false;
          // Charts, explorers and comments only work with the scripts running; the
          // tab's switch shows the static page.
          if (isStorytellerReport(this.html) && !this.owner.page.isolated(this.workerId)) this.owner.openInteractive(this);
        }
        if (this.noteShown) {
          this.messageFor = file.mtimeMs;
          this.noteShown = false;
        }
      } catch (error) {
        this.data = null;
        this.error = describe(error);
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  private async poll(): Promise<void> {
    if (!this.owner.inFront(this) || this.loading || document.visibilityState !== 'visible') return;
    const connection = this.owner.page.agent(this.workerId)?.connection;
    if (!connection?.connected) return;
    try {
      const file = await connection.statFile(this.file.path);
      if (file.mtimeMs !== this.file.mtimeMs || file.size !== this.file.size || this.error) await this.load();
    } catch (error) {
      this.error ??= describe(error);
    }
  }

  /** Sends the user's feedback on the file (or one of its figures) to the chat it came from. */
  async sendFeedback(text: string, annotations?: unknown, figure?: unknown): Promise<'sent' | 'queued' | undefined> {
    const agent = this.owner.page.agent(this.workerId);
    if (!agent || !this.chatKey) return undefined;
    // A chat the agent showed the file in, not open here (yet): open it.
    const chat = agent.chats[this.chatKey] ?? (await agent.open(this.chatKey));
    return chat.send(
      feedbackText(displayPath(this.file.path), 'the code flower app', text, feedbackAnnotations(annotations), feedbackFigure(figure))
    );
  }

  /** Saves a copy of a file beside the report (a deck's .pptx) through the browser's downloads. */
  async downloadBeside(name: string): Promise<void> {
    try {
      const connection = this.owner.page.agent(this.workerId)?.connection;
      if (!connection) throw new Error('The sandbox is not connected');
      const file = await connection.readFile(resolvePath(this.file.path, name));
      download(basename(file.path), file.mimeType, file.data);
    } catch (error) {
      this.error = `Could not download ${name}: ${describe(error)}`;
    }
  }

  /** Saves the user's comments into the report, one save after another, then shows the new file. */
  saveComments(json: string): void {
    this.commentsSaved = this.commentsSaved
      .then(async () => {
        const connection = this.owner.page.agent(this.workerId)?.connection;
        if (!connection) throw new Error('The sandbox is not connected');
        await connection.saveReportComments(this.file.path, json);
        await this.load();
      })
      .catch((error: unknown) => {
        this.error = `Could not save the comments on ${this.title}: ${describe(error)}`;
      });
  }

  private async handle(message: PreviewWebviewMessage): Promise<void> {
    const agent = this.owner.page.agent(this.workerId);
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.post({
          type: 'preview',
          state: $state.snapshot(this.state) as PreviewState
        });
        break;
      case 'feedback': {
        const outcome = await this.sendFeedback(message.text, message.annotations, message.figure);
        if (outcome) this.post({ type: 'feedbackSent', queued: outcome === 'queued' });
        break;
      }
      case 'asset': {
        // Files a report refers to, relative to the report.
        let dataUrl: string | null = null;
        try {
          const file = await agent!.connection!.readFile(resolvePath(this.file.path, message.path));
          dataUrl = `data:${file.mimeType};base64,${file.data}`;
        } catch {
          dataUrl = null;
        }
        this.post({ type: 'asset', path: message.path, dataUrl });
        break;
      }
      case 'openFile':
        if (agent) void this.owner.openPath(agent, resolvePath(this.file.path, message.path), this.chatKey);
        break;
      case 'save':
        if (this.data) download(basename(this.file.path), this.file.mimeType, this.data);
        break;
      case 'saveFigure':
        if (isBesideReport(message.name)) download(message.name, message.mimeType, message.data);
        break;
      case 'write':
        try {
          if (!agent?.connection) throw new Error('The sandbox is not connected');
          const file = await agent.connection.writeFile(this.file.path, message.text, message.baseMtimeMs);
          // The saved text is the file now: no need to read it back.
          this.file = file;
          this.data = encodeText(message.text);
          this.error = null;
          this.post({ type: 'written', file });
        } catch (error) {
          this.post({ type: 'writeFailed', error: describe(error), conflict: isFileConflict(error) });
        }
        break;
      case 'dirty':
        this.dirty = message.dirty;
        break;
      case 'showChat':
        if (this.chatKey) this.owner.page.showChat(this.workerId, this.chatKey);
        break;
      case 'interactive':
        if (message.on) this.owner.openInteractive(this, { asked: true });
        else this.interactive = false;
        break;
      case 'reportComments':
        this.saveComments(message.json);
        break;
      case 'download':
        void this.downloadBeside(message.path);
        break;
    }
  }
}

function encodeText(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Saves a copy through the browser's downloads. */
function download(name: string, mimeType: string, base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export class Previews {
  items = $state<Preview[]>([]);
  readonly page: PreviewOwner;

  constructor(page: PreviewOwner) {
    this.page = page;
    // Leaving the page loses edits that are not saved: the browser asks first.
    addEventListener('beforeunload', (event) => {
      if (this.items.some((preview) => preview.dirty)) event.preventDefault();
    });
  }

  /** Closing the tab loses the user's edits: asks first. */
  mayClose(workerId: string, tab: string): boolean {
    const preview = this.find(workerId, tab);
    return !preview?.dirty || confirm(`${preview.title} has edits that are not saved. Close it anyway?`);
  }

  of(workerId: string): Preview[] {
    return this.items.filter((preview) => preview.workerId === workerId);
  }

  find(workerId: string, id: string): Preview | undefined {
    return this.items.find((preview) => preview.workerId === workerId && preview.id === id);
  }

  inFront(preview: Preview): boolean {
    return this.page.visible(preview.workerId, preview.id);
  }

  activate(workerId: string, tab: string, options?: { reveal?: boolean; chatKey?: string }): void {
    this.page.open(workerId, tab, options);
  }

  /** The agent ran `codeflower-show`, or asks to approve a plan in a chat. */
  show(worker: WebWorker, request: ShowRequest): void {
    // The chat the worker names, also one not open here; else one open here.
    const chatKey = request.sessionKey ?? worker.chatFor()?.key;
    if (chatKey)
      void worker.connection
        ?.recordShow(
          chatKey,
          request.files.map((file) => file.path),
          request.message,
          request.noted === true
        )
        .catch(() => undefined);
    for (const file of request.files) {
      this.open(worker.id, file, {
        chatKey,
        message: request.message ?? null,
        ...(request.title && request.files.length === 1 ? { title: request.title } : {})
      });
    }
  }

  /** A path clicked in a chat or a report; `reveal: false` opens it without bringing it where the user looks. */
  async openPath(worker: WebWorker, path: string, chatKey: string | undefined, { reveal = true } = {}): Promise<void> {
    try {
      if (!worker.connection) throw new Error('the sandbox is not connected');
      this.open(worker.id, await worker.connection.statFile(path), { chatKey, reveal });
    } catch (error) {
      const chat = chatKey ? worker.chats[chatKey] : undefined;
      chat?.notify('error', `Cannot show ${displayPath(path)}: ${describe(error)}`);
    }
  }

  private open(
    workerId: string,
    file: SandboxFile,
    { reveal = false, ...options }: { chatKey?: string; message?: string | null; title?: string; reveal?: boolean }
  ): void {
    let preview = this.find(workerId, file.path);
    if (!preview) {
      preview = new Preview(this, workerId, file);
      this.items.push(preview);
    }
    this.activate(workerId, preview.id, { reveal, chatKey: options.chatKey });
    preview.update(options);
  }

  openInteractive(preview: Preview, { asked = false } = {}): void {
    if (!preview.html) return;
    // A report's scripts can send its content anywhere by loading another
    // page: past the network isolation the sandbox has, so only when asked.
    if (asked && this.page.isolated(preview.workerId) && !preview.interactive) {
      const run = confirm(
        `This sandbox's network is isolated, but a report's scripts run in your browser and can send its content anywhere. Run the scripts of ${preview.title}?`
      );
      if (!run) return;
    }
    preview.interactive = true;
  }

  /** The user closed a file's tab. */
  closed(workerId: string, tab: string): void {
    const preview = this.find(workerId, tab);
    if (!preview) return;
    preview.close();
    this.items = this.items.filter((item) => item !== preview);
  }

  /** The sandbox is gone: its previews go too. */
  closeWorker(workerId: string): void {
    for (const preview of this.of(workerId)) preview.close();
    this.items = this.items.filter((preview) => preview.workerId !== workerId);
  }
}
