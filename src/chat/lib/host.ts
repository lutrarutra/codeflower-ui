// A chat or preview talks to its host only through these: the VS Code
// extension host (messages to and from the webview), or the app's page, which
// runs the host in the same window and may show several chats at once. Each
// mounted view gets its own host, through Svelte's context.
import { getContext, setContext } from 'svelte';
import type { HostMessage, PreviewHostMessage, PreviewWebviewMessage, WebviewMessage } from '../../protocol/messages.ts';

export interface Host<Outgoing, Incoming> {
  send(message: Outgoing): void;
  /** Returns a function that stops listening. */
  listen(listener: (message: Incoming) => void): () => void;
}

export interface ChatHost extends Host<WebviewMessage, HostMessage> {
  /**
   * Keeps what the user is writing while no view shows the chat, for a host that
   * outlives its views (the page, as it switches chats or views); a view starts with it.
   */
  draft?: { read(): string; write(text: string): void };
}
export type PreviewHost = Host<PreviewWebviewMessage, PreviewHostMessage>;

const CHAT = Symbol('codeflower chat host');

export function provideChatHost(host: ChatHost): void {
  setContext(CHAT, host);
}

/** The host of the chat this component belongs to; call while the component initializes. */
export function chatHost(): ChatHost {
  const host = getContext<ChatHost | undefined>(CHAT);
  if (!host) throw new Error('A chat component was mounted without its host');
  return host;
}

/**
 * A host reached with postMessage, as a VS Code webview reaches its extension:
 * messages arrive as the window's message events.
 */
export function postMessageHost<Outgoing, Incoming>(post: (message: Outgoing) => void): Host<Outgoing, Incoming> {
  return {
    send: post,
    listen(listener) {
      const receive = (event: MessageEvent<Incoming>) => listener(event.data);
      window.addEventListener('message', receive);
      return () => window.removeEventListener('message', receive);
    }
  };
}
