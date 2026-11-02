// Whether chats show only each turn's prompt and final message, their steps
// folded: in Focus (folded unless the user shows them) and in the chats'
// tabs (shown unless the user folds them), each kept in browser storage.

type View = 'focus' | 'chat';

const KEYS: Record<View, string> = { focus: 'codeflower.foldSteps.focus', chat: 'codeflower.foldSteps.chat' };

function stored(view: View, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(KEYS[view]);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

export const foldSteps = $state<Record<View, boolean>>({ focus: stored('focus', true), chat: stored('chat', false) });

export function setFoldSteps(view: View, fold: boolean): void {
  foldSteps[view] = fold;
  try {
    localStorage.setItem(KEYS[view], fold ? '1' : '0');
  } catch {
    // Not kept, e.g. in a private window.
  }
}
