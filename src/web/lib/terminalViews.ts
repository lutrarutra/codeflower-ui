// The page's terminals (a sign-in, the user's shells): output from the
// sandboxes goes to the view that shows each, by its id.

export interface TerminalView {
  /** `replayed`: what it printed before this window attached, which replaces what the view shows. */
  output(data: string, replayed: boolean): void;
  exit(exitCode: number): void;
}

export class TerminalViews {
  private readonly views = new Map<string, TerminalView>();
  /** Output that arrived before its terminal knew its id. */
  private readonly early = new Map<string, string>();

  /** Shows a terminal's output, including what came before it registered. */
  attach(terminalId: string, view: TerminalView): () => void {
    this.views.set(terminalId, view);
    const early = this.early.get(terminalId);
    this.early.delete(terminalId);
    if (early) view.output(early, false);
    return () => {
      if (this.views.get(terminalId) === view) this.views.delete(terminalId);
    };
  }

  output(terminalId: string, data: string, replayed = false): void {
    const view = this.views.get(terminalId);
    if (view) view.output(data, replayed);
    else this.early.set(terminalId, `${replayed ? '' : (this.early.get(terminalId) ?? '')}${data}`.slice(-65536));
  }

  exit(terminalId: string, exitCode: number): void {
    this.views.get(terminalId)?.exit(exitCode);
    this.views.delete(terminalId);
    this.early.delete(terminalId);
  }
}
