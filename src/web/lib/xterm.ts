// What the page's terminals (a sign-in, the user's shells) have in common:
// how they look and how they draw.
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';

export function createTerminal(options: ITerminalOptions = {}): Terminal {
  const terminal = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    // The Unicode 11 widths below.
    allowProposedApi: true,
    ...options,
    theme: { background: '#1e1e1e', foreground: '#e4e4e4', ...options.theme }
  });
  // Emoji and other wide characters take the two columns the program counts for them.
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  return terminal;
}

/**
 * Draws it with WebGL once it is open: box drawing and block characters
 * (htop's frames and meters) join up, with no seams between rows, and full
 * screens redraw faster. Without WebGL, or when the browser takes the context
 * back, it draws with the DOM as before.
 */
export function drawWithWebgl(terminal: Terminal): void {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    terminal.loadAddon(webgl);
  } catch {
    // The DOM renderer stays.
  }
}
