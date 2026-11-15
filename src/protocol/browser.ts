// A chat's browser (codeflower-browser): a Chromium in the sandbox that the
// agent drives, which windows watch as a stream of frames and the user can take
// over. The bridge's `_codeflower/browser/*` methods and notifications.

export interface BrowserTab {
  targetId: string;
  url: string;
  title: string;
}

/** A page's dialog (alert, confirm, prompt, beforeunload) that waits for an answer. */
export interface BrowserDialog {
  type: string;
  message: string;
  defaultPrompt?: string;
}

/** What the agent asked of the user (codeflower-browser handoff). */
export interface BrowserHandoff {
  reason: string;
  /** ISO time. */
  at: string;
}

/** A chat's browser, as this window sees it (`_codeflower/browser/changed`). */
export interface BrowserState {
  /** The chat's key. */
  key: string;
  running: boolean;
  tabs: BrowserTab[];
  /** The tab the frames show. */
  selected?: string;
  url: string;
  title: string;
  dialog?: BrowserDialog;
  agent?: string;
  /** The agent's playwright-cli is connected. */
  attached?: boolean;
  /** A window controls it (the user took it over). */
  controlled: boolean;
  /** This window controls it. */
  yours?: boolean;
  handoff?: BrowserHandoff;
}

/** Page.screencastFrame's metadata: the page's size in CSS pixels. */
export interface BrowserFrameMetadata {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp?: number;
}

/** One frame of the shown tab (`_codeflower/browser/frame`): answer it with `ack` to get the next. */
export interface BrowserFrame {
  key: string;
  frameId: number;
  /** A JPEG, base64. */
  data: string;
  metadata: BrowserFrameMetadata;
}

/** Bits of the modifier keys held, as CDP counts them. */
export const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

export type BrowserMouseButton = 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward';

/** The user's input, in the page's CSS pixels. */
export type BrowserInputEvent =
  | { type: 'mouse'; action: 'move' | 'down' | 'up'; x: number; y: number; button: BrowserMouseButton; buttons: number; clickCount: number; modifiers: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | { type: 'key'; action: 'down' | 'up'; key: string; code: string; keyCode: number; text?: string; location: number; modifiers: number }
  | { type: 'text'; text: string };

export type BrowserNavigation = 'goto' | 'back' | 'forward' | 'reload';

/** What a browser view asks of its window (the page's connection, or the extension host). */
export interface BrowserHost {
  /** Frames start coming to `onFrame` (see `frames`). */
  watch(options: { maxWidth?: number; maxHeight?: number; quality?: number }): Promise<void>;
  unwatch(): Promise<void>;
  /** Frames for the view; returns the unsubscribe. */
  frames(listener: (frame: BrowserFrame) => void): () => void;
  ack(frameId: number): Promise<void>;
  control(take: boolean): Promise<void>;
  input(events: BrowserInputEvent[]): Promise<void>;
  navigate(action: BrowserNavigation, url?: string): Promise<void>;
  dialog(accept: boolean, promptText?: string): Promise<void>;
  selectTab(targetId: string): Promise<void>;
  /** The user is done: the agent gets the browser back, with the note. */
  handBack(note?: string): Promise<void>;
}

// ---- a browser view in a webview of its own (VS Code's panel) ----

/** What a view calls on its host; `frames` is the panel's own. */
export type BrowserCall = Exclude<keyof BrowserHost, 'frames'>;

/** From the extension to the panel. */
export type BrowserPanelHostMessage =
  | { type: 'browser'; browser: BrowserState; connected: boolean }
  | { type: 'frame'; frame: BrowserFrame }
  | { type: 'visible'; visible: boolean }
  | { type: 'reply'; id: number; error?: string };

/** From the panel to the extension: `call` is answered with `reply`. */
export type BrowserPanelMessage = { type: 'ready' } | { type: 'call'; id: number; method: BrowserCall; args: unknown[] };
